#!/usr/bin/env bash
# ============================================================================
# deploy_fullrun.sh — launch the full CPT run on 8x in US-NE-1 with the corpus
# volume ATTACHED. No ferry, no sidecar sync: checkpoints are written straight
# to the volume, so they survive the pod. That is the run-2 fix.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
VOL=1atl7503ky; DC=US-NE-1
IMAGE="runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=30 -i $HOME/.ssh/id_ed25519"
set -a; . "$HERE/../../.env.local"; set +a
: "${RUNPOD_API_KEY:?}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
HB_TOKEN=$(ssh -o StrictHostKeyChecking=no root@45.76.180.229 "python3 -c \"import json;print(json.load(open('/opt/hiraia-monitor/config.json'))['hb_token'])\"")
[ -n "$HB_TOKEN" ] || { echo "ERR no hb token"; exit 1; }

find_pod(){ gql "query { myself { pods { id name } } }" | python3 -c "
import json,sys
try: pods=json.load(sys.stdin)['data']['myself']['pods']
except Exception: pods=[]
for p in pods:
  if p['name']=='$1': print(p['id']); break"; }

POD=$(find_pod hiraia-fullrun)
[ -n "$POD" ] && echo ">> adopting existing $POD"
DEADLINE=$(( $(date +%s) + 7200 ))
while [ -z "$POD" ] && [ "$(date +%s)" -lt "$DEADLINE" ]; do
  D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, gpuCount: 8, gpuTypeId: \\\"NVIDIA H100 80GB HBM3\\\", dataCenterId: \\\"$DC\\\", networkVolumeId: \\\"$VOL\\\", volumeMountPath: \\\"/workspace\\\", containerDiskInGb: 200, minVcpuCount: 24, minMemoryInGb: 200, supportPublicIp: true, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"hiraia-fullrun\\\" }) { id } }")
  POD=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$POD" ] && break
  POD=$(find_pod hiraia-fullrun); [ -n "$POD" ] && break
  echo "   $(date +%H:%M) no 8xH100 in $DC, retry 3min: $(echo "$D" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p' | head -1)"; sleep 180
done
[ -n "$POD" ] || { echo "ERR: no 8x capacity in $DC within 2h"; exit 1; }
echo ">> POD=$POD"
IP=""; PORT=""
for i in $(seq 1 40); do
  P=$(gql "query { pod(input:{podId:\\\"$POD\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && break; sleep 15
done
[ -n "$PORT" ] || { echo "ERR no ssh; POD=$POD"; exit 1; }
for i in $(seq 1 30); do ssh $SSH -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done
echo "$POD $IP $PORT" > /tmp/fullrun-pod.txt
echo ">> stack (pins from PROBE-CPT-CONFIG §2) ..."
ssh $SSH -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE' || { echo "ERR stack install"; exit 1; }
set -e
export PATH="$HOME/.local/bin:$PATH"
command -v uv >/dev/null || (curl -LsSf https://astral.sh/uv/install.sh | sh); export PATH="$HOME/.local/bin:$PATH"
[ -x /root/venv-cpt/bin/python ] || uv venv --python 3.12 /root/venv-cpt
uv pip install -q --python /root/venv-cpt/bin/python "torch==2.11.0" torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install -q --python /root/venv-cpt/bin/python "transformers==5.15.1" "flash-linear-attention==0.4.2"
uv pip install -q --python /root/venv-cpt/bin/python causal-conv1d --no-build-isolation
NP=$(awk '{print ($1=="max")?64:int($1/$2)}' /sys/fs/cgroup/cpu.max)
MAX_JOBS=$NP uv pip install -q --python /root/venv-cpt/bin/python flash-attn --no-build-isolation
uv pip install -q --python /root/venv-cpt/bin/python "ms-swift==4.5.2" deepspeed datasets accelerate qwen_vl_utils liger-kernel
/root/venv-cpt/bin/python -c "import torch,fla,causal_conv1d,flash_attn,swift,deepspeed; import liger_kernel; print('stack OK,',torch.cuda.device_count(),'x',torch.cuda.get_device_name(0))"
# vision-stripped copy — ms-swift's qwen3_5 loader otherwise trains the VL tower
[ -f /root/qwen35-2b-text/model.safetensors ] || HF_HOME=/workspace/hf-cache /root/venv-cpt/bin/python - <<'PY'
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
m=AutoModelForCausalLM.from_pretrained("Qwen/Qwen3.5-2B-Base", dtype=torch.bfloat16)
assert not [k for k,_ in m.named_parameters() if "vis" in k.lower()]
m.save_pretrained("/root/qwen35-2b-text", safe_serialization=True)
AutoTokenizer.from_pretrained("Qwen/Qwen3.5-2B-Base").save_pretrained("/root/qwen35-2b-text")
print("text-only model staged")
PY
REMOTE
echo ">> bake creds + launch ..."
sed -e "s|^set -uo pipefail|set -uo pipefail\nexport RUNPOD_API_KEY=\"$RUNPOD_API_KEY\"\nexport RUNPOD_POD_ID=\"$POD\"\nexport HB_TOKEN=\"$HB_TOKEN\"|" fullrun_driver.sh > /tmp/fullrun_ready.sh
scp $SSH -P "$PORT" /tmp/fullrun_ready.sh "root@$IP:/root/fullrun_driver.sh"; rm -f /tmp/fullrun_ready.sh
ssh $SSH -p "$PORT" "root@$IP" "chmod +x /root/fullrun_driver.sh && cd /root && TARGET_STEPS=${TARGET_STEPS:-5900} BUDGET_USD=${BUDGET_USD:-800} RATE_USD_HR=26.32 setsid /root/fullrun_driver.sh > /dev/null 2>&1 < /dev/null & sleep 40; echo 'log:' \$(stat -c%s /workspace/fullrun/fullrun.log 2>/dev/null); head -6 /workspace/fullrun/fullrun.log 2>/dev/null; pgrep -f '[f]ullrun_driver' >/dev/null && echo 'DRIVER ALIVE' || echo 'DRIVER GONE'"
echo "POD=$POD IP=$IP PORT=$PORT"
