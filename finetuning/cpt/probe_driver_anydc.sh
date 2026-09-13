#!/usr/bin/env bash
# ============================================================================
# probe_driver_anydc.sh — probe CPT RUN 2 (full-param) on an any-DC 8× pod.
# Incorporates the 2026-08-23 pre-flight verdict (10 required fixes; see
# PROBE-CPT-CONFIG.md changelog). Data ferried to /root/data; checkpoints sync
# to the helper (corpus volume) via sidecar; VERIFIED self-termination that
# refuses to delete the pod if the final sync failed.
# @HELPER_IP@ / @HELPER_PORT@ sed-substituted at deploy; creds sed-baked below.
# ============================================================================
set -uo pipefail
V=/root/venv-cpt
MODEL="${MODEL:-/root/qwen35-2b-text}"  # PHYSICALLY text-only copy (08-23: ms-swift VL loader trains the vision tower off the raw HF repo — strip first via AutoModelForCausalLM save_pretrained)
MIX=/root/data/probe-mix.jsonl
CANARY_MIX=/root/data/canary-mix.jsonl
OUT=/root/probe-out
LOG=/root/probe-cpt-run2.log
HELPER="root@@HELPER_IP@"
HP=@HELPER_PORT@
HSSH="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=30 -i /root/.ssh/id_ed25519 -p $HP"
exec > >(tee -a "$LOG") 2>&1
echo "=== RUN-2 DRIVER START $(date -u +%FT%TZ) ==="

terminate() {  # R-4: never delete the pod on a failed artifact sync
  echo ">> final sync (retry x3) $(date -u +%FT%TZ)"
  local SRC=()
  [ -d "$OUT" ] && SRC+=("$OUT/")
  for d in /root/canary-C /root/canary-A /root/canary-CK; do [ -d "$d" ] && SRC+=("$d"); done
  local ok=1
  if [ ${#SRC[@]} -eq 0 ]; then
    echo ">> no artifacts to sync (pre-training failure) — syncing log only"
    rsync -a --partial -e "$HSSH" "$LOG" "$HELPER:/workspace/corpus/logs/probe-cpt-run2.log" || true
    ok=0
  else
    for i in 1 2 3; do
      rsync -a --partial -e "$HSSH" "${SRC[@]}" "$HELPER:/workspace/probe-cpt-run2/" && \
      rsync -a --partial -e "$HSSH" "$LOG" "$HELPER:/workspace/corpus/logs/probe-cpt-run2.log" \
        && { ok=0; break; }
      echo ">> sync attempt $i failed; retrying in 60s"; sleep 60
    done
  fi
  if [ "$ok" -ne 0 ]; then
    echo ">> SYNC FAILED 3x — NOT terminating (manual collection needed: pod $RUNPOD_POD_ID)"
    return 1
  fi
  curl -s --max-time 30 -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" \
    "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID" -w "terminate HTTP %{http_code}\n"
}
die() { echo "FATAL: $*"; terminate; exit 1; }

# --- assertions (R-7: every exit terminates; R-10: vision scan + version floors) ---
: "${RUNPOD_API_KEY:?}" || die "no API key"
: "${RUNPOD_POD_ID:?}" || die "no pod id"
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 -H "Authorization: Bearer $RUNPOD_API_KEY" "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID")
[ "$C" = "200" ] || die "terminate dry-check HTTP $C"
$HSSH "$HELPER" 'echo helper-link OK && mkdir -p /workspace/probe-cpt-run2' || die "helper unreachable"
[ -s "$MIX" ] || die "mix missing"
head -n 50000 "$MIX" > "$CANARY_MIX"   # R-2: canaries preprocess a subset in minutes
$V/bin/python - <<'PYEOF' || die "env preflight failed"
import torch, importlib
import transformers, fla
assert tuple(int(x) for x in transformers.__version__.split(".")[:2]) >= (5, 9), transformers.__version__
assert fla.__version__ >= "0.4.2", fla.__version__
for m in ["causal_conv1d", "flash_attn"]:
    importlib.import_module(m)
assert torch.cuda.device_count() == 8, f"{torch.cuda.device_count()} GPUs"
from transformers import AutoConfig, AutoTokenizer
assert len(AutoTokenizer.from_pretrained("/root/qwen35-2b-text")) >= 248000
# The HF checkpoint FILES carry a vision tower (stripped by the text loader) —
# assert on the ARCHITECTURE GRAPH the causal-LM class builds, not the files.
from transformers import AutoModelForCausalLM
import torch as _t
with _t.device("meta"):
    _m = AutoModelForCausalLM.from_config(AutoConfig.from_pretrained("/root/qwen35-2b-text"))
_names = [n for n, _ in _m.named_parameters()]
_vis = [n for n in _names if "visual" in n.lower() or "vision" in n.lower()]
assert not _vis, f"vision params IN TEXT GRAPH: {_vis[:3]}"
_total = sum(p.numel() for _, p in _m.named_parameters())
assert 1.7e9 < _total < 2.1e9, f"unexpected param count {_total}"
print(f"ASSERT env/kernels/8GPU/vocab OK; text graph {_total/1e9:.2f}B params, 0 vision")
PYEOF

assert_full_ckpt() {  # LoRA guard (lower bound) + vision-bloat guard (upper bound) — LATEST ckpt only (08-23: dir-total summed 3 ckpts)
  local CKDIR=$(ls -td "$1"/v*/checkpoint-* 2>/dev/null | head -1)
  [ -n "$CKDIR" ] || { echo "ASSERT FAIL: no checkpoint dir under $1"; return 1; }
  local SZ=$(find "$CKDIR" -name "*.safetensors" -exec du -b {} + 2>/dev/null | awk '{s+=$1} END {printf "%.0f", s+0}')
  [ "$SZ" -ge 3000000000 ] || { echo "ASSERT FAIL: ckpt $SZ bytes — NOT full-param"; return 1; }
  [ "$SZ" -le 6000000000 ] || { echo "ASSERT FAIL: ckpt $SZ bytes — unexpectedly large (vision bloat?)"; return 1; }
  # definitive: scan what swift ACTUALLY SAVED for vision tensors (its loader is VL-family-aware)
  local CK=$(find "$CKDIR" -name "model.safetensors.index.json" | head -1)
  if [ -n "$CK" ] && grep -qiE '"model\.(visual|vision)' "$CK"; then
    echo "ASSERT FAIL: swift saved VISION tensors — its loader pulled the VL tower into training"; return 1
  fi
  echo "ASSERT full-param checkpoint OK ($SZ bytes, no vision tensors)"
}
gpu_drain() {  # R-8b + 08-23 zombie lesson: workers run as swift/cli/pt.py — kill them too, and fail hard
  pkill -9 -f "swift/cli/pt.py" 2>/dev/null; pkill -9 -f torchrun 2>/dev/null
  pkill -9 -f "torch.distributed" 2>/dev/null; sleep 20
  for i in $(seq 1 15); do
    nvidia-smi --query-compute-apps=pid --format=csv,noheader 2>/dev/null | while read -r P; do kill -9 "$P" 2>/dev/null; done
    sleep 15
    USED=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | sort -rn | head -1)
    [ "${USED:-99999}" -lt 2000 ] && return 0
  done
  echo "DRAIN FAIL: GPU memory stuck at ${USED}MiB — aborting (doomed rungs burn money)"
  return 1
}

run_train() {  # $1=bs $2=ga $3=max_steps $4=outdir $5=save_steps $6=dataset $7=extra
  HF_HOME=/root/hf-cache NPROC_PER_NODE=8 timeout "${TRAIN_TIMEOUT:-5400}" $V/bin/swift pt \
    --model "$MODEL" --tuner_type full \
    --deepspeed zero2 \
    --dataset "$6" --columns '{"text": "text"}' \
    --dataset_num_proc 32 --packing_num_proc 32 --load_from_cache_file true \
    --packing true --attn_impl flash_attn --max_length 4096 \
    --torch_dtype bfloat16 \
    --learning_rate 8e-5 --warmup_steps 100 \
    --lr_scheduler_type warmup_stable_decay \
    --lr_scheduler_kwargs '{"num_decay_steps": 185, "min_lr_ratio": 0.1}' \
    --adam_beta1 0.9 --adam_beta2 0.95 --weight_decay 0.1 --max_grad_norm 1.0 \
    --max_steps "$3" \
    --per_device_train_batch_size "$1" --gradient_accumulation_steps "$2" \
    ${7:-} \
    --save_strategy steps --save_steps "$5" --save_only_model true --save_total_limit 12 \
    --logging_steps 5 \
    --output_dir "$4"
}

canary_gates() {  # R-5: memory + cost projection + sanity, from the canary's own log lines
  local DIR=$1
  local J=$(ls -t $DIR/v*/logging.jsonl 2>/dev/null | head -1)
  [ -n "$J" ] || { echo "GATE FAIL: no logging.jsonl"; return 1; }
  $V/bin/python - "$J" <<'PYEOF'
import json, sys
raw = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
rows = [r for r in raw if "loss" in r and "grad_norm" in r]          # step rows only
assert len(rows) >= 6, f"GATE FAIL: only {len(rows)} step rows"
mem_vals = [float(r["memory(GiB)"]) for r in rows if "memory(GiB)" in r]
assert mem_vals, "GATE FAIL: no memory readings"
mem = max(mem_vals[-3:])
assert mem <= 72, f"GATE FAIL: memory {mem} GiB > 72"
speeds = [float(r["train_speed(s/it)"]) for r in rows if "train_speed(s/it)" in r]
if speeds:
    sec_it = speeds[-1]
else:                                                                 # fallback: summary runtime
    summ = [r for r in raw if "train_runtime" in r]
    assert summ, "GATE FAIL: no speed source"
    sec_it = float(summ[-1]["train_runtime"]) / max(int(rows[-1].get("global_step/max_steps", "60/60").split("/")[0]), 1)
losses = [float(r["loss"]) for r in rows]
assert all(l == l and l < 20 for l in losses), "GATE FAIL: loss NaN/absurd"
assert losses[-1] < losses[0] + 0.05, f"GATE FAIL: loss not decreasing ({losses[0]}->{losses[-1]})"
gn = [float(r.get("grad_norm", 0)) for r in rows[-3:]]
assert max(gn) < 10.0, f"GATE FAIL: grad_norm {max(gn)}"
print(f"GATES OK: mem {mem} GiB, s/it {sec_it}, loss {losses[0]:.3f}->{losses[-1]:.3f}")
print(f"SEC_IT={sec_it}")
PYEOF
}

# --- sidecar: sync only quiesced checkpoints (rec-4) every 15 min ---
( while true; do sleep 900
    find "$OUT" -maxdepth 2 -type d -name "checkpoint-*" -mmin +5 2>/dev/null | while read -r d; do
      rsync -a --partial -e "$HSSH" "$d" "$HELPER:/workspace/probe-cpt-run2/" 2>/dev/null || true
    done
    rsync -a --partial -e "$HSSH" "$LOG" "$HELPER:/workspace/corpus/logs/probe-cpt-run2.log" 2>/dev/null || true
  done ) & SIDECAR=$!

# --- canary ladder (R-1/R-3/R-5): zero2 bs2ga64 → zero2 bs1ga128 → zero2 bs2+ckpt ---
# FULL_ONLY=1: skip the ladder (canary C already passed N times); gates run against
# the newest existing canary-C output, then commit directly at the C configuration.
BS=""; GA=""; EXTRA=""
if [ "${FULL_ONLY:-0}" = 1 ]; then
  echo ">> FULL_ONLY: validating gates against existing canary-C output ..."
  assert_full_ckpt /root/canary-C || { kill $SIDECAR 2>/dev/null; die "FULL_ONLY: ckpt assert failed"; }
  canary_gates /root/canary-C | tee -a /dev/null || { kill $SIDECAR 2>/dev/null; die "FULL_ONLY: gates failed"; }
  BS=2; GA=64
  echo ">> FULL_ONLY: committing at bs2 ga64"
fi
if [ -z "$BS" ]; then
echo ">> canary C: zero2 bs2 ga64, 60 steps on 50k-doc subset ..."
if TRAIN_TIMEOUT=5400 run_train 2 64 60 /root/canary-C 25 "$CANARY_MIX" "" \
   && assert_full_ckpt /root/canary-C && canary_gates /root/canary-C; then
  BS=2; GA=64; echo ">> canary C PASSED"
else
  gpu_drain || { kill $SIDECAR 2>/dev/null; die "GPU drain failed before canary A"; }
  echo ">> canary A: zero2 bs1 ga128 ..."
  if TRAIN_TIMEOUT=5400 run_train 1 128 60 /root/canary-A 25 "$CANARY_MIX" "" \
     && assert_full_ckpt /root/canary-A && canary_gates /root/canary-A; then
    BS=1; GA=128; echo ">> canary A PASSED"
  else
    gpu_drain || { kill $SIDECAR 2>/dev/null; die "GPU drain failed before canary CK"; }
    echo ">> canary CK (last resort): zero2 bs2 ga64 + grad-ckpt ..."
    if TRAIN_TIMEOUT=5400 run_train 2 64 60 /root/canary-CK 25 "$CANARY_MIX" "--gradient_checkpointing true" \
       && assert_full_ckpt /root/canary-CK && canary_gates /root/canary-CK; then
      BS=2; GA=64; EXTRA="--gradient_checkpointing true"; echo ">> canary CK PASSED"
    else
      kill $SIDECAR 2>/dev/null; die "all canaries failed"
    fi
  fi
fi
fi
gpu_drain || { kill $SIDECAR 2>/dev/null; die "GPU drain failed before full run"; }

# cost-projection gate (R-5): read winning canary s/it → abort if projected > 18h
WIN=$(ls -d /root/canary-CK /root/canary-A /root/canary-C 2>/dev/null | head -1)
SEC_IT=$(grep -h "^SEC_IT=" "$LOG" | tail -1 | cut -d= -f2)
if [ -n "${SEC_IT:-}" ]; then
  PROJ_H=$($V/bin/python -c "print(round(1225*$SEC_IT/3600, 1))")
  echo ">> projected full run: ${PROJ_H}h"
  BUST=$($V/bin/python -c "print(1 if 1225*$SEC_IT/3600 > 18 else 0)")
  [ "$BUST" = "1" ] && { kill $SIDECAR 2>/dev/null; die "projected ${PROJ_H}h > 18h budget gate"; }
fi

# --- full run: 1225 steps × 4.19M-token global batch ≈ 5.13B tokens (R-3) ---
STEPS=1225; SAVE=125
echo ">> FULL RUN 2: bs$BS ga$GA $EXTRA steps=$STEPS save_every=$SAVE (4.19M global batch, WSD)"
if TRAIN_TIMEOUT=72000 run_train "$BS" "$GA" "$STEPS" "$OUT" "$SAVE" "$MIX" "$EXTRA"; then
  echo "=== RUN 2 TRAIN COMPLETE $(date -u +%FT%TZ) ==="
else
  echo "=== RUN 2 TRAIN FAILED/TIMED OUT (rc=$?) — artifacts sync then terminate ==="
fi
kill $SIDECAR 2>/dev/null || true
sleep 60
terminate
