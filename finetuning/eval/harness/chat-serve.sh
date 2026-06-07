#!/usr/bin/env bash
# ============================================================================
# chat-serve.sh — boot the TWO local servers the chat driver (chat-tutor.mts)
# talks to, so we can converse with the device-equivalent tutor WITHOUT a phone:
#
#   :8088  chat       — base Sailor2-3B GGUF + the grounded LoRA (the tutor)
#   :8090  embedding  — LaBSE QUERY embedder for HYBRID retrieval.
#
# Embedder fidelity: the phone embeds via QVAC's @qvac/embed-llamacpp (GGMLBert).
# `llama-server --pooling cls` only matches that at ~0.99 cosine (0.95 on some
# queries) — NOT 1:1, which shifts the abstain-floor cosines. So by DEFAULT we use
# the TRANSFORMERS raw-CLS service (labse-embed-service.py): the exact method that
# built the corpus blob and the verified device-equivalent (0.99999 vs the QVAC
# GGUF). Set EMBED_BACKEND=llama for the faster-but-approximate GGUF embedder.
#
# Leave running; chat-tutor.mts POSTs to both. Stop: pkill -f 'llama-server'; pkill -f labse-embed-service.
#
# Usage:  finetuning/eval/harness/chat-serve.sh   (blocks until both are healthy)
# ============================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

BIN="${BIN:-/opt/homebrew/bin/llama-server}"
BASE="${BASE:-$ROOT/deploy/models/Sailor2-3B-Chat.Q4_K_M.gguf}"
ADAPTER="${ADAPTER:-$ROOT/finetuning/adapters/adapter-tagalog-grounded-f16.gguf}"
EMBED="${EMBED:-/tmp/hiraia-serve/labse.Q4_K_M.gguf}"
CHAT_PORT="${CHAT_PORT:-8088}"
EMBED_PORT="${EMBED_PORT:-8090}"
CTX="${CTX:-4096}"
NGL="${NGL:-99}"

for f in "$BIN" "$BASE" "$ADAPTER" "$EMBED"; do
  [ -e "$f" ] || { echo "ERR: missing $f"; exit 2; }
done

wait_health() {
  for _ in $(seq 1 90); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$1/health" 2>/dev/null || true)" = "200" ] && return 0
    sleep 1
  done
  echo "ERR: server on $1 not healthy — see $2"; tail -12 "$2"; exit 2
}

echo ">> chat server  :$CHAT_PORT  (base + grounded LoRA) ..."
"$BIN" -m "$BASE" --lora "$ADAPTER" -ngl "$NGL" --port "$CHAT_PORT" --ctx-size "$CTX" \
  > /tmp/chat-serve.chat.log 2>&1 &
if [ "${EMBED_BACKEND:-transformers}" = "llama" ]; then
  echo ">> embed server :$EMBED_PORT  (LaBSE GGUF --pooling cls — APPROXIMATE ~0.99) ..."
  "$BIN" -m "$EMBED" --embedding --pooling cls -ngl "$NGL" --port "$EMBED_PORT" --ctx-size 512 \
    > /tmp/chat-serve.embed.log 2>&1 &
else
  echo ">> embed server :$EMBED_PORT  (transformers raw-CLS — DEVICE-EQUIVALENT 1:1) ..."
  PY="${PY:-$ROOT/finetuning/.convert-venv/bin/python}"
  "$PY" "$ROOT/finetuning/eval/harness/labse-embed-service.py" "$EMBED_PORT" \
    > /tmp/chat-serve.embed.log 2>&1 &
fi

wait_health "$CHAT_PORT" /tmp/chat-serve.chat.log
wait_health "$EMBED_PORT" /tmp/chat-serve.embed.log
echo ">> BOTH READY — chat:$CHAT_PORT embed:$EMBED_PORT"
echo "   (leave running; chat-tutor.mts will POST here. pkill -f 'llama-server' to stop.)"
