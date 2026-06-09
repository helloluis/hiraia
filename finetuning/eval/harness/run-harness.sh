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
echo ">> running retrieval stress-test (lexical, model-independent) ..."
"$ROOT/node_modules/.bin/tsx" "$ROOT/rag/pipeline/retrieval-stress.mts" || {
  echo "ERR: retrieval regressions — gate FAILS (see above)"; exit 1;
}

# HYBRID retrieval gate (R1): the device path (LaBSE + abstain floor) that the lexical
# test above can't see. Runs OFFLINE against precomputed faithful query vectors
# (hybrid-stress.qvecs.json) — no embedder needed at gate time. Guards the floor +
# normalizeQuery calibration so covered topics keep grounding and out-of-bank keeps
# abstaining. Regenerate fixtures (gen-hybrid-fixtures.mts, embedder up) on bank/
# embedder/normalization changes.
echo ">> running HYBRID retrieval gate (R1, model-independent) ..."
"$ROOT/node_modules/.bin/tsx" "$ROOT/rag/pipeline/hybrid-stress.mts" || {
  echo "ERR: hybrid R1 regressions — gate FAILS (see above)"; exit 1;
}

# The Bisaya LoRA that matches Sailor2-3B (== the shipping mobile adapter-bisaya.gguf;
# the older adapter-bisaya-f16.gguf is a different-arch build and won't load).
BIS_ADAPTER="${BIS_ADAPTER:-$ROOT/finetuning/adapters/adapter-sailor-bisaya-f16.gguf}"
echo ">> base:    $BASE"

# Boot the LaBSE embed service on :8090 so run-eval.mts uses the device's HYBRID retrieval
# (FINDINGS F7) — lexical-only gave false Cebuano fails (correct answers failing retrieval-id
# assertions on garbage lexical grounding). run-eval defaults EMBED_ENDPOINT to :8090 and
# self-detects; if the embedder is absent it falls back to lexical with a warning.
EMBED_PORT="${EMBED_PORT:-8090}"
EMBED_PY="${EMBED_PY:-$ROOT/finetuning/.convert-venv/bin/python}"
EMBED_PID=""
if [ -x "$EMBED_PY" ] && [ -f "$HERE/labse-embed-service.py" ]; then
  echo ">> booting LaBSE embed service on :$EMBED_PORT (device-faithful retrieval) ..."
  "$EMBED_PY" "$HERE/labse-embed-service.py" "$EMBED_PORT" > "$HERE/.embed.log" 2>&1 &
  EMBED_PID=$!
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$EMBED_PORT/health" 2>/dev/null || true)" = "200" ] && { echo ">> embedder ready"; break; }
    if ! kill -0 $EMBED_PID 2>/dev/null; then echo "WARN: embedder died — gate runs LEXICAL (see $HERE/.embed.log)"; EMBED_PID=""; break; fi
    sleep 2
  done
else
  echo "WARN: embedder ($EMBED_PY) missing — gate runs LEXICAL-ONLY (not device-faithful)"
fi

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
trap 'kill $SERVER_PID ${EMBED_PID:-} 2>/dev/null' EXIT
RC=0

# --- Pass 1: TAGALOG adapter — tagalog/english cases + homonym + PH civics/geo +
#     emoji, then the compaction probe. ---
echo ">> [tagalog] booting $ADAPTER ..."; boot "$ADAPTER"
echo ">> [tagalog] behavioral gate ..."
ADAPTER_TAG=tagalog ENDPOINT="http://localhost:$PORT" "$ROOT/node_modules/.bin/tsx" "$HERE/run-eval.mts" || RC=1

# Device-temp deflection probe: the gate above runs temp 0 (deterministic), but the
# DEVICE runs at the model's DEFAULT temp (~0.8, LocalEngine.chat sets none) where the
# grounded adapter can STOCHASTICALLY punt on a vaguely-phrased-but-covered query
# (e.g. "May homework ako tungkol sa Venus" → "hindi ako sigurado… tanungin ang guro")
# even though retrieval supplied the facts. This re-runs the mustGround cases at temp
# 0.8 ×5 and REPORTS the per-case deflection rate. INFORMATIONAL: the over-abstention
# is a known/pending behavior (those cases carry pending:true), so it never blocks; it
# exists to MEASURE the rate release-over-release. Skip with SKIP_GROUNDING_TEMP=1.
if [ "${SKIP_GROUNDING_TEMP:-0}" != "1" ]; then
  echo ">> [tagalog] device-temp deflection probe (mustGround @ temp ${GROUND_TEMP:-0.8} ×${GROUND_SAMPLES:-5}) — informational ..."
  ADAPTER_TAG=tagalog ENDPOINT="http://localhost:$PORT" TEMP="${GROUND_TEMP:-0.8}" SAMPLES="${GROUND_SAMPLES:-5}" \
    CASES="homework-grounds,venus-why-hot" "$ROOT/node_modules/.bin/tsx" "$HERE/run-eval.mts" \
    || echo ">> NOTE: device-temp probe surfaced over-abstention — informational (known, pending the next grounded adapter)."
fi

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
