#!/usr/bin/env bash
# Fetched over HTTPS by the pod at container start (see autograb.py dockerArgs) and run
# unattended. Rebuilds the stack, restores the tokenised cache from the volume, and starts
# training on the greenlight that is already armed. No LLM, no laptop, no SSH session.
exec > >(tee -a /workspace/fullrun/bootstrap.log) 2>&1
echo "=== BOOTSTRAP $(date -u +%FT%TZ) pod=${RUNPOD_POD_ID:-unknown} ==="
set -uo pipefail
KEY="__RUNPOD_KEY__"; TOK="__HB_TOKEN__"
PID_="${RUNPOD_POD_ID:-}"
cat > /root/runenv.sh <<EOF
export RUNPOD_API_KEY="$KEY"
export HB_TOKEN="$TOK"
export RUNPOD_POD_ID="$PID_"
EOF
chmod 600 /root/runenv.sh
hb(){ curl -s -m 10 -X POST https://hiraia.b11.dev/admin/api/hb -H "X-Token: $TOK" \
  -H 'Content-Type: application/json' \
  -d "{\"pod_id\":\"$PID_\",\"step\":${1:-0},\"total_steps\":${2:-0},\"kind\":\"$3\",\"phase\":\"$3\",\"note\":\"$4\"}" >/dev/null 2>&1 || true; }
die(){ echo "FATAL: $*"; hb 0 0 boot "BOOTSTRAP FAILED: $*"
  curl -s -m 30 -X DELETE -H "Authorization: Bearer $KEY" "https://rest.runpod.io/v1/pods/$PID_"; exit 1; }
mkdir -p /workspace/fullrun
hb 0 0 boot "bootstrapping: rebuilding stack"

# keep the liveness guard fed for the whole bootstrap (it can take ~40 min)
( while [ ! -e /workspace/fullrun/TRAINING_STARTED ]; do
    hb 0 0 boot "bootstrapping (venv/cache restore)"; sleep 60; done ) &

# Two paths, detected rather than declared (a marker on disk beats a flag we might pass wrong):
#  FAST  - this is the volume's own datacenter: mix and tokenised cache are already here.
#  FRESH - a new volume in another datacenter: pull the mix from the HF archive and tokenise.
if [ -d /workspace/fullrun/ds-cache-backup ] && [ -s /workspace/fullmix/mix-v1/full-mix.jsonl ]; then
  MODE=fast
  echo ">> FAST path: restoring the tokenised cache from the volume (skips tokenisation)"
  mkdir -p /root/.cache/modelscope
  rsync -a /workspace/fullrun/ds-cache-backup/ /root/.cache/modelscope/ || die "cache restore failed"
  echo ">> cache restored: $(du -sh /root/.cache/modelscope | cut -f1)"
  # The cache fingerprint depends on num_proc, so the run MUST use the same value the cache
  # was built with (160) or datasets will silently re-tokenise for ~6h.
  echo 160 > /workspace/fullrun/NUM_PROC
else
  MODE=fresh
  echo ">> FRESH path: no cache here; pulling the mix from the HF archive"
  hb 0 0 boot "fresh datacenter: downloading the mix from HF"
  mkdir -p /workspace/fullmix/mix-v1 /workspace/fullrun
  if [ ! -s /workspace/fullmix/mix-v1/full-mix.jsonl ]; then
    pip install -q -U "huggingface_hub[hf_transfer]" || die "huggingface_hub"
    command -v zstd >/dev/null || { apt-get update -qq && apt-get install -y -qq zstd; }
    HF_HUB_ENABLE_HF_TRANSFER=1 python3 - <<'PYHF' || die "mix download"
import os
from huggingface_hub import hf_hub_download
p = hf_hub_download("Cryptopop/hiraia-cpt-corpus-archive", "mix-v1/full-mix.jsonl.zst",
                    repo_type="dataset", token="__HF_TOKEN__", local_dir="/root/mixdl")
print("downloaded", p)
open("/root/mixpath","w").write(p)
PYHF
    zstd -d -q -o /workspace/fullmix/mix-v1/full-mix.jsonl "$(cat /root/mixpath)" || die "decompress"
    rm -f "$(cat /root/mixpath)"
  fi
  S=$(stat -c %s /workspace/fullmix/mix-v1/full-mix.jsonl)
  [ "$S" = "21730569538" ] || die "mix size $S != 21730569538 after download"
  echo ">> mix restored byte-exact at the canonical path"
  # No cache to match, so use a worker count that does not collapse. Measured 2026-08-24:
  # 160 workers = 930 ex/s, SLOWER than one core (1,973 ex/s). Fewer is faster here.
  echo 8 > /workspace/fullrun/NUM_PROC
  # Write the measured canary values directly. Fetching them was fragile (mixing the admin
  # X-Token with HF auth returned "Repository not found", which json.load then swallowed --
  # silently disabling Liger and making the run slower than the budget assumed).
  cat > /workspace/fullrun/CANARY-RESULT.json <<'EOSC'
{"sec_per_step": 41.780799, "memory_gib": 33.47, "liger": "yes",
 "measured_utc": "2026-08-24T11:08:16Z",
 "note": "measured on 8xH100 SXM, 25 canary steps, Liger enabled"}
EOSC
  python3 -c "import json;json.load(open('/workspace/fullrun/CANARY-RESULT.json'))" || die "canary json"
fi
echo ">> MODE=$MODE num_proc=$(cat /workspace/fullrun/NUM_PROC)"

echo ">> building the stack"
command -v uv >/dev/null || pip install -q uv || die "uv install failed"
[ -x /root/venv-cpt/bin/python ] || uv venv --python 3.12 /root/venv-cpt || die "venv"
V=/root/venv-cpt/bin/python
uv pip install -q --python $V "torch==2.11.0" torchvision --index-url https://download.pytorch.org/whl/cu128 || die "torch"
uv pip install -q --python $V "transformers==5.15.1" "flash-linear-attention==0.4.2" || die "transformers/fla"
uv pip install -q --python $V causal-conv1d --no-build-isolation || die "causal-conv1d"
NP=$(python3 -c "
try:
    q,p=open('/sys/fs/cgroup/cpu.max').read().split()
    print(max(1,int(int(q)/int(p))-2) if q!='max' else 8)
except Exception: print(8)")
export TORCH_CUDA_ARCH_LIST="9.0"
MAX_JOBS=$NP uv pip install -q --python $V flash-attn --no-build-isolation || die "flash-attn"
uv pip install -q --python $V "ms-swift==4.5.2" deepspeed datasets accelerate qwen_vl_utils liger-kernel || die "swift"
$V -c "import torch,fla,causal_conv1d,flash_attn,swift,deepspeed,liger_kernel;
assert torch.cuda.device_count()==8, torch.cuda.device_count()
print('stack OK,',torch.cuda.device_count(),'x',torch.cuda.get_device_name(0))" || die "stack verify / not 8 GPUs"

echo ">> rebuilding the vision-stripped text model"
[ -f /root/qwen35-2b-text/model.safetensors ] || HF_HOME=/workspace/hf-cache $V - <<'PY' || die "model strip"
from transformers import AutoModelForCausalLM, AutoTokenizer
import torch
m = AutoModelForCausalLM.from_pretrained("Qwen/Qwen3.5-2B-Base", dtype=torch.bfloat16)
lm = getattr(m, "language_model", None) or m
lm.save_pretrained("/root/qwen35-2b-text", safe_serialization=True)
AutoTokenizer.from_pretrained("Qwen/Qwen3.5-2B-Base").save_pretrained("/root/qwen35-2b-text")
n = sum(p.numel() for p in lm.parameters()); assert 1.7e9 < n < 2.1e9, n
print(f"text-only {n/1e9:.2f}B")
PY

curl -s -m 20 -H "X-Token: $TOK" https://hiraia.b11.dev/admin/api/launcher -o /root/launcher.sh || die "fetch launcher"
curl -s -m 20 -H "X-Token: $TOK" https://hiraia.b11.dev/admin/api/hbvals  -o /root/hbvals.py || die "fetch hbvals"
chmod +x /root/launcher.sh
bash -n /root/launcher.sh || die "launcher does not parse"
echo ">> launching (greenlight is already armed)"
touch /workspace/fullrun/GREENLIGHT /workspace/fullrun/TRAINING_STARTED
setsid nohup /root/launcher.sh >/dev/null 2>&1 </dev/null &
echo "=== BOOTSTRAP DONE $(date -u +%FT%TZ) ==="
