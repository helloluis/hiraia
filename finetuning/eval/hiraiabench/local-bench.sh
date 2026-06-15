#!/usr/bin/env bash
# Boot a local llama-server for one model (+ optional LoRA), run the hiraiabench
# probe pool through it, then tear the server down. For the small models we can
# run on the Mac (Hiraia-v7, Sailor2-3B base, Qwen3-1.7B).
#   MODEL=hiraia-v7 BASE=.../Sailor2.gguf ADAPTER=.../v7.gguf ./local-bench.sh
#   MODEL=sailor2-3b BASE=.../Sailor2.gguf ./local-bench.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${BIN:-/opt/homebrew/bin/llama-server}"
PORT="${PORT:-8077}"
NGL="${NGL:-99}"
CTX="${CTX:-4096}"
: "${MODEL:?set MODEL}"; : "${BASE:?set BASE gguf}"
[ -x "$BIN" ] || { echo "ERR: no llama-server at $BIN"; exit 2; }
[ -f "$BASE" ] || { echo "ERR: base gguf $BASE missing"; exit 2; }

ARGS=(-m "$BASE" -ngl "$NGL" --port "$PORT" --ctx-size "$CTX")
[ -n "${ADAPTER:-}" ] && ARGS+=(--lora "$ADAPTER")
echo ">> booting $MODEL: $BIN ${ARGS[*]}"
"$BIN" "${ARGS[@]}" > "/tmp/bench-$MODEL.server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for _ in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/health" 2>/dev/null || true)" = "200" ] && break
  kill -0 $SRV 2>/dev/null || { echo "ERR: server died"; tail -15 "/tmp/bench-$MODEL.server.log"; exit 2; }
  sleep 2
done
echo ">> $MODEL ready; running bench ..."
ENDPOINT="http://localhost:$PORT" MODEL="$MODEL" node "$HERE/bench-run.mjs"
echo ">> $MODEL done."
