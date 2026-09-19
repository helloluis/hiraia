#!/usr/bin/env bash
# ============================================================================
# run-resft.sh — FIRE-AND-POLL launcher for the re-SFT (both kitten adapters on the healed 2.4B).
# Provisions ONE cheap 40-48GB GPU (the 2.4B 4-bit LoRA is tiny), scp's scripts + datasets,
# launches resft-pipeline.sh DETACHED, clears its teardown trap, exits. Poll pipeline.log;
# finalize/terminate via the guard. Killing this launcher does NOT nuke the pod.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
set -a; . ../../../.env.local; set +a
: "${RUNPOD_API_KEY:?}"; : "${HUGGINGFACE_API_KEY:?}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
KEY="$HOME/.ssh/id_ed25519"; SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=20 -i $KEY"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
IMAGE="runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"
BACK=14400   # on-pod backstop 4h (re-SFT is ~40-60min; generous)
DISTILL="$(cd ../.. && pwd)"   # finetuning/
TL_DATA="$DISTILL/distill/train-distill-kitten-v7.jsonl"
BIS_DATA="$DISTILL/datasets/bisaya/train-v5.jsonl"
[ -f "$TL_DATA" ] || { echo "ERR: missing $TL_DATA"; exit 1; }
[ -f "$BIS_DATA" ] || { echo "ERR: missing $BIS_DATA"; exit 1; }

# single cheap 40-48GB card, secure then community
COMBOS=("NVIDIA A40|1" "NVIDIA RTX A6000|1" "NVIDIA L40S|1" "NVIDIA L40|1" "NVIDIA A100 80GB PCIe|1" "NVIDIA H100 PCIe|1")
POD_ID=""; NGPU=""
terminate(){ [ -n "$POD_ID" ] && { echo ">> teardown (launch failed): terminating $POD_ID"; gql "mutation { podTerminate(input: {podId: \\\"$POD_ID\\\"}) }" >/dev/null; }; }
trap terminate EXIT

echo ">> provisioning ONE cheap GPU ..."
for combo in "${COMBOS[@]}"; do
  G="${combo%|*}"; C="${combo#*|}"; echo ">> try ${C}x ${G} ..."
  for CLOUD in SECURE COMMUNITY; do
    D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: $CLOUD, gpuCount: $C, gpuTypeId: \\\"$G\\\", volumeInGb: 0, containerDiskInGb: 80, minVcpuCount: 4, minMemoryInGb: 32, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"hiraia-resft\\\" }) { id } }")
    POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$POD_ID" ] && { GPU="$G"; NGPU="$C"; echo ">> pod $POD_ID = ${C}x ${G} ($CLOUD)"; break 2; }
  done
done
[ -n "$POD_ID" ] || { echo "ERR: no cheap GPU capacity"; exit 1; }

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
scp $SSH -P "$PORT" resft.py resft-pipeline.sh "root@$IP:/workspace/"
scp $SSH -P "$PORT" "$TL_DATA"  "root@$IP:/workspace/train-distill-kitten-v7.jsonl"
scp $SSH -P "$PORT" "$BIS_DATA" "root@$IP:/workspace/train-bisaya-v5.jsonl"

echo ">> launching DETACHED resft-pipeline ..."
ssh $SSH -p "$PORT" "root@$IP" "cd /workspace && rm -f pipeline.log && HF_TOKEN=$HUGGINGFACE_API_KEY setsid nohup bash resft-pipeline.sh > pipeline.log 2>&1 < /dev/null & echo launched-pid \$!"

trap - EXIT
echo "POD_ID=$POD_ID"; echo "IP=$IP"; echo "PORT=$PORT"
echo "$POD_ID $IP $PORT $NGPU resft-fireandpoll $(date)" >> ceb-pods.txt
echo "$POD_ID $IP $PORT $NGPU" > .resft-pod
echo ">> LAUNCHED. Orchestrator exiting; pod runs independently (backstop ${BACK}s)."
echo ">> poll: ssh -i $KEY -p $PORT root@$IP 'tail -6 /workspace/pipeline.log'"
