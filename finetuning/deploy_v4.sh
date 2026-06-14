#!/usr/bin/env bash
# ============================================================================
# deploy_v4.sh — LOCAL launcher for the one-session v4 finetune+eval pipeline.
#
# v4 = image-request-under-grounding + anti-repetition SFT (Sailor2-3B-Chat,
# train-v4.jsonl = train-v3 + 150 new rows per language).
#
# Deploys a pod in US-KS-2 with the PERSISTENT volume 5uwc7qp731 attached (so the
# QVAC v8828 build + base GGUF are present for the phone-parity eval), uploads the
# datasets/scripts/eval, ensures the venv, then kicks off session_runner_v4.sh
# DETACHED on the pod. It does NOT auto-terminate — it prints the monitor /
# download / terminate commands so you stay in control of billing.
#
# Prereqs (local): RUNPOD_API_KEY in finetuning/../.env.local, ~/.ssh/id_ed25519
# registered with the RunPod account, the v4 datasets built under datasets/.
#
# Usage:
#   cd finetuning && ./deploy_v4.sh
#   GPU_TYPE="NVIDIA A100 80GB PCIe" ./deploy_v4.sh     # pick a different GPU
# ============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# ---- config ---------------------------------------------------------------
VOLUME_ID="5uwc7qp731"          # persistent hiraia-ks volume (US-KS-2)
DC_ID="US-KS-2"
GPU_TYPE="${GPU_TYPE:-NVIDIA L40}"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
DISK_GB="${DISK_GB:-50}"
POD_NAME="${POD_NAME:-hiraia-sailor-v4}"
KEY="$HOME/.ssh/id_ed25519"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -i $KEY"

# ---- api key --------------------------------------------------------------
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
[ -n "$POD_ID" ] || { echo "ERR: deploy failed (no pod id). Common causes: no $GPU_TYPE capacity in $DC_ID, or bad gpuTypeId."; exit 1; }
echo ">> pod id: $POD_ID"

# ---- wait for SSH port ----------------------------------------------------
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

# ---- ensure venv (idempotent; one-time per volume) ------------------------
echo ">> ensuring /workspace/venv ..."
ssh $SSH_OPTS -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE'
set -e
cd /workspace
if [ ! -d venv ]; then
  echo "creating venv + installing deps (5-10 min)"
  python3 -m venv venv && source venv/bin/activate && pip install -q --upgrade pip
  pip install -q torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
  pip install -q -r /workspace/requirements-unsloth.txt 2>/dev/null || echo "(requirements-unsloth.txt not uploaded yet; will retry after upload)"
else
  echo "venv exists"
fi
REMOTE

# ---- upload datasets + scripts + eval -------------------------------------
echo ">> uploading files ..."
scp $SSH_OPTS -P "$PORT" \
  train-tagalog-unsloth-v4.py train-bisaya-unsloth-v4.py requirements-unsloth.txt session_runner_v4.sh \
  "root@$IP:/workspace/"
scp $SSH_OPTS -P "$PORT" \
  eval/run_eval_pod_v3.py eval/run_eval_qvac2_v3.py eval/student-prompts.json \
  "root@$IP:/workspace/"
scp $SSH_OPTS -P "$PORT" datasets/tagalog/train-v4.jsonl "root@$IP:/workspace/train-tagalog-v4.jsonl"
scp $SSH_OPTS -P "$PORT" datasets/bisaya/train-v4.jsonl  "root@$IP:/workspace/train-bisaya-v4.jsonl"
# finish deps now that requirements is present (no-op if already installed)
ssh $SSH_OPTS -p "$PORT" "root@$IP" 'cd /workspace && source venv/bin/activate && pip install -q -r requirements-unsloth.txt'

# ---- launch the pipeline detached -----------------------------------------
echo ">> launching session_runner_v4.sh detached ..."
ssh $SSH_OPTS -p "$PORT" "root@$IP" \
  'rm -f /workspace/session-v4.log; setsid nohup bash /workspace/session_runner_v4.sh > /workspace/session-v4.log 2>&1 < /dev/null & echo "launched pid $!"'

cat <<EOF

================= POD LIVE: $POD_ID  (root@$IP:$PORT) =================
Watch progress:
  ssh $SSH_OPTS -p $PORT root@$IP 'tail -f /workspace/session-v4.log'

When you see SESSION_DONE, download results + adapters:
  scp $SSH_OPTS -P $PORT root@$IP:'/workspace/eval-v4-*.json' eval/
  scp $SSH_OPTS -P $PORT -r root@$IP:/workspace/output/tagalog-sailor-v4/final-adapter adapters/tagalog-sailor-v4/
  scp $SSH_OPTS -P $PORT -r root@$IP:/workspace/output/bisaya-sailor-v4/final-adapter  adapters/bisaya-sailor-v4/
  scp $SSH_OPTS -P $PORT root@$IP:/workspace/output/tagalog-sailor-v4/adapter-tagalog-v4-f16.gguf adapters/
  scp $SSH_OPTS -P $PORT root@$IP:/workspace/output/bisaya-sailor-v4/adapter-bisaya-v4-f16.gguf  adapters/

THEN terminate to stop billing (volume $VOLUME_ID persists):
  curl -s "\$API" -H 'Content-Type: application/json' \\
    -d '{"query":"mutation { podTerminate(input: {podId: \\"$POD_ID\\"}) }"}'
  # (\$API = https://api.runpod.io/graphql?api_key=\$RUNPOD_API_KEY)
=====================================================================
EOF
