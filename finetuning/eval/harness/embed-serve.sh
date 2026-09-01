#!/usr/bin/env bash
# ============================================================================
# embed-serve.sh — boot JUST the LaBSE query embedder, and leave it running.
#
# This is the standalone half of what `chat-serve.sh` used to do. chat-serve.sh booted a chat
# model beside the embedder for `chat-tutor.mts`; both went with the chat surface. What still
# needs a long-lived embedder is the FIXTURE workflow — `rag/pipeline/gen-hybrid-fixtures.mts`
# precomputes query vectors for the offline hybrid-stress gate — and ad-hoc routing probes.
# (`run-harness.sh` does NOT use this: it boots and reaps its own embedder so a gate run can
# never inherit a stale one.)
#
# TWO BACKENDS, and the choice is not cosmetic — it moves top-1 cosine by more than either
# off-domain floor's headroom:
#   gguf         (default) labse.Q4_K_M.gguf through llama-server --pooling cls. The QUANT the
#                phone downloads, and the substrate OFFDOMAIN_OOV_FLOOR / OFFDOMAIN_HARD_FLOOR
#                were calibrated on ("re-tune HERE, on Q4_K_M, or the floor you pick is not the
#                floor that ships" — RagStore.ts).
#   transformers sentence-transformers/LaBSE raw-CLS (labse-embed-service.py). The exact method
#                that built the corpus blob, and measured at 0.99999 against QVAC's GGUF — but
#                fp32, so it is NOT the quantization the floors were cut against.
# Use `gguf` for anything that gates on the OFF-DOMAIN split; use `transformers` when you are
# regenerating corpus-space fixtures and want the blob's own method.
#
# Usage:
#   finetuning/eval/harness/embed-serve.sh                       # :8090, GGUF
#   EMBED_BACKEND=transformers finetuning/eval/harness/embed-serve.sh
# Stop:  pkill -f 'llama-server'  /  pkill -f labse-embed-service
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

BIN="${BIN:-/opt/homebrew/bin/llama-server}"
EMBED_PORT="${EMBED_PORT:-8090}"
NGL="${NGL:-99}"
BACKEND="${EMBED_BACKEND:-gguf}"

# deploy/models is gitignored, so in a linked worktree it lives only in the primary checkout.
GIT_COMMON="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
case "$GIT_COMMON" in
  "")  MAIN_ROOT="$ROOT" ;;
  /*)  MAIN_ROOT="$(dirname "$GIT_COMMON")" ;;
  *)   MAIN_ROOT="$(cd "$ROOT/$GIT_COMMON/.." 2>/dev/null && pwd || echo "$ROOT")" ;;
esac

if [ "$BACKEND" = "gguf" ]; then
  EMBED_MODEL="${EMBED_MODEL:-}"
  if [ -z "$EMBED_MODEL" ]; then
    for d in "$ROOT/deploy/models" "$MAIN_ROOT/deploy/models"; do
      [ -f "$d/labse.Q4_K_M.gguf" ] && { EMBED_MODEL="$d/labse.Q4_K_M.gguf"; break; }
    done
  fi
  [ -x "$BIN" ] || { echo "ERR: llama-server not at $BIN (set BIN=)"; exit 2; }
  [ -n "$EMBED_MODEL" ] && [ -f "$EMBED_MODEL" ] || { echo "ERR: labse.Q4_K_M.gguf not found (set EMBED_MODEL=)"; exit 2; }
  echo ">> embed :$EMBED_PORT  (LaBSE GGUF Q4_K_M — the floors' own substrate)"
  exec "$BIN" -m "$EMBED_MODEL" --embedding --pooling cls -ngl "$NGL" --port "$EMBED_PORT" --ctx-size 512
else
  PY="${EMBED_PY:-}"
  if [ -z "$PY" ]; then
    for c in "$ROOT/finetuning/.convert-venv/bin/python" "$MAIN_ROOT/finetuning/.convert-venv/bin/python"; do
      [ -x "$c" ] && { PY="$c"; break; }
    done
  fi
  [ -n "$PY" ] && [ -x "$PY" ] || { echo "ERR: .convert-venv python not found (set EMBED_PY=)"; exit 2; }
  echo ">> embed :$EMBED_PORT  (transformers raw-CLS — the corpus blob's own method)"
  exec "$PY" "$HERE/labse-embed-service.py" "$EMBED_PORT"
fi
