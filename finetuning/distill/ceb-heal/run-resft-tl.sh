#!/usr/bin/env bash
# run-resft-tl.sh — FIRE-AND-POLL launcher, TL-ONLY re-SFT on the augmented v8 dataset.
# Single fastest GPU (rapid). scp's resft.py + resft-pipeline-tl.sh + v8 dataset, launches detached.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
set -a; . ../../../.env.local; set +a
: "${RUNPOD_API_KEY:?}"; : "${HUGGINGFACE_API_KEY:?}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
KEY="$HOME/.ssh/id_ed25519"; SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=20 -i $KEY"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
IMAGE="runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"
BACK=7200
DISTILL="$(cd ../.. && pwd)"
TL_DATA="$DISTILL/distill/train-distill-kitten-v8.jsonl"
[ -f "$TL_DATA" ] || { echo "ERR: missing $TL_DATA"; exit 1; }

# single fastest GPU first (rapid)
COMBOS=("NVIDIA H100 PCIe|1" "NVIDIA H100 80GB HBM3|1" "NVIDIA A100 80GB PCIe|1" "NVIDIA L40S|1" "NVIDIA RTX A6000|1" "NVIDIA A40|1")
POD_ID=""; NGPU=""
terminate(){ [ -n "$POD_ID" ] && { echo ">> teardown (launch failed): terminating $POD_ID"; gql "mutation { podTerminate(input: {podId: \\\"$POD_ID\\\"}) }" >/dev/null; }; }
trap terminate EXIT

echo ">> provisioning 1 fast GPU ..."
for combo in "${COMBOS[@]}"; do
  G="${combo%|*}"; C="${combo#*|}"; echo ">> try ${C}x ${G} ..."
  for CLOUD in SECURE COMMUNITY; do
    D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: $CLOUD, gpuCount: $C, gpuTypeId: \\\"$G\\\", volumeInGb: 0, containerDiskInGb: 80, minVcpuCount: 8, minMemoryInGb: 48, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"hiraia-resft-tl\\\" }) { id } }")
    POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$POD_ID" ] && { GPU="$G"; NGPU="$C"; echo ">> pod $POD_ID = ${C}x ${G} ($CLOUD)"; break 2; }
  done
done
[ -n "$POD_ID" ] || { echo "ERR: no GPU capacity"; exit 1; }

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

echo ">> uploading scripts + v8 dataset ..."
scp $SSH -P "$PORT" resft.py resft-pipeline-tl.sh "root@$IP:/workspace/"
scp $SSH -P "$PORT" "$TL_DATA" "root@$IP:/workspace/train-distill-kitten-v8.jsonl"

echo ">> launching DETACHED resft-pipeline-tl ..."
ssh $SSH -p "$PORT" "root@$IP" "cd /workspace && rm -f pipeline.log && HF_TOKEN=$HUGGINGFACE_API_KEY setsid nohup bash resft-pipeline-tl.sh > pipeline.log 2>&1 < /dev/null & echo launched-pid \$!"

trap - EXIT
echo "POD_ID=$POD_ID"; echo "IP=$IP"; echo "PORT=$PORT"; echo "NGPU=$NGPU GPU=$GPU"
echo "$POD_ID $IP $PORT $NGPU resft-tl-v8 $(date)" >> ceb-pods.txt
echo "$POD_ID $IP $PORT $NGPU" > .resft-pod
echo ">> LAUNCHED (1x $GPU, TL v8). backstop ${BACK}s."
