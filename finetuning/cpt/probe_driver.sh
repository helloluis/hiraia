#!/usr/bin/env bash
# ============================================================================
# probe_driver.sh — runs ON the 8×H100 pod. The probe CPT per PROBE-CPT-CONFIG.
# assertions → DDP memory canary (variant C, falls back to A) → full run with
# checkpoints every 500 steps (~500M tokens) → VERIFIED self-termination.
# Everything logs to /workspace/corpus/logs/probe-cpt.log (the volume).
# ============================================================================
set -uo pipefail
V=/root/venv-cpt
MIX=/workspace/corpus/tokenized/probe-mix-v1/probe-mix.jsonl
OUT=/workspace/probe-cpt-run1
LOG=/workspace/corpus/logs/probe-cpt.log
exec > >(tee -a "$LOG") 2>&1
echo "=== PROBE DRIVER START $(date -u +%FT%TZ) ==="

# --- job-start assertions (hard fail; PROBE-CPT-CONFIG §2) ---
: "${RUNPOD_API_KEY:?ASSERT FAIL: RUNPOD_API_KEY missing}"
: "${RUNPOD_POD_ID:?ASSERT FAIL: RUNPOD_POD_ID missing}"
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 -H "Authorization: Bearer $RUNPOD_API_KEY" "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID")
[ "$C" = "200" ] || { echo "ASSERT FAIL: terminate endpoint dry-check HTTP $C"; exit 1; }
echo "ASSERT self-termination env OK (pod $RUNPOD_POD_ID visible via API)"
$V/bin/python - <<'PYEOF'
import torch, importlib
for m in ["fla", "causal_conv1d", "flash_attn"]:
    importlib.import_module(m)
print("ASSERT kernels importable OK")
assert torch.cuda.device_count() == 8, f"ASSERT FAIL: {torch.cuda.device_count()} GPUs"
from transformers import AutoTokenizer
assert len(AutoTokenizer.from_pretrained("Qwen/Qwen3.5-2B-Base")) >= 248000
print("ASSERT 8 GPUs + vocab OK")
PYEOF
[ -s "$MIX" ] || { echo "ASSERT FAIL: probe mix missing"; exit 1; }

terminate() {
  echo ">> self-terminating pod $RUNPOD_POD_ID at $(date -u +%FT%TZ)"
  curl -s --max-time 30 -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" \
    "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID" -w "terminate HTTP %{http_code}\n"
}

run_train() {  # $1=bs $2=ga $3=max_steps $4=outdir $5=save_steps
  HF_HOME=/workspace/hf-cache NPROC_PER_NODE=8 $V/bin/swift pt \
    --model Qwen/Qwen3.5-2B-Base --tuner_type full \
    --dataset "$MIX" --columns '{"text": "text"}' \
    --packing true --attn_impl flash_attn --max_length 4096 \
    --torch_dtype bfloat16 \
    --learning_rate 8e-5 --warmup_steps 100 \
    --lr_scheduler_type cosine \
    --adam_beta1 0.9 --adam_beta2 0.95 --weight_decay 0.1 --max_grad_norm 1.0 \
    --max_steps "$3" \
    --per_device_train_batch_size "$1" --gradient_accumulation_steps "$2" \
    --gradient_checkpointing false \
    --save_strategy steps --save_steps "$5" --save_only_model true --save_total_limit 12 \
    --logging_steps 20 \
    --output_dir "$4"
}

assert_full_ckpt() {  # LoRA-not-full guard (2026-08-23 lesson: rank-8 adapter shipped as a "probe")
  local SZ=$(find "$1" -name "*.safetensors" -exec du -b {} + 2>/dev/null | awk '{s+=$1} END {printf "%.0f", s+0}')
  if [ "$SZ" -lt 3000000000 ]; then echo "ASSERT FAIL: checkpoint only $SZ bytes — NOT full-param (LoRA?)"; return 1; fi
  echo "ASSERT full-param checkpoint OK ($SZ bytes)"
}

# --- 30-step DDP memory canary: variant C (bs2), fall back A (bs1) ---
echo ">> canary: variant C (bs2 ga8, no ckpt) 30 steps ..."
if run_train 2 8 30 /root/canary-C 1000; then
  assert_full_ckpt /root/canary-C || { echo FATAL; terminate; exit 1; }
  BS=2; GA=16   # ga16 -> global batch 8*2*16*4096 = 1.05M tokens
  echo ">> canary C PASSED -> full run at bs2 ga16"
else
  echo ">> canary C FAILED (likely DDP OOM) -> variant A"
  if run_train 1 8 30 /root/canary-A 1000; then
    BS=1; GA=32  # same 1.05M global batch
    echo ">> canary A PASSED -> full run at bs1 ga32"
  else
    echo "FATAL: both canaries failed"; terminate; exit 1
  fi
fi

# --- full probe: ~5.1B tokens / 1.05M global batch ≈ 4900 steps ---
STEPS=4900; SAVE=500
echo ">> FULL PROBE: bs$BS ga$GA steps=$STEPS save_every=$SAVE"
if run_train "$BS" "$GA" "$STEPS" "$OUT" "$SAVE"; then
  echo "=== PROBE TRAIN COMPLETE $(date -u +%FT%TZ) ==="
else
  echo "=== PROBE TRAIN FAILED (checkpoints preserved at $OUT) ==="
fi
sleep 300   # grace window for any live session to grab final state
terminate
