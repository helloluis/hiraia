#!/usr/bin/env bash
# ============================================================================
# deploy_eval_v3_distill.sh — one-shot GPU-pod eval for the intent-distillation
# v3 adapter (distill-sailor-3b-v3), apples-to-apples with the recorded v2a run.
#
# Reuses the EXACT v2 distill eval: eval-gen-v2-pod.py over heldout-v2.json (30
# held-out facts × 3 conditions: correct-fact / distractor-fact / no-fact),
# HF-bf16 via transformers+PEFT — same method that produced eval-v2a-out.json.
#
# Deploys an L40 in US-KS-2 with the persistent volume 5uwc7qp731 (cached venv +
# base), uploads the v3 adapter + held-out set + gen script, generates
# eval-v3-out.json, downloads it, and TERMINATES the pod (download-then-terminate).
# On any failure it leaves the pod up and prints the manual terminate command.
#
# Usage:  cd finetuning && ./deploy_eval_v3_distill.sh
# ============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"

VOLUME_ID="5uwc7qp731"; DC_ID="US-KS-2"
GPU_TYPE="${GPU_TYPE:-NVIDIA L40}"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
DISK_GB="${DISK_GB:-50}"; POD_NAME="${POD_NAME:-hiraia-eval-v3-distill}"
KEY="$HOME/.ssh/id_ed25519"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -i $KEY"
ADAPTER_DIR="adapters/distill-sailor-3b-v3/final-adapter"

ENV_LOCAL="$HERE/../.env.local"
[ -f "$ENV_LOCAL" ] || { echo "ERR: $ENV_LOCAL not found"; exit 1; }
set -a; . "$ENV_LOCAL"; set +a
: "${RUNPOD_API_KEY:?RUNPOD_API_KEY not set}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
terminate(){ echo ">> terminating pod $1"; gql "mutation { podTerminate(input: {podId: \\\"$1\\\"}) }"; echo; }

[ -d "$ADAPTER_DIR" ] || { echo "ERR: $ADAPTER_DIR missing"; exit 1; }

# US-KS-2 (the persistent volume's DC) is supply-constrained, and this eval doesn't
# need the cached volume — just transformers+peft (fresh pip) + base from HF. So we
# deploy a THROWAWAY pod in ANY datacenter with capacity (no networkVolumeId, no
# dataCenterId). Try cheap secure GPUs, then community cloud. Sailor2-3B bf16 (~7GB)
# + adapter fits in 24GB.
GPU_CANDIDATES=(
  "${GPU_TYPE_OVERRIDE:-}"
  "NVIDIA RTX A5000"
  "NVIDIA RTX A4000"
  "NVIDIA A40"
  "NVIDIA RTX A6000"
  "NVIDIA L40S"
  "NVIDIA L40"
  "NVIDIA A100 80GB PCIe"
)
POD_ID=""
for CLOUD in SECURE COMMUNITY; do
  for G in "${GPU_CANDIDATES[@]}"; do
    [ -z "$G" ] && continue
    echo ">> trying $G ($CLOUD, any DC) ..."
    DEPLOY=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: $CLOUD, gpuCount: 1, gpuTypeId: \\\"$G\\\", volumeInGb: 0, containerDiskInGb: $DISK_GB, minVcpuCount: 4, minMemoryInGb: 24, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"$POD_NAME\\\" }) { id } }")
    POD_ID=$(echo "$DEPLOY" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    if [ -n "$POD_ID" ]; then echo ">> got $G ($CLOUD)  POD_ID=$POD_ID"; GPU_TYPE="$G ($CLOUD)"; break 2; fi
    echo "   no capacity: $(echo "$DEPLOY" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p' | head -1)"
    sleep 1
  done
done
[ -n "$POD_ID" ] || { echo "ERR: no capacity for any candidate GPU (secure+community)."; exit 1; }

echo ">> waiting for SSH endpoint ..."
IP=""; PORT=""
for i in $(seq 1 40); do
  P=$(gql "query { pod(input:{podId:\\\"$POD_ID\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && { echo ">> ssh: root@$IP:$PORT"; break; }
  sleep 15
done
[ -n "$PORT" ] || { echo "ERR: no SSH port. POD_ID=$POD_ID still provisioning; terminate manually."; exit 1; }

echo ">> waiting for sshd ..."
for i in $(seq 1 30); do
  ssh $SSH_OPTS -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && { echo ">> ssh up"; break; }
  sleep 10
done

echo ">> uploading adapter + heldout + gen script ..."
ssh $SSH_OPTS -p "$PORT" "root@$IP" 'rm -rf /workspace/distill-v3-adapter && mkdir -p /workspace/distill-v3-adapter'
scp $SSH_OPTS -P "$PORT" -r "$ADAPTER_DIR"/. "root@$IP:/workspace/distill-v3-adapter/"
scp $SSH_OPTS -P "$PORT" distill/eval/heldout-v2.json "root@$IP:/workspace/heldout-v2.json"
scp $SSH_OPTS -P "$PORT" distill/eval/eval-gen-v2-pod.py "root@$IP:/workspace/eval-gen-v2-pod.py"

echo ">> installing deps + generating (system python on the pytorch image) ..."
ssh $SSH_OPTS -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE'
set -e
cd /workspace
# The runpod/pytorch image ships torch+CUDA; add the eval-only deps. eval-gen-v2-pod.py
# uses from_pretrained(dtype=...), the modern kwarg — install a current transformers.
pip install -q --break-system-packages -U transformers peft accelerate 2>&1 | tail -2 || \
  pip install -q -U transformers peft accelerate 2>&1 | tail -2
python -c "import transformers, peft, torch; print('transformers',transformers.__version__,'torch',torch.__version__,'cuda',torch.cuda.is_available())"
ADAPTER=/workspace/distill-v3-adapter OUT=/workspace/eval-v3-out.json python eval-gen-v2-pod.py
echo "GEN_DONE bytes=$(stat -c%s /workspace/eval-v3-out.json)"
REMOTE

echo ">> downloading eval-v3-out.json ..."
scp $SSH_OPTS -P "$PORT" "root@$IP:/workspace/eval-v3-out.json" distill/eval/eval-v3-out.json
if [ -s distill/eval/eval-v3-out.json ]; then
  echo ">> OK: distill/eval/eval-v3-out.json ($(wc -c < distill/eval/eval-v3-out.json) bytes)"
  terminate "$POD_ID"
  echo "=== EVAL_PIPELINE_OK POD_TERMINATED ==="
else
  echo "ERR: download empty. POD LEFT UP for debug. Terminate: gql podTerminate POD_ID=$POD_ID"
  exit 1
fi
