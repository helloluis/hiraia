#!/usr/bin/env bash
# heal-pipeline.sh — runs ON THE POD, fully detached: prune -> (HF-cached) heal-tokens -> train.
# Build-once-reuse via a private HF dataset (DC-agnostic, no scp, no GPU-idle build on re-runs):
#   - pulls ceb-pilot-core.jsonl from HF (no 497MB scp)
#   - pulls heal-tokens-<TOTAL>.bin from HF if cached (SKIPS the ~37-min build); else builds + pushes it
# Writes progress + markers to pipeline.log; the orchestrator only polls this (no long ssh).
# Env: TOTAL (heal tokens), NGPU (torchrun procs), HF_TOKEN (write).
set -uo pipefail
cd /workspace
TOTAL="${TOTAL:-800000000}"; NGPU="${NGPU:-2}"; HFREPO="Cryptopop/hiraia-heal-corpus"
export HF_TOKEN="${HF_TOKEN:-}"
echo "=== PIPELINE START $(date) TOTAL=$TOTAL NGPU=$NGPU ==="

echo "=== FETCH ceb corpus from HF $(date) ==="
huggingface-cli download "$HFREPO" ceb-pilot-core.jsonl --repo-type dataset --local-dir /workspace >/dev/null 2>&1 \
  && echo "got ceb-pilot-core.jsonl from HF" || echo "(HF ceb fetch failed - expecting a local copy)"

echo "=== PRUNE START $(date) ==="
python prune-ffn.py --model sail/Sailor2-3B --calib calib.jsonl --new-intermediate 4608 --out sailor2-2b4 \
  || { echo "PIPELINE_FAIL_PRUNE $(date)"; exit 1; }

echo "=== HEAL-TOKENS (try HF cache heal-tokens-$TOTAL.bin) $(date) ==="
if huggingface-cli download "$HFREPO" "heal-tokens-$TOTAL.bin" --repo-type dataset --local-dir /workspace >/dev/null 2>&1; then
  mv "heal-tokens-$TOTAL.bin" heal-tokens.bin
  echo "REUSED heal-tokens from HF (SKIPPED build) $(date)"
else
  echo "=== BUILD START $(date) ==="
  python build-heal-data.py --ceb ceb-pilot-core.jsonl --tokenizer sail/Sailor2-3B --total-tokens "$TOTAL" --out heal-tokens.bin \
    || { echo "PIPELINE_FAIL_BUILD $(date)"; exit 1; }
  echo "=== PUSH heal-tokens to HF $(date) ==="
  huggingface-cli upload "$HFREPO" heal-tokens.bin "heal-tokens-$TOTAL.bin" --repo-type dataset >/dev/null 2>&1 \
    && echo "pushed heal-tokens-$TOTAL.bin to HF (reusable)" || echo "(HF push failed - continuing)"
fi

echo "=== TRAIN START $(date) ==="
torchrun --nproc_per_node="$NGPU" train-heal.py --model sailor2-2b4 --tokens heal-tokens.bin --out sailor2-2b4-healed \
  || { echo "PIPELINE_FAIL_TRAIN $(date)"; exit 1; }

echo "=== PIPELINE_DONE $(date) ==="
