#!/usr/bin/env bash
# ============================================================================
# run_grounded_train.sh — ON-POD pipeline for the Tagalog GROUNDED retrain
# (Track-A SFT-rebalance). Trains the grounded adapter on the EXACT recipe that
# made the shipping ttft adapter (train-tagalog-grounded.py, Sailor2-3B, r32/a64,
# 4ep, lr1e-4, seq2048) — only train-grounded.jsonl changed (+82 rebalance rows).
# Then converts the adapter to f16 GGUF via the QVAC converter on volume 5uwc7qp731.
#
# Writes a GROUNDED_DONE marker on success. Run detached:
#   nohup bash /workspace/run_grounded_train.sh > /workspace/grounded-run.log 2>&1 &
# ============================================================================
set -uo pipefail
cd /workspace
log(){ echo "[$(date -u +%H:%M:%S)] $*"; }
fail(){ echo "GROUNDED_FAILED: $*"; exit 1; }

QVAC_SRC="${QVAC_SRC:-/workspace/qvac-src-v8828}"
BASE_ID="${BASE_ID:-sail/Sailor2-3B-Chat}"
OUTDIR="/workspace/output/tagalog-sailor-3b-grounded"
ADAPTER_DIR="$OUTDIR/final-adapter"
ADAPTER_GGUF="/workspace/adapter-tagalog-grounded-rebal-f16.gguf"

[ -d /workspace/venv ] || fail "no /workspace/venv"
source /workspace/venv/bin/activate || fail "venv activate failed"
log "python: $(python -V 2>&1) | gpu: $(python -c 'import torch;print(torch.cuda.get_device_name(0))' 2>/dev/null || echo '??')"
[ -f /workspace/train-grounded.jsonl ] || fail "train-grounded.jsonl not uploaded"
log "dataset rows: $(wc -l < /workspace/train-grounded.jsonl)"

# 1) TRAIN (the grounded recipe — train-tagalog-grounded.py reads /workspace/train-grounded.jsonl)
log "training: python -u train-tagalog-grounded.py"
python -u /workspace/train-tagalog-grounded.py 2>&1 | tee /workspace/train-grounded-tagalog.log
[ -f "$ADAPTER_DIR/adapter_model.safetensors" ] || fail "training produced no adapter"
log "training done -> $ADAPTER_DIR"

# 2) CONVERT adapter -> f16 GGUF (QVAC converter, clean upstream base config)
if [ -f "$QVAC_SRC/convert_lora_to_gguf.py" ]; then
  log "converting -> $ADAPTER_GGUF"
  ( cd "$QVAC_SRC" && python convert_lora_to_gguf.py "$ADAPTER_DIR" \
      --base-model-id "$BASE_ID" --outtype f16 --outfile "$ADAPTER_GGUF" ) 2>&1 | tee /workspace/convert-grounded.log \
    || fail "GGUF convert failed (see convert-grounded.log)"
  [ -f "$ADAPTER_GGUF" ] || fail "no GGUF produced"
  log "GGUF ready: $ADAPTER_GGUF ($(du -h "$ADAPTER_GGUF" | cut -f1))"
else
  fail "$QVAC_SRC/convert_lora_to_gguf.py missing (volume 5uwc7qp731 attached?)"
fi

echo "GROUNDED_DONE adapter=$ADAPTER_GGUF"
