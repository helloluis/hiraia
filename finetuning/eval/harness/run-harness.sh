#!/usr/bin/env bash
# ============================================================================
# run-harness.sh — the FORMAL behavioral gate for the on-device tutor.
#
# Boots a local llama-server with the device's EXACT base GGUF + the adapter
# GGUF (the device-equivalent engine), runs run-eval.mts (real runtime prompts
# + assertions), then tears the server down. Exits non-zero on any failure.
#
# RUN THIS (and require it green) BEFORE building an APK / asking a human to
# test on-device. It catches: confabulation, adapter-not-applied, grounding
# regressions, and lecturing on chit-chat.
#
# Usage:
#   finetuning/eval/harness/run-harness.sh
#   ADAPTER=path/to/adapter.gguf BASE=path/to/base.gguf ./run-harness.sh
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"

BIN="${BIN:-/opt/homebrew/bin/llama-server}"
BASE="${BASE:-$ROOT/deploy/models/Sailor2-3B-Chat.Q4_K_M.gguf}"
ADAPTER="${ADAPTER:-$ROOT/finetuning/adapters/adapter-tagalog-grounded-f16.gguf}"
PORT="${PORT:-8088}"
NGL="${NGL:-99}"

[ -x "$BIN" ] || { echo "ERR: llama-server not at $BIN (set BIN=)"; exit 2; }
[ -f "$BASE" ] || { echo "ERR: base GGUF not at $BASE (set BASE=)"; exit 2; }
[ -f "$ADAPTER" ] || { echo "ERR: adapter GGUF not at $ADAPTER (set ADAPTER=)"; exit 2; }

echo ">> base:    $BASE"
echo ">> adapter: $ADAPTER"
echo ">> starting llama-server on :$PORT ..."
"$BIN" -m "$BASE" --lora "$ADAPTER" -ngl "$NGL" --port "$PORT" --ctx-size 4096 \
  > "$HERE/.server.log" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

# wait for readiness (model load can take ~20-40s)
echo ">> waiting for server /health ..."
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/health" 2>/dev/null || true)
  [ "$code" = "200" ] && { echo ">> server ready"; break; }
  if ! kill -0 $SERVER_PID 2>/dev/null; then echo "ERR: server died — see $HERE/.server.log"; tail -15 "$HERE/.server.log"; exit 2; fi
  sleep 2
done

echo ">> running behavioral gate ..."
ENDPOINT="http://localhost:$PORT" "$ROOT/node_modules/.bin/tsx" "$HERE/run-eval.mts"
RC=$?

echo ">> stopping server"
exit $RC
