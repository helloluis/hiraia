#!/bin/bash
# Round-5 = VARIANT A (coverage). Reward changes vs r4 (env-toggled in reward.py):
#   RW_COVERAGE    — faithfulness rewards FULL term coverage (2/4 → 0.5 not 0.67)
#   RW_ANTIDEFLECT — hard penalty for answerable reply ending in '?' with low coverage
#   RW_LENGTHBAND  — kills the brevity free-ride (terse answerable replies lose length credit)
# Hypothesis: r2/r3/r4 all regressed because the reward couldn't see "answered
# thoroughly". On the real photosynthesis deflection-vs-full pair, variant A
# widened the gap 0.18 → 0.56. Same LR/KL/steps/seed as r4 (the stable config),
# so the reward change is the only variable. SFT grounded turns still score
# mean 0.998 under variant A (no false-positive on good answers).
set -u
LOG=/workspace/chain-r5cov.log
exec > "$LOG" 2>&1
CONVERT=/workspace/qvac-src-v8828/convert_lora_to_gguf.py

source /workspace/venv-grpo/bin/activate
cd /workspace/rl

echo "[r5cov] reward self-check (variant A active) at $(date -u)"
python smoke_reward.py || { echo "[r5cov] ERROR smoke failed"; exit 1; }
RW_LEGACY=1 python test_reward.py >/dev/null || { echo "[r5cov] ERROR legacy tests failed"; exit 1; }
echo "[r5cov] reward config: RW_COVERAGE=${RW_COVERAGE:-1} RW_ANTIDEFLECT=${RW_ANTIDEFLECT:-1} RW_LENGTHBAND=${RW_LENGTHBAND:-1}"

echo "[r5cov] launching tagalog at $(date -u)"
rm -f /workspace/session-grpo-tagalog-r5cov.log
UNSLOTH_VLLM_NO_FLASHINFER=1 \
RW_COVERAGE=1 RW_ANTIDEFLECT=1 RW_LENGTHBAND=1 \
LANG_TAG=tagalog INIT_ADAPTER=/workspace/init-adapter-tagalog \
PROMPTS=/workspace/rl/prompts/rl-prompts.tagalog.jsonl \
OUT_DIR=/workspace/output/tagalog-sailor-3b-grpo-r5cov \
MAX_STEPS=400 GROUP_SIZE=6 LR=2e-6 KL_BETA=0.10 MAX_NEW_TOKENS=192 SEED=42 \
python -u train-grpo.py > /workspace/session-grpo-tagalog-r5cov.log 2>&1
rc=$?
echo "[r5cov] tagalog trainer exit rc=$rc"
FA=/workspace/output/tagalog-sailor-3b-grpo-r5cov/final-adapter
[ -d "$FA" ] || { echo "[r5cov] ERROR: no final-adapter"; exit 1; }
python "$CONVERT" "$FA" --base-model-id sail/Sailor2-3B-Chat --outtype f16 \
  --outfile /workspace/output/tagalog-sailor-3b-grpo-r5cov/adapter-tagalog-grpo-r5cov-f16.gguf \
  && echo "[r5cov] CONVERT-OK final" || { echo "[r5cov] CONVERT-FAIL final"; exit 1; }
for ck in /workspace/output/tagalog-sailor-3b-grpo-r5cov/checkpoint-*; do
  [ -d "$ck" ] || continue; n=$(basename "$ck" | cut -d- -f2)
  python "$CONVERT" "$ck" --base-model-id sail/Sailor2-3B-Chat --outtype f16 \
    --outfile "/workspace/output/tagalog-sailor-3b-grpo-r5cov/adapter-tagalog-grpo-r5cov-ck${n}-f16.gguf" \
    && echo "[r5cov] CONVERT-OK ck${n}" || echo "[r5cov] CONVERT-FAIL ck${n}"
done
echo "[r5cov] R5COV-ALL-DONE at $(date -u)"
