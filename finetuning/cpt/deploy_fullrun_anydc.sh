#!/usr/bin/env bash
# ============================================================================
# deploy_fullrun_anydc.sh — full CPT run in WHICHEVER datacenter has an 8x node,
# while KEEPING the durability fix: a network volume is created in that same DC
# and attached, so checkpoints are written straight to storage that outlives the
# pod. Waiting for one specific DC to free up is not worth the setup it saves.
#
# DC-level "available" != 8x-on-one-node available, so we probe by attempting a
# real provision per DC and only create the volume where a node materialises.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
IMG_HOPPER="runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"
IMG_BLACKWELL="${IMG_BLACKWELL:-runpod/pytorch:2.8.0-py3.11-cuda12.8.1-devel-ubuntu22.04}"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=30 -i $HOME/.ssh/id_ed25519"
VOL_GB=${VOL_GB:-200}
set -a; . "$HERE/../../.env.local"; set +a
: "${RUNPOD_API_KEY:?}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
rest(){ curl -s --max-time 40 -X "$1" -H "Authorization: Bearer $RUNPOD_API_KEY" -H "User-Agent: hiraia/1.0" "https://rest.runpod.io/v1/$2" ${3:+-H 'Content-Type: application/json' -d "$3"}; }
HB_TOKEN=$(ssh -o StrictHostKeyChecking=no root@45.76.180.229 "python3 -c \"import json;print(json.load(open('/opt/hiraia-monitor/config.json'))['hb_token'])\"")
[ -n "$HB_TOKEN" ] || { echo "ERR no hb token"; exit 1; }
read -r SPOD SIP SPORT < /tmp/mixsrc-pod.txt || { echo "ERR: run prep_src first"; exit 1; }

# EU before APAC: shorter hop from US-NE-1 for the 20GB mix.
# B200 is ~2.25x faster at ~2x the hourly rate => same $/token, far less wall-clock.
DCS=${DCS:-"US-NE-1 US-NC-2 EU-RO-1 EU-FR-1 EUR-IS-3 EUR-NO-2 AP-JP-1 AP-IN-2"}
GPUS=${GPUS:-"NVIDIA H100 80GB HBM3|NVIDIA B200"}
POD=""; DC=""; VOLID=""; GPU=""; RATE=26.32
DEADLINE=$(( $(date +%s) + 5400 ))
while [ -z "$POD" ] && [ "$(date +%s)" -lt "$DEADLINE" ]; do
  for d in $DCS; do
    V=$(rest POST networkvolumes "{\"name\":\"hiraia-fullrun-$d\",\"size\":$VOL_GB,\"dataCenterId\":\"$d\"}")
    VID=$(echo "$V" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$VID" ] || { echo "   $d: no volume ($(echo "$V" | head -c 90))"; continue; }
    OLDIFS=$IFS; IFS='|'
    for g in $GPUS; do
      IFS=$OLDIFS
      case "$g" in *B200*) IMG="$IMG_BLACKWELL"; ARCH=blackwell;; *) IMG="$IMG_HOPPER"; ARCH=hopper;; esac
      D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, gpuCount: 8, gpuTypeId: \\\"$g\\\", dataCenterId: \\\"$d\\\", networkVolumeId: \\\"$VID\\\", volumeMountPath: \\\"/workspace\\\", containerDiskInGb: 200, minVcpuCount: 24, minMemoryInGb: 200, supportPublicIp: true, imageName: \\\"$IMG\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"hiraia-fullrun\\\" }) { id } }")
      POD=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
      if [ -n "$POD" ]; then DC="$d"; VOLID="$VID"; GPU="$g"; RATE=$([ "$ARCH" = blackwell ] && echo 54.32 || echo 26.32)
        echo ">> 8x ${g#NVIDIA } in $d ($ARCH, pod $POD, vol $VID, \$$RATE/hr)"; break; fi
      IFS='|'
    done
    IFS=$OLDIFS
    [ -n "$POD" ] && break
    echo "   $d: no 8x node (tried ${GPUS//|/, }) — releasing volume"; rest DELETE "networkvolumes/$VID" >/dev/null
  done
  [ -z "$POD" ] && { echo "   $(date +%H:%M) no 8x anywhere yet, retry 3min"; sleep 180; }
done
[ -n "$POD" ] || { echo "ERR: no 8x capacity in any DC within 90min"; exit 1; }

IP=""; PORT=""
for i in $(seq 1 40); do
  P=$(gql "query { pod(input:{podId:\\\"$POD\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && break; sleep 15
done
[ -n "$PORT" ] || { echo "ERR no ssh; POD=$POD"; exit 1; }
for i in $(seq 1 30); do ssh $SSH -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done
echo "$POD $IP $PORT $DC $VOLID" > /tmp/fullrun-pod.txt
echo ">> pod ready in $DC: $IP:$PORT"

# key exchange, then START THE TRANSFER IN BACKGROUND so the stack install overlaps it
ssh $SSH -p "$PORT" "root@$IP" 'test -f /root/.ssh/id_ed25519 || ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519 -q; cat /root/.ssh/id_ed25519.pub' > /tmp/fr.pub
ssh $SSH -p "$SPORT" "root@$SIP" "mkdir -p /root/.ssh && echo '$(cat /tmp/fr.pub)' >> /root/.ssh/authorized_keys"
ssh $SSH -p "$PORT" "root@$IP" 'command -v zstd >/dev/null || (apt-get update -qq && apt-get install -y -qq zstd rsync) >/dev/null 2>&1; mkdir -p /workspace/fullmix/mix-v1 /workspace/fullrun'
sed -e "s|@SPORT@|$SPORT|g; s|@SIP@|$SIP|g" pull_mix.sh.tmpl > /tmp/pull_mix.sh
scp $SSH -P "$PORT" /tmp/pull_mix.sh "root@$IP:/root/pull_mix.sh"; rm -f /tmp/pull_mix.sh
ssh $SSH -p "$PORT" "root@$IP" 'chmod +x /root/pull_mix.sh && setsid /root/pull_mix.sh > /workspace/fullmix/pull.log 2>&1 < /dev/null & echo "TRANSFER STARTED (background, overlaps stack install)"'

echo ">> stack install (overlaps the transfer) ..."
ssh $SSH -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE' || { echo "ERR stack"; exit 1; }
set -e
export PATH="$HOME/.local/bin:$PATH"
command -v uv >/dev/null || (curl -LsSf https://astral.sh/uv/install.sh | sh); export PATH="$HOME/.local/bin:$PATH"
[ -x /root/venv-cpt/bin/python ] || uv venv --python 3.12 /root/venv-cpt
uv pip install -q --python /root/venv-cpt/bin/python "torch==2.11.0" torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install -q --python /root/venv-cpt/bin/python "transformers==5.15.1" "flash-linear-attention==0.4.2"
uv pip install -q --python /root/venv-cpt/bin/python causal-conv1d --no-build-isolation
NP=$(awk '{print ($1=="max")?64:int($1/$2)}' /sys/fs/cgroup/cpu.max)
CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1)
echo "compute capability $CAP; nvcc: $(nvcc --version 2>/dev/null | tail -1 || echo none)"
case "$CAP" in
  10.*|12.*) export TORCH_CUDA_ARCH_LIST="10.0"
             nvcc --version 2>/dev/null | grep -qE "release 12\.(8|9)|release 1[3-9]" || \
               echo "WARNING: nvcc may predate sm_100 support — flash-attn build may fail";;
  *)         export TORCH_CUDA_ARCH_LIST="9.0";;
esac
MAX_JOBS=$NP uv pip install -q --python /root/venv-cpt/bin/python flash-attn --no-build-isolation
uv pip install -q --python /root/venv-cpt/bin/python "ms-swift==4.5.2" deepspeed datasets accelerate qwen_vl_utils liger-kernel
/root/venv-cpt/bin/python -c "import torch,fla,causal_conv1d,flash_attn,swift,deepspeed,liger_kernel; print('stack OK,',torch.cuda.device_count(),'x',torch.cuda.get_device_name(0))"
[ -f /root/qwen35-2b-text/model.safetensors ] || HF_HOME=/workspace/hf-cache /root/venv-cpt/bin/python - <<'PY'
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
m=AutoModelForCausalLM.from_pretrained("Qwen/Qwen3.5-2B-Base", dtype=torch.bfloat16)
assert not [k for k,_ in m.named_parameters() if "vis" in k.lower()]
m.save_pretrained("/root/qwen35-2b-text", safe_serialization=True)
AutoTokenizer.from_pretrained("Qwen/Qwen3.5-2B-Base").save_pretrained("/root/qwen35-2b-text")
print("text-only model staged")
PY
echo "--- waiting for mix transfer to finish ---"
for i in $(seq 1 120); do [ -f /workspace/fullmix/MIX_READY ] && { echo "MIX READY"; break; }; sleep 30; done
ls -la /workspace/fullmix/mix-v1/ | tail -3
REMOTE
echo ">> bake creds + launch driver ..."
sed -e "s|^set -uo pipefail|set -uo pipefail\nexport RUNPOD_API_KEY=\"$RUNPOD_API_KEY\"\nexport RUNPOD_POD_ID=\"$POD\"\nexport HB_TOKEN=\"$HB_TOKEN\"|" fullrun_driver.sh > /tmp/fr_ready.sh
scp $SSH -P "$PORT" /tmp/fr_ready.sh "root@$IP:/root/fullrun_driver.sh"; rm -f /tmp/fr_ready.sh
ssh $SSH -p "$PORT" "root@$IP" "chmod +x /root/fullrun_driver.sh && cd /root && TARGET_STEPS=${TARGET_STEPS:-5900} BUDGET_USD=${BUDGET_USD:-740} RATE_USD_HR=${RATE:-26.32} setsid /root/fullrun_driver.sh > /dev/null 2>&1 < /dev/null & sleep 40; head -8 /workspace/fullrun/fullrun.log 2>/dev/null; pgrep -f '[f]ullrun_driver' >/dev/null && echo 'DRIVER ALIVE' || echo 'DRIVER GONE'"
echo "POD=$POD DC=$DC GPU=$GPU RATE=$RATE VOL=$VOLID IP=$IP PORT=$PORT"
