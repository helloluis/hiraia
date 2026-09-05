#!/usr/bin/env bash
set -uo pipefail
. /root/runenv.sh
V=/root/venv-cpt; MODEL=/root/qwen35-2b-text
MIX=/workspace/fullmix/mix-v1/full-mix.jsonl
OUT=/workspace/fullrun/run1; LOG=/workspace/fullrun/train.log
TARGET=5900; BS=2; GA=64
NP=$(cat /workspace/fullrun/NUM_PROC 2>/dev/null); NP=${NP:-160}
KEY="$RUNPOD_API_KEY"; PID_="$RUNPOD_POD_ID"; TOK="$HB_TOKEN"
mkdir -p "$OUT"; exec > >(tee -a "$LOG") 2>&1
echo "=== LAUNCHER $(date -u +%FT%TZ) pod=$PID_ ==="
# real hourly rate, straight from the control plane -- never assume the old $26.32
RATE=$(curl -s -m 20 -H "Authorization: Bearer $KEY" -H "User-Agent: hiraia/1.0" \
  "https://rest.runpod.io/v1/pods/$PID_" | python3 -c "
import json,sys
try: print(float(json.load(sys.stdin).get('costPerHr') or 0) or 26.32)
except Exception: print(26.32)")
BUDGET=$(tr -dc '0-9.' < /workspace/fullrun/BUDGET_DECISION 2>/dev/null); BUDGET=${BUDGET:-1105}
SIT=$(python3 -c "import json;print(json.load(open('/workspace/fullrun/CANARY-RESULT.json'))['sec_per_step'])" 2>/dev/null)
LIG=$(python3 -c "import json;print(json.load(open('/workspace/fullrun/CANARY-RESULT.json'))['liger'])" 2>/dev/null)
[ -z "${SIT:-}" ] && SIT=41.78
EXTRA=""; [ "${LIG:-no}" = "yes" ] && EXTRA="--use_liger_kernel true"
STEPS=$(python3 -c "print(min($TARGET,int($BUDGET/$RATE*3600/max($SIT,1e-6))))")
DECAY=$(( STEPS * 15 / 100 ))
echo ">> \$$BUDGET at \$$RATE/hr, ${SIT}s/it, liger=${LIG:-no} -> $STEPS steps (decay $DECAY), $(python3 -c "print(round($SIT*$STEPS/3600,1))")h, $(python3 -c "print(round($STEPS*4.19e6/1e9,2))")B tokens"
[ "$STEPS" -lt 600 ] && { echo "FATAL: only $STEPS steps affordable"; exit 1; }
( while true; do sleep 60
    read -r S L P T < <(python3 /root/hbvals.py "$LOG")
    curl -s -m 10 -X POST https://hiraia.b11.dev/admin/api/hb -H "X-Token: $TOK" \
      -H 'Content-Type: application/json' \
      -d "{\"pod_id\":\"$PID_\",\"step\":${S:-0},\"loss\":${L:-0},\"sec_per_step\":${P:-0},\"total_steps\":$STEPS,\"kind\":\"train\",\"phase\":\"train\",\"note\":\"full CPT run\"}" >/dev/null 2>&1 || true
  done ) & SIDE=$!
HF_HOME=/workspace/hf-cache NPROC_PER_NODE=8 $V/bin/swift pt \
  --model "$MODEL" --tuner_type full --deepspeed zero2 \
  --dataset "$MIX" --columns '{"text": "text"}' \
  --dataset_num_proc "$NP" --packing_num_proc "$NP" --load_from_cache_file true \
  --packing true --attn_impl flash_attn --max_length 4096 --torch_dtype bfloat16 \
  --learning_rate 8e-5 --warmup_steps 200 --lr_scheduler_type warmup_stable_decay \
  --lr_scheduler_kwargs "{\"num_decay_steps\": $DECAY, \"min_lr_ratio\": 0.1}" \
  --adam_beta1 0.9 --adam_beta2 0.95 --weight_decay 0.1 --max_grad_norm 1.0 \
  --max_steps "$STEPS" --per_device_train_batch_size "$BS" --gradient_accumulation_steps "$GA" \
  --gradient_checkpointing false $EXTRA \
  --save_strategy steps --save_steps 300 --save_only_model true --save_total_limit 25 \
  --logging_steps 10 --output_dir "$OUT"
RC=$?; kill $SIDE 2>/dev/null
echo "=== RUN ENDED rc=$RC $(date -u +%FT%TZ) (checkpoints on the volume) ==="
ls -la "$OUT"/v*/ 2>/dev/null | tail -5
sleep 60
curl -s --max-time 30 -X DELETE -H "Authorization: Bearer $KEY" \
  "https://rest.runpod.io/v1/pods/$PID_" -w " terminate HTTP %{http_code}\n"
