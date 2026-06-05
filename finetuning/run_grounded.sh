#!/usr/bin/env bash
# run_grounded.sh — runs ON the pod. Train the grounded Tagalog 3B adapter, then
# convert it to a GGUF (using the QVAC build on the persistent volume, if present).
# Writes a GROUNDED_DONE marker on success.
set -uo pipefail
cd /workspace

QVAC_SRC="${QVAC_SRC:-/workspace/qvac-src-v8828}"
BASE_ID="${BASE_ID:-sail/Sailor2-3B-Chat}"
OUTDIR=/workspace/output/tagalog-sailor-3b-grounded
ADIR="$OUTDIR/final-adapter"
ADAPTER_GGUF="$OUTDIR/adapter-tagalog-grounded-f16.gguf"

log(){ echo "[$(date -u +%H:%M:%S)] $*"; }

[ -d /workspace/venv ] || { echo "GROUNDED_FAILED: no /workspace/venv"; exit 1; }
source /workspace/venv/bin/activate
log "python: $(python -V 2>&1) | gpu: $(python -c 'import torch;print(torch.cuda.get_device_name(0))' 2>/dev/null || echo '??')"

# 1) TRAIN
log "training (train-tagalog-grounded.py)"
python -u /workspace/train-tagalog-grounded.py 2>&1 | tee /workspace/train-grounded.log
[ -f "$ADIR/adapter_model.safetensors" ] || { echo "GROUNDED_FAILED: no adapter produced"; exit 1; }
log "training done -> $ADIR"

# 2) CONVERT adapter -> GGUF (needs the QVAC converter on the persistent volume)
if [ -f "$QVAC_SRC/convert_lora_to_gguf.py" ]; then
  log "converting adapter -> $ADAPTER_GGUF"
  ( cd "$QVAC_SRC" && python convert_lora_to_gguf.py "$ADIR" \
      --base-model-id "$BASE_ID" --outtype f16 --outfile "$ADAPTER_GGUF" ) \
      2>&1 | tee /workspace/convert-grounded.log \
    && log "GGUF adapter ready -> $ADAPTER_GGUF" \
    || log "WARN: GGUF convert failed (see convert-grounded.log) — adapter safetensors still usable"
else
  log "WARN: $QVAC_SRC/convert_lora_to_gguf.py missing (volume 5uwc7qp731 attached?) — skipping GGUF convert"
fi

echo "GROUNDED_DONE"
