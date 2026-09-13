#!/usr/bin/env bash
# ============================================================================
# deploy_smoke_b200.sh — checklist-② scaffold: provision a 1×B200 pod on the
# corpus volume and install the pinned CPT stack (PROBE-CPT-CONFIG §2).
# Assertions + the mini training run are driven interactively after this lands
# (the smoke test IS the validation that these pins install and run — expect
# iteration; log everything).
#
# Stack pins: Python 3.12 / torch cu128 (Blackwell sm_100) / ms-swift ≥4.3.1 /
# megatron-core ≥0.16 / transformers 5.x / fla 0.4.2 (NOT 0.5.0) / causal-conv1d.
# Venv lives on the VOLUME (/workspace/venv-cpt) — survives pod swaps, reused
# by the probe-run pods.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
VOLUME_ID="1atl7503ky"; DC_ID="US-NE-1"; POD_NAME="hiraia-smoke-b200"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
KEY="$HOME/.ssh/id_ed25519"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -i $KEY"
ENV_LOCAL="$HERE/../../.env.local"
set -a; . "$ENV_LOCAL"; set +a
: "${RUNPOD_API_KEY:?}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }

# B200 first; H100 SXM fallback (config §4: probe itself falls back to 8×H100,
# so an H100 smoke matches the likely run target; sm_100 kernel compile then
# remains the one residual to spot-check if a B200 run materializes).
POD_ID=""
for G in "NVIDIA B200" "NVIDIA H100 80GB HBM3"; do
  echo ">> provisioning 1x $G in $DC_ID ..."
  D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, gpuCount: 1, gpuTypeId: \\\"$G\\\", dataCenterId: \\\"$DC_ID\\\", networkVolumeId: \\\"$VOLUME_ID\\\", volumeMountPath: \\\"/workspace\\\", containerDiskInGb: 80, minVcpuCount: 8, minMemoryInGb: 64, supportPublicIp: true, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, env: [{key: \\\"RUNPOD_API_KEY\\\", value: \\\"$RUNPOD_API_KEY\\\"}], name: \\\"$POD_NAME\\\" }) { id } }")
  POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$POD_ID" ] && { echo ">> got $G"; break; }
  echo "   no capacity: $(echo "$D" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p' | head -1)"
done
[ -n "$POD_ID" ] || { echo "ERR: no B200/H100 capacity"; exit 1; }
echo ">> POD_ID=$POD_ID"
IP=""; PORT=""
for i in $(seq 1 40); do
  P=$(gql "query { pod(input:{podId:\\\"$POD_ID\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && { echo ">> ssh root@$IP:$PORT"; break; }; sleep 15
done
[ -n "$PORT" ] || { echo "ERR: no SSH. POD_ID=$POD_ID — terminate manually."; exit 1; }
for i in $(seq 1 30); do ssh $SSH -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done

echo ">> GPU sanity + stack install (logged to volume) ..."
ssh $SSH -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE' 2>&1 | tee /tmp/smoke-install.log
set -e
nvidia-smi --query-gpu=name,driver_version,compute_cap --format=csv,noheader
export PATH="$HOME/.local/bin:$PATH"
command -v uv >/dev/null || (curl -LsSf https://astral.sh/uv/install.sh | sh)
export PATH="$HOME/.local/bin:$PATH"
V=/workspace/venv-cpt
[ -x $V/bin/python ] || uv venv --python 3.12 $V
$V/bin/python -V
echo ">> torch cu128 ..."
uv pip install --python $V/bin/python torch --index-url https://download.pytorch.org/whl/cu128
$V/bin/python -c "import torch; print('torch', torch.__version__, 'cuda', torch.version.cuda, 'device', torch.cuda.get_device_name(0), 'capability', torch.cuda.get_device_capability(0))"
echo ">> core stack (order matters: fla pinned BEFORE anything drags 0.5.x in; causal-conv1d after) ..."
uv pip install --python $V/bin/python "transformers>=5.2" "flash-linear-attention==0.4.2"
uv pip install --python $V/bin/python causal-conv1d --no-build-isolation || echo "WARN causal-conv1d build failed — capture and fix interactively"
uv pip install --python $V/bin/python "ms-swift>=4.3.1" "megatron-core>=0.16" datasets accelerate
$V/bin/python - <<'PYEOF'
import importlib, torch
for m in ["transformers", "fla", "swift", "megatron.core"]:
    try:
        mod = importlib.import_module(m)
        print(f"OK {m} {getattr(mod, '__version__', '?')}")
    except Exception as e:
        print(f"FAIL {m}: {e}")
try:
    import causal_conv1d; print("OK causal_conv1d", getattr(causal_conv1d, "__version__", "?"))
except Exception as e:
    print("FAIL causal_conv1d:", e)
PYEOF
cp /tmp/smoke-install.log /workspace/corpus/logs/smoke-install.log 2>/dev/null || true
echo ">> INSTALL PHASE DONE"
REMOTE

cat <<EOF
============================================================================
B200 smoke pod ready for interactive assertions + mini-CPT.
POD_ID=$POD_ID  IP=$IP  PORT=$PORT   (\$6.79/hr — terminate when smoke concludes)
  terminate: curl -X DELETE -H "Authorization: Bearer \$RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/$POD_ID
============================================================================
EOF
