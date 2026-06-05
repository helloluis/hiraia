#!/usr/bin/env bash
# ============================================================================
# deploy_grounded.sh — LOCAL launcher for the grounding-faithfulness training run.
#
# Deploys a pod in US-KS-2 with the persistent volume 5uwc7qp731 attached, uploads
# the grounded train script + dataset, ensures the venv, then runs run_grounded.sh
# (train Tagalog 3B grounded adapter -> convert to GGUF) DETACHED. Does NOT
# auto-terminate — prints the monitor / download / terminate commands.
#
# Prereqs: RUNPOD_API_KEY in repo-root .env.local; ~/.ssh/id_ed25519 registered
# with RunPod; finetuning/datasets/grounded/train-grounded.jsonl built.
#
# Usage:
#   cd finetuning && ./deploy_grounded.sh
#   GPU_TYPE="NVIDIA A100 80GB PCIe" ./deploy_grounded.sh
# ============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

VOLUME_ID="5uwc7qp731"
DC_ID="US-KS-2"
GPU_TYPE="${GPU_TYPE:-NVIDIA L40}"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
DISK_GB="${DISK_GB:-50}"
POD_NAME="${POD_NAME:-hiraia-grounded}"
KEY="$HOME/.ssh/id_ed25519"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -i $KEY"

ENV_LOCAL="$HERE/../.env.local"
[ -f "$ENV_LOCAL" ] || { echo "ERR: $ENV_LOCAL not found"; exit 1; }
set -a; . "$ENV_LOCAL"; set +a
: "${RUNPOD_API_KEY:?RUNPOD_API_KEY not set in .env.local}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }

echo ">> deploying $GPU_TYPE in $DC_ID with volume $VOLUME_ID ..."
DEPLOY=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, gpuCount: 1, gpuTypeId: \\\"$GPU_TYPE\\\", dataCenterId: \\\"$DC_ID\\\", networkVolumeId: \\\"$VOLUME_ID\\\", volumeMountPath: \\\"/workspace\\\", containerDiskInGb: $DISK_GB, minVcpuCount: 8, minMemoryInGb: 32, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"$POD_NAME\\\" }) { id } }")
echo "$DEPLOY"
POD_ID=$(echo "$DEPLOY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
[ -n "$POD_ID" ] || { echo "ERR: deploy failed (no pod id). Likely no $GPU_TYPE capacity in $DC_ID — retry with GPU_TYPE=\"NVIDIA A100 80GB PCIe\"."; exit 1; }
echo ">> pod id: $POD_ID"

echo ">> waiting for SSH port ..."
IP=""; PORT=""
for i in $(seq 1 40); do
  P=$(gql "query { pod(input:{podId:\\\"$POD_ID\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && { echo ">> ssh endpoint: root@$IP:$PORT"; break; }
  sleep 15
done
[ -n "$PORT" ] || { echo "ERR: SSH port never appeared. Pod $POD_ID may still be provisioning — check console."; exit 1; }

echo ">> waiting for sshd to accept ..."
for i in $(seq 1 30); do
  ssh $SSH_OPTS -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && { echo ">> ssh up"; break; }
  sleep 10
done

echo ">> ensuring /workspace/venv ..."
ssh $SSH_OPTS -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE'
set -e
cd /workspace
if [ ! -d venv ]; then
  echo "creating venv + installing deps (5-10 min)"
  python3 -m venv venv && source venv/bin/activate && pip install -q --upgrade pip
  pip install -q torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
  pip install -q -r /workspace/requirements-unsloth.txt 2>/dev/null || echo "(requirements not uploaded yet; retry after upload)"
else
  echo "venv exists"
fi
REMOTE

echo ">> uploading grounded script + dataset ..."
scp $SSH_OPTS -P "$PORT" \
  train-tagalog-grounded.py run_grounded.sh requirements-unsloth.txt \
  "root@$IP:/workspace/"
scp $SSH_OPTS -P "$PORT" datasets/grounded/train-grounded.jsonl "root@$IP:/workspace/train-grounded.jsonl"
ssh $SSH_OPTS -p "$PORT" "root@$IP" 'cd /workspace && source venv/bin/activate && pip install -q -r requirements-unsloth.txt'

echo ">> launching run_grounded.sh detached ..."
ssh $SSH_OPTS -p "$PORT" "root@$IP" \
  'rm -f /workspace/grounded.log; setsid nohup bash /workspace/run_grounded.sh > /workspace/grounded.log 2>&1 < /dev/null & echo "launched pid $!"'

cat <<EOF

================= POD LIVE: $POD_ID  (root@$IP:$PORT) =================
Watch progress:
  ssh $SSH_OPTS -p $PORT root@$IP 'tail -f /workspace/grounded.log'

When you see GROUNDED_DONE, download the adapter (safetensors + GGUF):
  scp $SSH_OPTS -P $PORT -r root@$IP:/workspace/output/tagalog-sailor-3b-grounded/final-adapter adapters/tagalog-sailor-3b-grounded/
  scp $SSH_OPTS -P $PORT root@$IP:/workspace/output/tagalog-sailor-3b-grounded/adapter-tagalog-grounded-f16.gguf adapters/

THEN terminate to stop billing (volume $VOLUME_ID persists):
  curl -s "https://api.runpod.io/graphql?api_key=\$RUNPOD_API_KEY" -H 'Content-Type: application/json' \\
    -d '{"query":"mutation { podTerminate(input: {podId: \\"$POD_ID\\"}) }"}'

Pod metadata saved to: $HERE/.grounded-pod
=====================================================================
EOF

# Persist pod coordinates so we can monitor/terminate later.
printf 'POD_ID=%s\nIP=%s\nPORT=%s\n' "$POD_ID" "$IP" "$PORT" > "$HERE/.grounded-pod"
