#!/usr/bin/env bash
# ============================================================================
# run-resft-parallel.sh — FIRE-AND-POLL launcher, 2-GPU PARALLEL re-SFT (one adapter per GPU).
# Provisions 2 GPUs (speed-ordered: fastest available wins — user prefers rapid runs), scp's
# scripts + datasets, launches resft-pipeline-parallel.sh DETACHED, clears trap, exits.
# Wall-clock ~= the slower single train (tl/bis overlap), not the sum.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
set -a; . ../../../.env.local; set +a
: "${RUNPOD_API_KEY:?}"; : "${HUGGINGFACE_API_KEY:?}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
KEY="$HOME/.ssh/id_ed25519"; SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=20 -i $KEY"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
IMAGE="runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"
BACK=10800   # 3h on-pod backstop (parallel re-SFT ~25-35min)
DISTILL="$(cd ../.. && pwd)"
TL_DATA="$DISTILL/distill/train-distill-kitten-v7.jsonl"
BIS_DATA="$DISTILL/datasets/bisaya/train-v5.jsonl"
[ -f "$TL_DATA" ] || { echo "ERR: missing $TL_DATA"; exit 1; }
[ -f "$BIS_DATA" ] || { echo "ERR: missing $BIS_DATA"; exit 1; }

# 2 GPUs, FASTEST available first (speed > cost)
COMBOS=("NVIDIA H100 PCIe|2" "NVIDIA H100 80GB HBM3|2" "NVIDIA A100 80GB PCIe|2" "NVIDIA L40S|2" "NVIDIA RTX A6000|2" "NVIDIA A40|2")
POD_ID=""; NGPU=""
terminate(){ [ -n "$POD_ID" ] && { echo ">> teardown (launch failed): terminating $POD_ID"; gql "mutation { podTerminate(input: {podId: \\\"$POD_ID\\\"}) }" >/dev/null; }; }
trap terminate EXIT

echo ">> provisioning 2 GPUs (fastest available) ..."
for combo in "${COMBOS[@]}"; do
  G="${combo%|*}"; C="${combo#*|}"; echo ">> try ${C}x ${G} ..."
  for CLOUD in SECURE COMMUNITY; do
    D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: $CLOUD, gpuCount: $C, gpuTypeId: \\\"$G\\\", volumeInGb: 0, containerDiskInGb: 80, minVcpuCount: 8, minMemoryInGb: 48, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"hiraia-resft-par\\\" }) { id } }")
    POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$POD_ID" ] && { GPU="$G"; NGPU="$C"; echo ">> pod $POD_ID = ${C}x ${G} ($CLOUD)"; break 2; }
  done
done
[ -n "$POD_ID" ] || { echo "ERR: no 2-GPU capacity in any combo"; exit 1; }

echo ">> waiting for SSH ..."; IP=""; PORT=""
for i in $(seq 1 50); do
  P=$(gql "query { pod(input:{podId:\\\"$POD_ID\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && { echo ">> ssh root@$IP:$PORT"; break; }; sleep 15
done
[ -n "$PORT" ] || { echo "ERR: no SSH"; exit 1; }
for i in $(seq 1 40); do ssh $SSH -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done

echo ">> on-pod backstop (${BACK}s) ..."
ssh $SSH -p "$PORT" "root@$IP" "setsid nohup sh -c 'sleep $BACK; curl -s \"$API\" -H \"Content-Type: application/json\" -d \"{\\\"query\\\":\\\"mutation { podTerminate(input: {podId: \\\\\\\"$POD_ID\\\\\\\"}) }\\\"}\"' >/dev/null 2>&1 < /dev/null &" || true

echo ">> uploading scripts + datasets ..."
scp $SSH -P "$PORT" resft.py resft-pipeline-parallel.sh "root@$IP:/workspace/"
scp $SSH -P "$PORT" "$TL_DATA"  "root@$IP:/workspace/train-distill-kitten-v7.jsonl"
scp $SSH -P "$PORT" "$BIS_DATA" "root@$IP:/workspace/train-bisaya-v5.jsonl"

echo ">> launching DETACHED parallel resft-pipeline ..."
ssh $SSH -p "$PORT" "root@$IP" "cd /workspace && rm -f pipeline.log && HF_TOKEN=$HUGGINGFACE_API_KEY setsid nohup bash resft-pipeline-parallel.sh > pipeline.log 2>&1 < /dev/null & echo launched-pid \$!"

trap - EXIT
echo "POD_ID=$POD_ID"; echo "IP=$IP"; echo "PORT=$PORT"; echo "NGPU=$NGPU GPU=$GPU"
echo "$POD_ID $IP $PORT $NGPU resft-parallel $(date)" >> ceb-pods.txt
echo "$POD_ID $IP $PORT $NGPU" > .resft-pod
echo ">> LAUNCHED (2x $GPU parallel). Orchestrator exiting; pod runs independently (backstop ${BACK}s)."
echo ">> poll: ssh -i $KEY -p $PORT root@$IP 'tail -4 /workspace/pipeline.log; echo ---TL---; tail -3 /workspace/tl.log; echo ---BIS---; tail -3 /workspace/bis.log'"
