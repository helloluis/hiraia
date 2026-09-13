#!/usr/bin/env bash
# ============================================================================
# deploy_probe_cpt.sh — provision 8×H100 SXM in US-NE-1 on the corpus volume,
# build the venv from the warm uv cache (~5 min), upload probe_driver.sh, and
# launch it detached. The driver self-terminates the pod (verified env).
# H100 is PRIMARY (the smoked sm90 stack runs bit-identical); 8×B200 would
# force a flash-attn recompile — only worth revisiting for the full 25B run.
# Usage: cd finetuning/cpt && ./deploy_probe_cpt.sh
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
VOLUME_ID="1atl7503ky"; DC_ID="US-NE-1"; POD_NAME="hiraia-probe-cpt"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
KEY="$HOME/.ssh/id_ed25519"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -i $KEY"
ENV_LOCAL="$HERE/../../.env.local"
set -a; . "$ENV_LOCAL"; set +a
: "${RUNPOD_API_KEY:?}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
[ -f probe_driver.sh ] || { echo "ERR: probe_driver.sh missing"; exit 1; }

# Poll for an 8× node: H100 preferred (smoked sm90 stack verbatim), B200 taken
# if it appears first (driver recompiles flash-attn for sm100 — ~10-15 min on
# an 8×-node CPU allotment; still net-faster given 2.25× training speed).
POD_ID=""; GPU_GOT=""
DEADLINE=$(( $(date +%s) + 14400 ))   # poll up to 4h
while [ -z "$POD_ID" ] && [ "$(date +%s)" -lt "$DEADLINE" ]; do
  for G in "NVIDIA H100 80GB HBM3" "NVIDIA B200"; do
    D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, gpuCount: 8, gpuTypeId: \\\"$G\\\", dataCenterId: \\\"$DC_ID\\\", networkVolumeId: \\\"$VOLUME_ID\\\", volumeMountPath: \\\"/workspace\\\", containerDiskInGb: 200, minVcpuCount: 32, minMemoryInGb: 256, supportPublicIp: true, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, env: [{key: \\\"RUNPOD_API_KEY\\\", value: \\\"$RUNPOD_API_KEY\\\"}], name: \\\"$POD_NAME\\\" }) { id } }")
    POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$POD_ID" ] && { GPU_GOT="$G"; break; }
  done
  [ -n "$POD_ID" ] || { echo ">> $(date +%H:%M) no 8× capacity (H100/B200), retry in 3 min ..."; sleep 180; }
done
[ -n "$POD_ID" ] || { echo "ERR: no 8× capacity within 4h window"; exit 1; }
echo ">> POD_ID=$POD_ID  GPU=$GPU_GOT"
IP=""; PORT=""
for i in $(seq 1 40); do
  P=$(gql "query { pod(input:{podId:\\\"$POD_ID\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && { echo ">> ssh root@$IP:$PORT"; break; }; sleep 15
done
[ -n "$PORT" ] || { echo "ERR: no SSH. POD_ID=$POD_ID — terminate manually."; exit 1; }
for i in $(seq 1 30); do ssh $SSH -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done

echo ">> venv from warm cache (exact smoked pin set) ..."
ssh $SSH -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE'
set -e
export PATH="$HOME/.local/bin:$PATH"
export UV_CACHE_DIR=/workspace/.uv-cache
command -v uv >/dev/null || (curl -LsSf https://astral.sh/uv/install.sh | sh)
export PATH="$HOME/.local/bin:$PATH"
uv venv --python 3.12 /root/venv-cpt
uv pip install --python /root/venv-cpt/bin/python torch torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install --python /root/venv-cpt/bin/python "transformers>=5.2" "flash-linear-attention==0.4.2"
uv pip install --python /root/venv-cpt/bin/python causal-conv1d --no-build-isolation
CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1 | cut -d. -f1)
if [ "$CAP" -ge 10 ]; then
  echo ">> Blackwell (cc $CAP.x): force flash-attn source rebuild for sm100 ..."
  MAX_JOBS=32 uv pip install --python /root/venv-cpt/bin/python flash-attn --no-build-isolation --reinstall --no-cache
else
  uv pip install --python /root/venv-cpt/bin/python flash-attn --no-build-isolation
fi
uv pip install --python /root/venv-cpt/bin/python "ms-swift>=4.3.1" datasets accelerate qwen_vl_utils
/root/venv-cpt/bin/python -c "import torch, fla, causal_conv1d, flash_attn, swift; print('stack OK,', torch.cuda.device_count(), 'GPUs')"
REMOTE

scp $SSH -P "$PORT" probe_driver.sh "root@$IP:/root/probe_driver.sh"
echo ">> launching probe driver DETACHED ..."
ssh $SSH -p "$PORT" "root@$IP" 'chmod +x /root/probe_driver.sh && nohup /root/probe_driver.sh > /dev/null 2>&1 & echo "DRIVER PID $!"'

cat <<EOF
============================================================================
PROBE CPT LAUNCHED. Driver self-terminates the pod when done (verified env).
  monitor: ssh $SSH -p $PORT root@$IP 'tail -f /workspace/corpus/logs/probe-cpt.log'
POD_ID=$POD_ID  IP=$IP  PORT=$PORT   (~\$26.3/hr × ~10-12h)
============================================================================
EOF
