#!/bin/bash
# Round-4 GRPO — TAGALOG ONLY. Single change vs r3: LR 5e-6 → 2e-6.
# r3 diagnosis: the fixed (non-hackable) reward produced 2-3x larger advantage
# spreads than r1/r2's flat hacked reward; at the same LR that meant over-large
# policy updates → monotonic reward collapse from ~batch 160 (0.90 → 0.46) and
# a degenerate final policy (14/18 canary samples flagged: broken markdown,
# emoji soup, English drift). Same reward.py, prompts, seed, KL_BETA=0.10 —
# LR is the only variable, so r4 cleanly tests the over-stepping hypothesis.
set -u
LOG=/workspace/chain-round4.log
exec > "$LOG" 2>&1
CONVERT=/workspace/qvac-src-v8828/convert_lora_to_gguf.py

source /workspace/venv-grpo/bin/activate
cd /workspace/rl

echo "[r4] reward self-check at $(date -u)"
python test_reward.py || { echo "[r4] ERROR: test_reward failed"; exit 1; }
python smoke_reward.py || { echo "[r4] ERROR: smoke_reward failed"; exit 1; }

echo "[r4] launching tagalog at $(date -u)"
rm -f /workspace/session-grpo-tagalog-r4.log
UNSLOTH_VLLM_NO_FLASHINFER=1 \
LANG_TAG=tagalog INIT_ADAPTER=/workspace/init-adapter-tagalog \
PROMPTS=/workspace/rl/prompts/rl-prompts.tagalog.jsonl \
OUT_DIR=/workspace/output/tagalog-sailor-3b-grpo-r4 \
MAX_STEPS=600 GROUP_SIZE=6 LR=2e-6 KL_BETA=0.10 MAX_NEW_TOKENS=256 SEED=42 \
python -u train-grpo.py > /workspace/session-grpo-tagalog-r4.log 2>&1
rc=$?
echo "[r4] tagalog trainer exit rc=$rc"
FA=/workspace/output/tagalog-sailor-3b-grpo-r4/final-adapter
if [ ! -d "$FA" ]; then echo "[r4] ERROR: no final-adapter"; exit 1; fi
python "$CONVERT" "$FA" --base-model-id sail/Sailor2-3B-Chat --outtype f16 \
  --outfile /workspace/output/tagalog-sailor-3b-grpo-r4/adapter-tagalog-grpo-r4-f16.gguf \
  && echo "[r4] CONVERT-OK tagalog" || { echo "[r4] CONVERT-FAIL tagalog"; exit 1; }
# convert intermediate checkpoints too — r3 showed we may want an early-stop pick
for ck in /workspace/output/tagalog-sailor-3b-grpo-r4/checkpoint-*; do
  [ -d "$ck" ] || continue
  n=$(basename "$ck" | cut -d- -f2)
  python "$CONVERT" "$ck" --base-model-id sail/Sailor2-3B-Chat --outtype f16 \
    --outfile "/workspace/output/tagalog-sailor-3b-grpo-r4/adapter-tagalog-grpo-r4-ck${n}-f16.gguf" \
    && echo "[r4] CONVERT-OK ck${n}" || echo "[r4] CONVERT-FAIL ck${n}"
done
echo "[r4] R4-ALL-DONE at $(date -u)"
