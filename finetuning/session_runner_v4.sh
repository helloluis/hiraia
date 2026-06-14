#!/usr/bin/env bash
# ============================================================================
# session_runner_v4.sh — Hiraia ONE-SESSION v4 finetune pipeline (runs ON the pod).
#
# v4 = image-request-under-grounding + anti-repetition SFT (300 new rows:
# train-v3 + science-dialogue-v4 per language). Base: sail/Sailor2-3B-Chat.
#
# Embodies the rule "eval immediately after training, in the same pod session,
# before terminating" (memory: hiraia-eval-immediately-after-train).
#
# Per language it runs: TRAIN (unsloth) -> CONVERT adapter to GGUF -> EVAL on
# the merged model (transformers/PyTorch) -> EVAL on GGUF (llama-cli, the real
# phone engine). Writes results + per-step logs to /workspace and a final
# SESSION_DONE marker.
#
# Designed for a pod deployed in US-KS-2 with persistent volume 5uwc7qp731
# attached at /workspace (it carries the QVAC v8828 build + base GGUF). The
# transformers eval works on ANY volume; only the GGUF eval needs that volume.
#
# Usage (on pod):
#   bash /workspace/session_runner_v4.sh
#   LANGS="tagalog" SKIP_TRAIN=1 bash /workspace/session_runner_v4.sh   # eval only
#
# Env knobs:
#   LANGS        space-separated: "tagalog bisaya"   (default both)
#   SKIP_TRAIN   1 = skip training, reuse existing adapters         (default 0)
#   SKIP_GGUF    1 = skip the GGUF/llama-cli phone-parity eval      (default 0)
#   QVAC_BIN     dir with llama-cli + libs   (default /workspace/qvac-bin-v8828)
#   QVAC_SRC     dir with convert_lora_to_gguf.py (default /workspace/qvac-src-v8828)
#   BASE_GGUF    f16 base GGUF (default /workspace/models/sailor2-3b-chat-f16.gguf)
#   BASE_ID      HF base id (default sail/Sailor2-3B-Chat)
# ============================================================================
set -uo pipefail
cd /workspace

LANGS="${LANGS:-tagalog bisaya}"
SKIP_TRAIN="${SKIP_TRAIN:-0}"
SKIP_GGUF="${SKIP_GGUF:-0}"
QVAC_BIN="${QVAC_BIN:-/workspace/qvac-bin-v8828}"
QVAC_SRC="${QVAC_SRC:-/workspace/qvac-src-v8828}"
BASE_GGUF="${BASE_GGUF:-/workspace/models/sailor2-3b-chat-f16.gguf}"
BASE_ID="${BASE_ID:-sail/Sailor2-3B-Chat}"

log(){ echo "[$(date -u +%H:%M:%S)] $*"; }
fail(){ echo "SESSION_FAILED: $*"; exit 1; }

# Per-language config: train_script|output_dir|eval_lang
cfg_for(){ case "$1" in
  tagalog) echo "train-tagalog-unsloth-v4.py|/workspace/output/tagalog-sailor-v4|tagalog";;
  bisaya)  echo "train-bisaya-unsloth-v4.py|/workspace/output/bisaya-sailor-v4|cebuano";;
  *) return 1;; esac; }

# ---- environment ----------------------------------------------------------
[ -d /workspace/venv ] || fail "no /workspace/venv — create it per RUNPOD-COMPLETE-SETUP.md first"
source /workspace/venv/bin/activate || fail "could not activate venv"
log "python: $(python -V 2>&1) | cuda: $(python -c 'import torch;print(torch.cuda.get_device_name(0))' 2>/dev/null || echo '??')"

df -h /workspace | tail -1
log "LANGS=[$LANGS] SKIP_TRAIN=$SKIP_TRAIN SKIP_GGUF=$SKIP_GGUF BASE_ID=$BASE_ID"

# ---- build the f16 base GGUF if the GGUF eval is on and it's missing -------
ensure_base_gguf(){
  [ -f "$BASE_GGUF" ] && { log "base GGUF present: $BASE_GGUF"; return 0; }
  log "base GGUF missing; building from $BASE_ID via convert_hf_to_gguf.py"
  local conv="$QVAC_SRC/convert_hf_to_gguf.py"
  [ -f "$conv" ] || { log "WARN: $conv not found — cannot build base GGUF; skipping GGUF eval"; return 1; }
  mkdir -p "$(dirname "$BASE_GGUF")"
  python - <<PY || return 1
from huggingface_hub import snapshot_download
p=snapshot_download("$BASE_ID")
open("/workspace/.base_hf_path","w").write(p); print("base HF at",p)
PY
  python "$conv" "$(cat /workspace/.base_hf_path)" --outtype f16 --outfile "$BASE_GGUF" || return 1
  log "built base GGUF -> $BASE_GGUF"
}

# ---- per-language pipeline -------------------------------------------------
for L in $LANGS; do
  C=$(cfg_for "$L") || fail "unknown language '$L'"
  IFS='|' read -r TRAIN_PY OUTDIR EVAL_LANG <<<"$C"
  ADAPTER_DIR="$OUTDIR/final-adapter"
  MERGED_DIR="$OUTDIR/merged-model"
  ADAPTER_GGUF="$OUTDIR/adapter-$L-v4-f16.gguf"
  log "========== $L (v4) =========="

  # 1) TRAIN
  if [ "$SKIP_TRAIN" = "1" ] && [ -d "$ADAPTER_DIR" ]; then
    log "[$L] SKIP_TRAIN set + adapter exists -> skipping training"
  else
    log "[$L] training: python -u $TRAIN_PY"
    python -u "/workspace/$TRAIN_PY" 2>&1 | tee "/workspace/train-$L-v4.log"
    [ -f "$ADAPTER_DIR/adapter_model.safetensors" ] || fail "[$L] training produced no adapter"
    log "[$L] training done"
  fi

  # 2) CONVERT adapter -> GGUF (QVAC converter, clean upstream base config)
  if [ "$SKIP_GGUF" != "1" ]; then
    if [ -f "$QVAC_SRC/convert_lora_to_gguf.py" ]; then
      log "[$L] converting adapter -> $ADAPTER_GGUF"
      ( cd "$QVAC_SRC" && python convert_lora_to_gguf.py "$ADAPTER_DIR" \
          --base-model-id "$BASE_ID" --outtype f16 --outfile "$ADAPTER_GGUF" ) \
          2>&1 | tee "/workspace/convert-$L-v4.log" \
        && log "[$L] GGUF adapter ready" \
        || log "[$L] WARN: GGUF convert failed — see convert-$L-v4.log"
    else
      log "[$L] WARN: $QVAC_SRC/convert_lora_to_gguf.py missing — skipping GGUF convert/eval (volume 5uwc7qp731 attached?)"
    fi
  fi

  # 3) EVAL — merged model via transformers (always; faithful behavior + image tags)
  log "[$L] eval (transformers/merged) -> eval-v4-$L.json"
  python /workspace/run_eval_pod_v3.py --model "$MERGED_DIR" --lang "$EVAL_LANG" \
      --out "/workspace/eval-v4-$L.json" 2>&1 | tee "/workspace/eval-$L-v4.log" \
    || log "[$L] WARN: transformers eval failed"

  # 4) EVAL — GGUF via llama-cli (phone parity)
  if [ "$SKIP_GGUF" != "1" ] && [ -f "$ADAPTER_GGUF" ] && [ -x "$QVAC_BIN/llama-cli" ]; then
    if ensure_base_gguf; then
      log "[$L] eval (GGUF/llama-cli) -> eval-v4-gguf-$L.json"
      LD_LIBRARY_PATH="$QVAC_BIN" python /workspace/run_eval_qvac2_v3.py \
          --cli "$QVAC_BIN/llama-cli" --base "$BASE_GGUF" --adapter "$ADAPTER_GGUF" \
          --lang "$EVAL_LANG" --out "/workspace/eval-v4-gguf-$L.json" \
          2>&1 | tee "/workspace/eval-gguf-$L-v4.log" \
        || log "[$L] WARN: GGUF eval failed"
    fi
  else
    log "[$L] skipping GGUF eval (SKIP_GGUF=$SKIP_GGUF, adapter_gguf=$([ -f "$ADAPTER_GGUF" ] && echo yes || echo no), llama-cli=$([ -x "$QVAC_BIN/llama-cli" ] && echo yes || echo no))"
  fi
done

echo "================= SESSION SUMMARIES ================="
for f in /workspace/eval-v4-*.json; do
  [ -f "$f" ] || continue
  echo "--- $f ---"
  python -c "import json,sys;print(json.dumps(json.load(open('$f'))['summary'],indent=1,ensure_ascii=False))"
done
echo "SESSION_DONE"
