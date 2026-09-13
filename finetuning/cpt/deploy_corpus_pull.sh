#!/usr/bin/env bash
# ============================================================================
# deploy_corpus_pull.sh — provision a cheap pod in US-NE-1 attached to the
# hiraia-cpt-corpus network volume (1atl7503ky, 500GB) and launch the CPT
# corpus pull DETACHED (pull_corpus.py). Prints monitor/terminate commands
# (no auto-terminate — you control billing).
#
# DC choice (2026-08-21 audit): US-NE-1 = storage support + B200 + H100 SXM
# all in one DC, so the SAME volume later attaches to the CPT training pod.
# Pod ladder: cheapest first (MIG slice is plenty — the pull is network-bound).
#
# Usage:  cd finetuning/cpt && ./deploy_corpus_pull.sh
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
VOLUME_ID="1atl7503ky"; DC_ID="US-NE-1"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
DISK_GB=30; POD_NAME="hiraia-corpus-pull"
KEY="$HOME/.ssh/id_ed25519"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -i $KEY"
ENV_LOCAL="$HERE/../../.env.local"
[ -f "$ENV_LOCAL" ] || { echo "ERR: .env.local not found"; exit 1; }
set -a; . "$ENV_LOCAL"; set +a
: "${RUNPOD_API_KEY:?RUNPOD_API_KEY not set}"
: "${HUGGINGFACE_API_KEY:?HUGGINGFACE_API_KEY not set (CulturaX is gated)}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
[ -f pull_corpus.py ] || { echo "ERR: pull_corpus.py missing"; exit 1; }

# supportPublicIp:true even with the DC pinned — the SSH wait can never reach a
# proxy-only pod (hiraia-runpod-gpu-pref gotcha, observed 3x on 2026-06-15).
GPUS=("NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 1g.24gb" "NVIDIA H100 80GB HBM3" "NVIDIA B200")
POD_ID=""
for G in "${GPUS[@]}"; do
  echo ">> try $G in $DC_ID (+volume) ..."
  D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, gpuCount: 1, gpuTypeId: \\\"$G\\\", dataCenterId: \\\"$DC_ID\\\", networkVolumeId: \\\"$VOLUME_ID\\\", volumeMountPath: \\\"/workspace\\\", containerDiskInGb: $DISK_GB, minVcpuCount: 4, minMemoryInGb: 16, supportPublicIp: true, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"$POD_NAME\\\" }) { id } }")
  POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$POD_ID" ] && { GPU="$G"; break; }
  echo "   no capacity: $(echo "$D" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p' | head -1)"
done
[ -n "$POD_ID" ] || { echo "ERR: no capacity in $DC_ID for any candidate"; exit 1; }
echo ">> POD_ID=$POD_ID  GPU=$GPU"

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

echo ">> venv (on the volume — survives pod termination) + hf tooling ..."
ssh $SSH -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE'
set -e
mkdir -p /workspace/corpus/logs
if [ ! -x /workspace/venv-pull/bin/python ]; then
  python3 -m venv /workspace/venv-pull
fi
/workspace/venv-pull/bin/pip install -q --upgrade pip
/workspace/venv-pull/bin/pip install -q --upgrade huggingface_hub hf_xet
/workspace/venv-pull/bin/python -c "import huggingface_hub, hf_xet; print('huggingface_hub', huggingface_hub.__version__, '| hf_xet', hf_xet.__version__)"
REMOTE

scp $SSH -P "$PORT" pull_corpus.py "root@$IP:/workspace/pull_corpus.py"

echo ">> launching pull DETACHED ..."
ssh $SSH -p "$PORT" "root@$IP" "cd /workspace && HF_TOKEN='$HUGGINGFACE_API_KEY' nohup /workspace/venv-pull/bin/python -u pull_corpus.py > corpus/logs/pull.log 2>&1 & echo PID \$!"

cat <<EOF
============================================================================
Corpus pull launched. Pod stays up until YOU terminate it.
  monitor:   ssh $SSH -p $PORT root@$IP 'tail -f /workspace/corpus/logs/pull.log'
  manifest:  ssh $SSH -p $PORT root@$IP 'cat /workspace/corpus/raw/MANIFEST.json'
  disk:      ssh $SSH -p $PORT root@$IP 'df -h /workspace; du -sh /workspace/corpus/raw/* 2>/dev/null'
  terminate: curl -s --max-time 30 "$API" -H 'Content-Type: application/json' -d '{"query":"mutation { podTerminate(input: {podId: \"$POD_ID\"}) }"}'
POD_ID=$POD_ID  IP=$IP  PORT=$PORT
============================================================================
EOF
