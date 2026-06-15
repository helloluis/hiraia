#!/usr/bin/env bash
# ============================================================================
# deploy_v4_distill.sh — provision a GPU pod, upload the v4 dataset+script, and launch the
# skill-only v4 LoRA train DETACHED. Prints monitor/download/terminate commands (no auto-terminate
# — you control billing). v4 = v3 + multi-turn (P4) + faithful settled-confidence (P3) + natural
# engagement (P5); same recipe as v3 (r32/a64/3ep, max_seq 2048).
#
# Tries US-KS-2 + the persistent volume 5uwc7qp731 first (cached venv → fast); falls back to any
# datacenter with a fresh throwaway volume (installs torch+unsloth, ~10 min more).
#
# Usage:  cd finetuning && ./deploy_v4_distill.sh
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
VOLUME_ID="5uwc7qp731"; DC_ID="US-KS-2"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
DISK_GB=60; POD_NAME="hiraia-distill-v4"
KEY="$HOME/.ssh/id_ed25519"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -i $KEY"
ENV_LOCAL="$HERE/../.env.local"
[ -f "$ENV_LOCAL" ] || { echo "ERR: .env.local not found"; exit 1; }
set -a; . "$ENV_LOCAL"; set +a
: "${RUNPOD_API_KEY:?RUNPOD_API_KEY not set}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
[ -f distill/train-distill-v4.jsonl ] || { echo "ERR: distill/train-distill-v4.jsonl missing"; exit 1; }
[ -f train-distill-v4.py ] || { echo "ERR: train-distill-v4.py missing"; exit 1; }

GPUS=("NVIDIA L40" "NVIDIA L40S" "NVIDIA RTX A6000" "NVIDIA A100 80GB PCIe" "NVIDIA A40")
POD_ID=""; VOL=1
# 1) try US-KS-2 + persistent volume (cached venv)
for G in "${GPUS[@]}"; do
  echo ">> try $G in $DC_ID (+volume) ..."
  D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, gpuCount: 1, gpuTypeId: \\\"$G\\\", dataCenterId: \\\"$DC_ID\\\", networkVolumeId: \\\"$VOLUME_ID\\\", volumeMountPath: \\\"/workspace\\\", containerDiskInGb: $DISK_GB, minVcpuCount: 8, minMemoryInGb: 32, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"$POD_NAME\\\" }) { id } }")
  POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$POD_ID" ] && { GPU="$G"; break; }
done
# 2) fallback: any DC, throwaway volume (fresh venv install)
if [ -z "$POD_ID" ]; then
  echo ">> US-KS-2 constrained — trying any-DC throwaway ..."; VOL=0
  for CLOUD in SECURE COMMUNITY; do for G in "${GPUS[@]}"; do
    echo ">> try $G ($CLOUD, any DC) ..."
    D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: $CLOUD, gpuCount: 1, gpuTypeId: \\\"$G\\\", volumeInGb: 0, containerDiskInGb: $DISK_GB, minVcpuCount: 6, minMemoryInGb: 32, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"$POD_NAME\\\" }) { id } }")
    POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$POD_ID" ] && { GPU="$G ($CLOUD)"; break 2; }
  done; done
fi
[ -n "$POD_ID" ] || { echo "ERR: no GPU capacity anywhere"; exit 1; }
echo ">> POD_ID=$POD_ID  GPU=$GPU  volume=$VOL"

echo ">> waiting for SSH ..."
IP=""; PORT=""
for i in $(seq 1 40); do
  P=$(gql "query { pod(input:{podId:\\\"$POD_ID\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && { echo ">> ssh root@$IP:$PORT"; break; }; sleep 15
done
[ -n "$PORT" ] || { echo "ERR: no SSH port. POD_ID=$POD_ID — terminate manually."; exit 1; }
for i in $(seq 1 30); do ssh $SSH -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done

echo ">> ensuring venv + deps ..."
ssh $SSH -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE'
set -e; cd /workspace
if [ ! -d venv ]; then
  python3 -m venv venv && source venv/bin/activate && pip install -q --upgrade pip
  pip install -q torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
fi
source venv/bin/activate
python -c "import unsloth" 2>/dev/null || pip install -q --break-system-packages "unsloth==2026.6.2" "trl==0.24.0" "transformers==4.57.6" "peft==0.18.1" datasets
python -c "import unsloth, trl; print('unsloth ok')"
REMOTE

echo ">> uploading dataset + train script ..."
scp $SSH -P "$PORT" distill/train-distill-v4.jsonl "root@$IP:/workspace/train-distill-v4.jsonl"
scp $SSH -P "$PORT" train-distill-v4.py "root@$IP:/workspace/train-distill-v4.py"

echo ">> launching v4 train detached ..."
ssh $SSH -p "$PORT" "root@$IP" \
  'cd /workspace && rm -f train-v4.log && source venv/bin/activate && setsid nohup python train-distill-v4.py > train-v4.log 2>&1 < /dev/null & echo "launched pid $!"'

cat <<EOF

================= v4 TRAIN LIVE: $POD_ID  (root@$IP:$PORT) =================
Watch:    ssh $SSH -p $PORT root@$IP 'tail -f /workspace/train-v4.log'
Download when done (look for "Adapter saved"):
  scp $SSH -P $PORT -r root@$IP:/workspace/output/distill-sailor-3b-v4/final-adapter adapters/distill-sailor-3b-v4/
Terminate (stop billing):
  curl -s "$API" -H 'Content-Type: application/json' -d '{"query":"mutation { podTerminate(input: {podId: \\"$POD_ID\\"}) }"}'
POD_ID=$POD_ID
=====================================================================
EOF
