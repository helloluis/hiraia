#!/usr/bin/env bash
# ============================================================================
# fullrun_driver.sh — the full CPT run. Runs ON an 8x pod in US-NE-1 with the
# corpus volume ATTACHED, so checkpoints are written straight to durable storage.
# That single change removes the failure that destroyed run 2 (cross-DC sync
# falling behind, then the pod's local disk dying with it).
#
# BUDGET-AWARE: the canary measures real s/it, then max_steps is derived from the
# dollar ceiling. The run takes as many tokens as the money buys and cannot overrun.
# ============================================================================
set -uo pipefail
V=/root/venv-cpt
MODEL=/root/qwen35-2b-text                       # vision-stripped copy (08-23 lesson)
MIX=/workspace/fullmix/mix-v1/full-mix.jsonl     # 6.19B-token mix epoch, on the volume
OUT=/workspace/fullrun/run1                      # checkpoints -> VOLUME, not local disk
LOG=/workspace/fullrun/fullrun.log
TARGET_STEPS=${TARGET_STEPS:-5900}               # 4 trainer epochs = 24.78B tokens
BUDGET_USD=${BUDGET_USD:-820}
RATE_USD_HR=${RATE_USD_HR:-26.32}
HB_URL=https://hiraia.b11.dev/admin/api/hb
mkdir -p "$(dirname "$LOG")" "$OUT"
exec > >(tee -a "$LOG") 2>&1
echo "=== FULL RUN DRIVER $(date -u +%FT%TZ) ==="

terminate(){ echo ">> self-terminating $RUNPOD_POD_ID $(date -u +%FT%TZ)"
  curl -s --max-time 30 -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" \
    "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID" -w "terminate HTTP %{http_code}\n"; }
die(){ echo "FATAL: $*"; terminate; exit 1; }

: "${RUNPOD_API_KEY:?}" || die "no api key"; : "${RUNPOD_POD_ID:?}" || die "no pod id"
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 -H "Authorization: Bearer $RUNPOD_API_KEY" "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID")
[ "$C" = "200" ] || die "terminate dry-check HTTP $C"
[ -s "$MIX" ] || die "mix missing at $MIX"
$V/bin/python - <<'PY' || die "env preflight failed"
import torch, importlib, transformers, fla
for m in ["causal_conv1d","flash_attn"]: importlib.import_module(m)
assert torch.cuda.device_count()==8, torch.cuda.device_count()
from transformers import AutoConfig, AutoModelForCausalLM
import torch as _t
with _t.device("meta"):
    _m = AutoModelForCausalLM.from_config(AutoConfig.from_pretrained("/root/qwen35-2b-text"))
assert not [n for n,_ in _m.named_parameters() if "vis" in n.lower()], "vision in graph"
n=sum(p.numel() for _,p in _m.named_parameters()); assert 1.7e9<n<2.1e9, n
print(f"ASSERT ok: 8 GPUs, text-only {n/1e9:.2f}B params")
PY

hb(){ curl -s -m 8 -X POST "$HB_URL" -H "X-Token: $HB_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"pod_id\":\"$RUNPOD_POD_ID\",\"step\":${1:-0},\"loss\":${2:-0},\"sec_per_step\":${3:-0},\"total_steps\":${4:-0},\"kind\":\"train\",\"note\":\"full run\"}" >/dev/null 2>&1 || true; }

run(){ # bs ga steps outdir save extra
  HF_HOME=/workspace/hf-cache NPROC_PER_NODE=8 $V/bin/swift pt \
    --model "$MODEL" --tuner_type full --deepspeed zero2 \
    --dataset "$MIX" --columns '{"text": "text"}' \
    --dataset_num_proc 24 --packing_num_proc 24 --load_from_cache_file true \
    --packing true --attn_impl flash_attn --max_length 4096 --torch_dtype bfloat16 \
    --learning_rate 8e-5 --warmup_steps 200 --lr_scheduler_type warmup_stable_decay \
    --lr_scheduler_kwargs "{\"num_decay_steps\": $(( $3 * 15 / 100 )), \"min_lr_ratio\": 0.1}" \
    --adam_beta1 0.9 --adam_beta2 0.95 --weight_decay 0.1 --max_grad_norm 1.0 \
    --max_steps "$3" --per_device_train_batch_size "$1" --gradient_accumulation_steps "$2" \
    --gradient_checkpointing false ${6:-} \
    --save_strategy steps --save_steps "$5" --save_only_model true --save_total_limit 25 \
    --logging_steps 10 --output_dir "$4"; }

sit_from(){ $V/bin/python - "$1" <<'PY'
import json,sys,glob
j=sorted(glob.glob(sys.argv[1]+"/v*/logging.jsonl"))[-1]
r=[json.loads(l) for l in open(j) if l.strip()]
s=[float(x["train_speed(s/it)"]) for x in r if "train_speed(s/it)" in x]
m=[float(x["memory(GiB)"]) for x in r if "memory(GiB)" in x]
print(f"{s[-1] if s else 0}|{max(m[-3:]) if m else 0}")
PY
}

# ---- canary: Liger first (fuses the 248k-vocab CE — our bottleneck), plain fallback
BS=2; GA=64; EXTRA="--use_liger_kernel true"
echo ">> canary A: bs2 ga64 + Liger, 25 steps"
if run 2 64 25 /root/can-liger 1000 "--use_liger_kernel true"; then
  IFS='|' read -r SIT MEM <<< "$(sit_from /root/can-liger)"
  echo ">> Liger OK: ${SIT}s/it, ${MEM}GiB"
else
  echo ">> Liger canary FAILED — falling back to plain"
  pkill -9 -f "swift/cli/pt.py"; sleep 25
  run 2 64 25 /root/can-plain 1000 "" || die "both canaries failed"
  IFS='|' read -r SIT MEM <<< "$(sit_from /root/can-plain)"
  EXTRA=""; echo ">> plain: ${SIT}s/it, ${MEM}GiB"
fi
pkill -9 -f "swift/cli/pt.py" 2>/dev/null; sleep 30
nvidia-smi --query-compute-apps=pid --format=csv,noheader | while read -r P; do kill -9 "$P" 2>/dev/null; done; sleep 15

# ---- publish the canary measurement, then hold briefly for a budget decision.
# Idle 8x time is ~$0.44/min, so the window is bounded and defaults through.
cat > /workspace/fullrun/CANARY-RESULT.json <<EOF
{"sec_per_step": $SIT, "memory_gib": $MEM, "liger": "$([ -n "$EXTRA" ] && echo yes || echo no)",
 "measured_utc": "$(date -u +%FT%TZ)", "default_budget_usd": $BUDGET_USD,
 "steps_at_default": $($V/bin/python -c "print(int($BUDGET_USD/$RATE_USD_HR*3600/max($SIT,1e-6)))"),
 "tokens_at_default_B": $($V/bin/python -c "print(round($BUDGET_USD/$RATE_USD_HR*3600/max($SIT,1e-6)*4.19e6/1e9,2))")}
EOF
echo ">> CANARY RESULT published:"; cat /workspace/fullrun/CANARY-RESULT.json
hb 0 0 "$SIT" 0
echo ">> holding up to 20 min for /workspace/fullrun/BUDGET_DECISION (else default \$$BUDGET_USD)"
for i in $(seq 1 40); do
  if [ -s /workspace/fullrun/BUDGET_DECISION ]; then
    D=$(tr -dc '0-9.' < /workspace/fullrun/BUDGET_DECISION)
    case "$D" in ''|*[!0-9.]*) echo ">> ignoring malformed decision";; *)
      BUDGET_USD="$D"; echo ">> BUDGET DECISION: \$$BUDGET_USD";; esac
    break
  fi
  sleep 30
done

# ---- budget-aware step count: take the most tokens the money buys, never more
STEPS=$($V/bin/python -c "
sit=float('$SIT'); budget=float('$BUDGET_USD'); rate=float('$RATE_USD_HR'); tgt=int('$TARGET_STEPS')
afford=int(budget/rate*3600/max(sit,1e-6))
print(min(tgt, afford))")
HRS=$($V/bin/python -c "print(round(float('$SIT')*int('$STEPS')/3600,1))")
COST=$($V/bin/python -c "print(round(float('$SIT')*int('$STEPS')/3600*float('$RATE_USD_HR')))")
TOK=$($V/bin/python -c "print(round(int('$STEPS')*4.19e6/1e9,2))")
echo ">> BUDGET PLAN: ${SIT}s/it -> $STEPS steps (target $TARGET_STEPS) = ${TOK}B tokens, ${HRS}h, ~\$$COST of \$$BUDGET_USD"
[ "$STEPS" -lt 600 ] && die "affordable steps ($STEPS) too few to be worth running"

# ---- heartbeat sidecar (dashboard visibility, drives guard-2 liveness)
( while true; do sleep 60
    S=$(grep -aoE '"global_step/max_steps": "[0-9]+' "$LOG" | tail -1 | grep -oE '[0-9]+$')
    L=$(grep -aoE '"loss": "[0-9.]+' "$LOG" | tail -1 | grep -oE '[0-9.]+$')
    P=$(grep -aoE '"train_speed\(s/it\)": "[0-9.]+' "$LOG" | tail -1 | grep -oE '[0-9.]+$')
    hb "${S:-0}" "${L:-0}" "${P:-0}" "$STEPS"
  done ) & SIDE=$!

echo ">> FULL RUN: bs$BS ga$GA $EXTRA steps=$STEPS save_every=300 -> $OUT (on the volume)"
if run "$BS" "$GA" "$STEPS" "$OUT" 300 "$EXTRA"; then
  echo "=== FULL RUN COMPLETE $(date -u +%FT%TZ) ==="
else
  echo "=== FULL RUN ENDED rc=$? (checkpoints are on the volume) ==="
fi
kill $SIDE 2>/dev/null
ls -la "$OUT"/v*/ 2>/dev/null | tail -5
sleep 60
terminate
