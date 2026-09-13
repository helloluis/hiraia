#!/usr/bin/env bash
# ============================================================================
# deploy_probe_anydc.sh — RUN 2 launcher (post pre-flight verdict 2026-08-23).
# Changes vs run 1: pinned stack (R-6), B200 dropped until image bump (R-9),
# idempotent provisioning — adopt existing pods, never mint orphans (R-8c),
# helper reuse-or-create with 48h TTL, zstd-compressed ferry with size
# verification (R-7/rec-2), venv install exit-checked, no key in pod env.
# Run from this Mac (BSD-sed verified). Usage: cd finetuning/cpt && ./deploy_probe_anydc.sh
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
VOLUME_ID="1atl7503ky"; HELPER_DC="US-NE-1"
IMAGE="runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"
KEY="$HOME/.ssh/id_ed25519"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -i $KEY"
ENV_LOCAL="$HERE/../../.env.local"
set -a; . "$ENV_LOCAL"; set +a
: "${RUNPOD_API_KEY:?}"
case "$RUNPOD_API_KEY" in *[\&\|\\]*) echo "ERR: API key contains sed metachars"; exit 1;; esac
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
[ -f probe_driver_anydc.sh ] || { echo "ERR: probe_driver_anydc.sh missing"; exit 1; }

MIX_BYTES=18547825376   # ferry integrity gate (R-7)

find_pod_by_name() {  # R-8c: adopt existing pods instead of minting duplicates
  gql "query { myself { pods { id name } } }" | python3 -c "
import json,sys
try: pods = json.load(sys.stdin)['data']['myself']['pods']
except Exception: pods = []
for p in pods:
    if p['name'] == '$1': print(p['id']); break"
}

wait_ssh() { # $1=pod_id -> sets WIP/WPORT
  WIP=""; WPORT=""
  for i in $(seq 1 40); do
    P=$(gql "query { pod(input:{podId:\\\"$1\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
    WPORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
    WIP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
    [ -n "$WPORT" ] && break; sleep 15
  done
  [ -n "$WPORT" ] || return 1
  for i in $(seq 1 30); do ssh $SSH -p "$WPORT" "root@$WIP" 'echo ok' 2>/dev/null | grep -q ok && return 0; sleep 10; done
  return 1
}

echo ">> [1/5] helper pod (reuse-or-create) ..."
HPOD=$(find_pod_by_name hiraia-probe-helper)
if [ -n "$HPOD" ]; then
  echo "   adopting existing helper $HPOD"
else
  for G in "NVIDIA RTX PRO 6000 Blackwell Server Edition MIG 1g.24gb" "NVIDIA H100 80GB HBM3"; do
    D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, gpuCount: 1, gpuTypeId: \\\"$G\\\", dataCenterId: \\\"$HELPER_DC\\\", networkVolumeId: \\\"$VOLUME_ID\\\", volumeMountPath: \\\"/workspace\\\", containerDiskInGb: 20, minVcpuCount: 4, minMemoryInGb: 16, supportPublicIp: true, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"hiraia-probe-helper\\\" }) { id } }")
    HPOD=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$HPOD" ] && break
    HPOD=$(find_pod_by_name hiraia-probe-helper)   # timeout-but-created guard
    [ -n "$HPOD" ] && break
  done
fi
[ -n "$HPOD" ] || { echo "ERR: no helper"; exit 1; }
echo "   helper POD_ID=$HPOD"

echo ">> [2/5] any-DC 8×H100 hunt (idempotent; B200 dropped per R-9) ..."
TPOD=$(find_pod_by_name hiraia-probe-cpt)
[ -n "$TPOD" ] && echo "   adopting existing trainer $TPOD"
DEADLINE=$(( $(date +%s) + 14400 ))
while [ -z "$TPOD" ] && [ "$(date +%s)" -lt "$DEADLINE" ]; do
  D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, gpuCount: 8, gpuTypeId: \\\"NVIDIA H100 80GB HBM3\\\", volumeInGb: 0, containerDiskInGb: 250, minVcpuCount: 32, minMemoryInGb: 256, supportPublicIp: true, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"hiraia-probe-cpt\\\" }) { id } }")
  TPOD=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$TPOD" ] && break
  TPOD=$(find_pod_by_name hiraia-probe-cpt)   # timeout-but-created guard
  [ -n "$TPOD" ] && break
  echo "   $(date +%H:%M) no 8×H100 capacity, retry 3 min ..."; sleep 180
done
[ -n "$TPOD" ] || { echo "ERR: no 8× capacity in 4h"; exit 1; }
echo "   trainer POD_ID=$TPOD"

echo ">> [3/5] SSH on both ..."
wait_ssh "$HPOD" || { echo "ERR helper ssh"; exit 1; }; HIP=$WIP; HPORT=$WPORT
echo "   helper root@$HIP:$HPORT"
wait_ssh "$TPOD" || { echo "ERR trainer ssh"; exit 1; }; TIP=$WIP; TPORT=$WPORT
echo "   trainer root@$TIP:$TPORT"

echo ">> [3b] helper 48h TTL (baked creds — env injection unreliable) ..."
ssh $SSH -p "$HPORT" "root@$HIP" "pgrep -f 'ttl-run2' >/dev/null || { printf '%s\n' 'sleep 172800' 'curl -s --max-time 30 -X DELETE -H \"Authorization: Bearer $RUNPOD_API_KEY\" https://rest.runpod.io/v1/pods/$HPOD' > /root/ttl-run2.sh; chmod +x /root/ttl-run2.sh; nohup bash /root/ttl-run2.sh >/dev/null 2>&1 </dev/null & disown; }; echo TTL-OK"

echo ">> [4/5] key exchange + compressed ferry + verified venv ..."
ssh $SSH -p "$TPORT" "root@$TIP" 'test -f /root/.ssh/id_ed25519 || ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519 -q; cat /root/.ssh/id_ed25519.pub' > /tmp/trainer-key.pub
ssh $SSH -p "$HPORT" "root@$HIP" "mkdir -p /root/.ssh && echo '$(cat /tmp/trainer-key.pub)' >> /root/.ssh/authorized_keys"
ssh $SSH -p "$HPORT" "root@$HIP" 'command -v zstd >/dev/null || (apt-get update -qq && apt-get install -y -qq zstd rsync) ; M=/workspace/corpus/tokenized/probe-mix-v1; test -s $M/probe-mix.jsonl.zst || zstd -T0 -3 -k $M/probe-mix.jsonl -o $M/probe-mix.jsonl.zst; ls -la $M/probe-mix.jsonl.zst'
ssh $SSH -p "$TPORT" "root@$TIP" "command -v zstd >/dev/null || (apt-get update -qq && apt-get install -y -qq zstd rsync); mkdir -p /root/data && rsync -a --partial -e 'ssh -o StrictHostKeyChecking=no -p $HPORT -i /root/.ssh/id_ed25519' root@$HIP:/workspace/corpus/tokenized/probe-mix-v1/probe-mix.jsonl.zst /root/data/ && zstd -d -T0 --rm /root/data/probe-mix.jsonl.zst && SZ=\$(stat -c%s /root/data/probe-mix.jsonl) && [ \"\$SZ\" = \"$MIX_BYTES\" ] && echo FERRY-VERIFIED-\$SZ || { echo FERRY-SIZE-MISMATCH-\$SZ; exit 1; }" || { echo "ERR: ferry failed"; exit 1; }
ssh $SSH -p "$TPORT" "root@$TIP" 'bash -s' <<'REMOTE' || { echo "ERR: venv install failed"; exit 1; }
set -e
export PATH="$HOME/.local/bin:$PATH"
command -v uv >/dev/null || (curl -LsSf https://astral.sh/uv/install.sh | sh)
export PATH="$HOME/.local/bin:$PATH"
uv venv --python 3.12 /root/venv-cpt
uv pip install --python /root/venv-cpt/bin/python "torch==2.11.0" torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install --python /root/venv-cpt/bin/python "transformers==5.15.1" "flash-linear-attention==0.4.2"
uv pip install --python /root/venv-cpt/bin/python causal-conv1d --no-build-isolation
NPROC=$(awk '{print ($1=="max") ? 64 : int($1/$2)}' /sys/fs/cgroup/cpu.max)
MAX_JOBS=$NPROC uv pip install --python /root/venv-cpt/bin/python flash-attn --no-build-isolation
uv pip install --python /root/venv-cpt/bin/python "ms-swift==4.5.2" "deepspeed" datasets accelerate qwen_vl_utils
/root/venv-cpt/bin/python -c "import torch, fla, causal_conv1d, flash_attn, swift, deepspeed; print('stack OK,', torch.cuda.device_count(), 'GPUs,', torch.cuda.get_device_name(0))"
# strip the VL tower: save a PHYSICALLY text-only model copy (ms-swift's qwen3_5 loader
# otherwise trains the vision tower — caught by the ckpt name-scan gate on 08-23)
HF_HOME=/root/hf-cache /root/venv-cpt/bin/python - <<'PYSTRIP'
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
m = AutoModelForCausalLM.from_pretrained("Qwen/Qwen3.5-2B-Base", dtype=torch.bfloat16)
assert not [k for k,_ in m.named_parameters() if "visual" in k.lower() or "vision" in k.lower()]
m.save_pretrained("/root/qwen35-2b-text", safe_serialization=True)
AutoTokenizer.from_pretrained("Qwen/Qwen3.5-2B-Base").save_pretrained("/root/qwen35-2b-text")
print("text-only model staged at /root/qwen35-2b-text")
PYSTRIP
REMOTE

echo ">> [5/5] driver bake + launch ..."
sed -e "s/@HELPER_IP@/$HIP/g; s/@HELPER_PORT@/$HPORT/g; s|^set -uo pipefail|set -uo pipefail\nexport RUNPOD_API_KEY=\"$RUNPOD_API_KEY\"\nexport RUNPOD_POD_ID=\"$TPOD\"|" probe_driver_anydc.sh > /tmp/probe_driver_ready.sh
scp $SSH -P "$TPORT" /tmp/probe_driver_ready.sh "root@$TIP:/root/probe_driver.sh"
rm -f /tmp/probe_driver_ready.sh
ssh $SSH -p "$TPORT" "root@$TIP" 'chmod +x /root/probe_driver.sh && nohup /root/probe_driver.sh > /dev/null 2>&1 & echo "DRIVER PID $!"'

cat <<EOF
============================================================================
RUN 2 LAUNCHED (full-param, zero2, 4.19M batch, WSD, all gates armed).
  trainer: POD_ID=$TPOD root@$TIP:$TPORT   monitor: ssh -p $TPORT root@$TIP 'tail -f /root/probe-cpt-run2.log'
  helper:  POD_ID=$HPOD root@$HIP:$HPORT (48h TTL armed)
============================================================================
EOF
