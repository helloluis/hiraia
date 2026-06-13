#!/bin/bash
# Round-3 GRPO — TAGALOG ONLY (Bisaya descoped 2026-06-12; English rides the
# tagalog adapter). Reward fixes vs r2: abstain-fabrication penalty (0.6),
# truncation penalty (0.25), tl/en format-degeneracy penalty; KL_BETA 0.04→0.10
# anchors harder to the SFT policy (the broad TL quality erosion in r2 is
# invisible to the lexical reward — KL is the defense). Same prompts/seed/steps
# as r1/r2 → the reward + KL changes are the only variables.
set -u
LOG=/workspace/chain-round3.log
exec > "$LOG" 2>&1
CONVERT=/workspace/qvac-src-v8828/convert_lora_to_gguf.py

source /workspace/venv-grpo/bin/activate
cd /workspace/rl

echo "[r3] reward self-check at $(date -u)"
python test_reward.py || { echo "[r3] ERROR: test_reward failed"; exit 1; }
python smoke_reward.py || { echo "[r3] ERROR: smoke_reward failed"; exit 1; }

echo "[r3] launching tagalog at $(date -u)"
rm -f /workspace/session-grpo-tagalog-r3.log
UNSLOTH_VLLM_NO_FLASHINFER=1 \
LANG_TAG=tagalog INIT_ADAPTER=/workspace/init-adapter-tagalog \
PROMPTS=/workspace/rl/prompts/rl-prompts.tagalog.jsonl \
OUT_DIR=/workspace/output/tagalog-sailor-3b-grpo-r3 \
MAX_STEPS=600 GROUP_SIZE=6 LR=5e-6 KL_BETA=0.10 MAX_NEW_TOKENS=256 SEED=42 \
python -u train-grpo.py > /workspace/session-grpo-tagalog-r3.log 2>&1
rc=$?
echo "[r3] tagalog trainer exit rc=$rc"
FA=/workspace/output/tagalog-sailor-3b-grpo-r3/final-adapter
if [ ! -d "$FA" ]; then echo "[r3] ERROR: no final-adapter"; exit 1; fi
python "$CONVERT" "$FA" --base-model-id sail/Sailor2-3B-Chat --outtype f16 \
  --outfile /workspace/output/tagalog-sailor-3b-grpo-r3/adapter-tagalog-grpo-r3-f16.gguf \
  && echo "[r3] CONVERT-OK tagalog" || { echo "[r3] CONVERT-FAIL tagalog"; exit 1; }
echo "[r3] R3-ALL-DONE at $(date -u)"
