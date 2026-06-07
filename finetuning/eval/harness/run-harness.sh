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
# MUST match ACTIVE_MODEL.ctxSize in packages/mobile/src/config/model.ts so the
# gate catches on-device context-overflow (the longctx-multiturn guard relies on it).
CTX="${CTX:-4096}"

[ -x "$BIN" ] || { echo "ERR: llama-server not at $BIN (set BIN=)"; exit 2; }
[ -f "$BASE" ] || { echo "ERR: base GGUF not at $BASE (set BASE=)"; exit 2; }
[ -f "$ADAPTER" ] || { echo "ERR: adapter GGUF not at $ADAPTER (set ADAPTER=)"; exit 2; }

# Retrieval stress-test runs FIRST — model-independent, fast, and codifies the
# on-device "weird encounter" regressions (verb-hijack, distractor, follow-up
# context, conversational novelty). Fail fast before spinning up the server.
echo ">> running retrieval stress-test (model-independent) ..."
"$ROOT/node_modules/.bin/tsx" "$ROOT/rag/pipeline/retrieval-stress.mts" || {
  echo "ERR: retrieval regressions — gate FAILS (see above)"; exit 1;
}

# The Bisaya LoRA that matches Sailor2-3B (== the shipping mobile adapter-bisaya.gguf;
# the older adapter-bisaya-f16.gguf is a different-arch build and won't load).
BIS_ADAPTER="${BIS_ADAPTER:-$ROOT/finetuning/adapters/adapter-sailor-bisaya-f16.gguf}"
echo ">> base:    $BASE"

# Boot a llama-server on $PORT with the given adapter and wait for /health.
boot() {
  "$BIN" -m "$BASE" --lora "$1" -ngl "$NGL" --port "$PORT" --ctx-size "$CTX" > "$HERE/.server.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/health" 2>/dev/null || true)" = "200" ] && return 0
    if ! kill -0 $SERVER_PID 2>/dev/null; then echo "ERR: server died — see $HERE/.server.log"; tail -15 "$HERE/.server.log"; exit 2; fi
    sleep 2
  done
  echo "ERR: server not ready"; exit 2
}
stop() { kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null || true; }
trap 'kill $SERVER_PID 2>/dev/null' EXIT
RC=0

# --- Pass 1: TAGALOG adapter — tagalog/english cases + homonym + PH civics/geo +
#     emoji, then the compaction probe. ---
echo ">> [tagalog] booting $ADAPTER ..."; boot "$ADAPTER"
echo ">> [tagalog] behavioral gate ..."
ADAPTER_TAG=tagalog ENDPOINT="http://localhost:$PORT" "$ROOT/node_modules/.bin/tsx" "$HERE/run-eval.mts" || RC=1

# Compaction probe: acceptance test for the auto-compacter's summarize(). The
# grounded adapter's tutor persona can fight the summarize instruction, so this is
# INFORMATIONAL by default; set REQUIRE_COMPACTION=1 to make it block.
echo ">> [tagalog] compaction probe ..."
ENDPOINT="http://localhost:$PORT" "$ROOT/node_modules/.bin/tsx" "$HERE/probe-compaction.mts"; RC_COMPACT=$?
if [ "${REQUIRE_COMPACTION:-0}" = "1" ]; then [ $RC_COMPACT -ne 0 ] && RC=1
elif [ $RC_COMPACT -ne 0 ]; then echo ">> NOTE: compaction probe failed — informational (awaits summarization adapter)."; fi
stop

# --- Pass 2: BISAYA adapter — cebuano cases run against the REAL device path
#     (the Bisaya LoRA), not the Tagalog one. ---
if [ -f "$BIS_ADAPTER" ]; then
  echo ">> [bisaya] booting $BIS_ADAPTER ..."; boot "$BIS_ADAPTER"
  echo ">> [bisaya] behavioral gate ..."
  ADAPTER_TAG=bisaya ENDPOINT="http://localhost:$PORT" "$ROOT/node_modules/.bin/tsx" "$HERE/run-eval.mts" || RC=1
  stop
else
  echo ">> WARN: bisaya adapter not at $BIS_ADAPTER — skipping cebuano pass"
fi

[ $RC -eq 0 ] && echo ">> GATE GREEN" || echo ">> GATE RED"
exit $RC
