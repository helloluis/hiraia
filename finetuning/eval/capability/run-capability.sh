#!/usr/bin/env bash
# ============================================================================
# run-capability.sh — one command to boot a local LLM and SCORE it on the
# Hiraia capability benchmark (the 0–5, ~100-probe instrument; see README.md).
#
# This is NOT the regression gate (run-harness.sh, green/red). It boots the
# device-equivalent engine (base GGUF + the SHIPPING per-language adapter), runs
# every probe through it, and produces answers to be judged 0–5.
#
# Two adapter passes, mirroring the device (which loads a per-language LoRA):
#   pass 1  TAGALOG adapter  → tl + en probes  (88)  → capability-answers.tagalog.json
#   pass 2  BISAYA  adapter  → bis probes      (14)  → capability-answers.bisaya.json
#
# Judging (phase 2) honors "subscription, not API":
#   - DEFAULT: stops after collecting answers and tells you to score them with the
#     Claude judging workflow (no API key). Then PHASE=report merges + prints.
#   - JUDGE_ENDPOINT set: scores inline via an OpenAI-compatible endpoint and prints
#     the Capability Score immediately.
#
# Defaults are the EXACT bundled weights (hash-matched to packages/mobile/assets):
#   tagalog = adapter-tagalog-ttft-f16.gguf   bisaya = adapter-sailor-bisaya-f16.gguf
#
# Usage:
#   finetuning/eval/capability/run-capability.sh                 # answers only, device temp
#   SAMPLES=3 finetuning/eval/capability/run-capability.sh       # worst-of-3 per probe
#   JUDGE_ENDPOINT=http://localhost:9099 JUDGE_MODEL=qwen2.5-14b \
#     finetuning/eval/capability/run-capability.sh               # inline judge + report
#   ADAPTER=path/to/candidate.gguf finetuning/eval/capability/run-capability.sh   # A/B a candidate
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"

BIN="${BIN:-/opt/homebrew/bin/llama-server}"
BASE="${BASE:-$ROOT/deploy/models/Sailor2-3B-Chat.Q4_K_M.gguf}"
# SHIPPING adapters (hash-matched to packages/mobile/assets/models/*.gguf). Override
# ADAPTER= / BIS_ADAPTER= to A/B a candidate (SFT-rebalanced, distilled, …).
ADAPTER="${ADAPTER:-$ROOT/finetuning/adapters/adapter-tagalog-ttft-f16.gguf}"
BIS_ADAPTER="${BIS_ADAPTER:-$ROOT/finetuning/adapters/adapter-sailor-bisaya-f16.gguf}"
PORT="${PORT:-8089}"            # avoid 8088 (run-harness) / 8090 (embed)
NGL="${NGL:-99}"
CTX="${CTX:-4096}"             # PER-SLOT context (device path). Total KV = CTX * NP.
TEMP="${TEMP:-0.7}"            # device runs hot; capability = typical behavior
SAMPLES="${SAMPLES:-1}"        # >1 → keep the WORST sample per probe
# Continuous batching: NP=1 (off) by DEFAULT — measured no local speedup on a single
# Metal GPU (compute-bound; NP=6 was ~10% SLOWER, FINDINGS F3). Raise NP+CONC together
# ONLY on a latency-bound cloud GPU. For fast local iteration, lower SAMPLES instead.
NP="${NP:-1}"                 # parallel decode slots (continuous batching)
CONC="${CONC:-$NP}"           # client-side concurrency; match the server's slot count
TSX="$ROOT/node_modules/.bin/tsx"

[ -x "$BIN" ]   || { echo "ERR: llama-server not at $BIN (set BIN=)"; exit 2; }
[ -f "$BASE" ]  || { echo "ERR: base GGUF not at $BASE (set BASE=)"; exit 2; }
[ -f "$ADAPTER" ]     || { echo "ERR: tagalog adapter not at $ADAPTER (set ADAPTER=)"; exit 2; }
[ -f "$BIS_ADAPTER" ] || { echo "ERR: bisaya adapter not at $BIS_ADAPTER (set BIS_ADAPTER=)"; exit 2; }
[ -x "$TSX" ]   || { echo "ERR: tsx not at $TSX — run npm/yarn install"; exit 2; }

boot() {
  # -np/--cont-batching: N parallel decode slots so the client's concurrent requests
  # overlap. --ctx-size here is TOTAL KV split across slots, so size it NP * per-slot CTX.
  "$BIN" -m "$BASE" --lora "$1" -ngl "$NGL" --port "$PORT" \
    -np "$NP" --cont-batching --ctx-size "$((CTX * NP))" > "$HERE/.server.log" 2>&1 &
  SERVER_PID=$!
  for _ in $(seq 1 90); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/health" 2>/dev/null || true)" = "200" ] && return 0
    if ! kill -0 $SERVER_PID 2>/dev/null; then echo "ERR: server died — see $HERE/.server.log"; tail -15 "$HERE/.server.log"; exit 2; fi
    sleep 2
  done
  echo "ERR: server not ready"; exit 2
}
stop() { kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null || true; }
trap 'kill ${SERVER_PID:-0} 2>/dev/null' EXIT

run_pass() { # $1=tag  $2=adapter
  echo ">> [$1] booting $(basename "$2") on :$PORT ..."; boot "$2"
  echo ">> [$1] collecting answers (temp $TEMP, samples $SAMPLES, conc $CONC) ..."
  ENDPOINT="http://localhost:$PORT" ADAPTER_TAG="$1" TEMP="$TEMP" SAMPLES="$SAMPLES" CONC="$CONC" \
    ${JUDGE_ENDPOINT:+JUDGE_ENDPOINT="$JUDGE_ENDPOINT"} ${JUDGE_MODEL:+JUDGE_MODEL="$JUDGE_MODEL"} \
    "$TSX" "$HERE/run-capability.mts" || { echo "ERR: pass $1 failed"; exit 1; }
  stop
}

echo ">> base:    $BASE"
echo ">> tagalog: $ADAPTER"
echo ">> bisaya:  $BIS_ADAPTER"
run_pass tagalog "$ADAPTER"
run_pass bisaya  "$BIS_ADAPTER"

echo ""
if [ -n "${JUDGE_ENDPOINT:-}" ]; then
  echo ">> both passes judged inline. Merged 102-probe report:"
  PHASE=report ${BASELINE:+BASELINE="$BASELINE"} "$TSX" "$HERE/run-capability.mts"
else
  echo "================================================================"
  echo "  ANSWERS COLLECTED (not yet judged):"
  echo "    $HERE/capability-answers.tagalog.json   (tl/en probes)"
  echo "    $HERE/capability-answers.bisaya.json    (bis probes)"
  echo ""
  echo "  To SCORE on the Claude subscription (no API key): run the judging"
  echo "  workflow — one judge agent per answer (rubric.md + probe + answer →"
  echo "  strict-JSON {accuracy,helpfulness,faithfulness,naturalness,pedagogy,notes}),"
  echo "  write capability-scores.<tag>.json per pass, then:"
  echo "    PHASE=report $TSX $HERE/run-capability.mts"
  echo "  (merges both passes → Capability Score + tier/dimension breakdown)."
  echo ""
  echo "  Or re-run with JUDGE_ENDPOINT=... for an inline (local/API) judge."
  echo "================================================================"
fi
