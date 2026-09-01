#!/usr/bin/env bash
# ============================================================================
# run-arbitration.sh — boots the LaBSE embedder and runs the QUERY-ARBITRATION gate.
#
# NO LLM. The arbitration between served-existing / generated / gap / offdomain is entirely
# model-free — search decides the first, retrieval plus the two floors decide the rest, all
# before a token is generated — so this gate never loads the 2B card writer and runs in
# seconds. (The card the model then WRITES for a `generated` outcome is the card gate's
# business: finetuning/eval/harness/run-harness.sh.)
#
# The embedder is NOT optional and there is no lexical fallback: `isOffDomain` reads a LaBSE
# cosine against OFFDOMAIN_OOV_FLOOR 0.62 / OFFDOMAIN_HARD_FLOOR 0.40, so without one every
# query looks off-domain and a verdict would be about the missing embedder. Same GGUF Q4_K_M
# the phone downloads and the same `--pooling cls` boot as run-harness.sh, because those
# floors were re-measured through that quantization.
#
#   finetuning/eval/routing/arbitration/run-arbitration.sh
#   BUCKETS=out-of-scope ./run-arbitration.sh          # one bucket
#   CASES=gravity,tsunami ./run-arbitration.sh         # substring id filter
#   JSON_OUT=/tmp/arb.json ./run-arbitration.sh        # dump for a diff against the next run
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
cd "$ROOT"

BIN="${BIN:-/opt/homebrew/bin/llama-server}"
EMBED_PORT="${EMBED_PORT:-8090}"

# deploy/models is gitignored, so in a linked WORKTREE it exists only in the primary checkout.
# git-common-dir points at the main repo's .git from wherever we are. (Same lookup as
# run-harness.sh — kept identical so the two gates cannot end up on different LaBSE files.)
GIT_COMMON="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
case "$GIT_COMMON" in
  "")  MAIN_ROOT="$ROOT" ;;
  /*)  MAIN_ROOT="$(dirname "$GIT_COMMON")" ;;
  *)   MAIN_ROOT="$(cd "$ROOT/$GIT_COMMON/.." 2>/dev/null && pwd || echo "$ROOT")" ;;
esac
find_model() {
  for d in "$ROOT/deploy/models" "$MAIN_ROOT/deploy/models" "$ROOT/packages/mobile/assets/models"; do
    [ -f "$d/$1" ] && { echo "$d/$1"; return 0; }
  done
  return 1
}
EMBED_MODEL="${EMBED_MODEL:-$(find_model labse.Q4_K_M.gguf || true)}"

if [ -z "$EMBED_MODEL" ] || [ ! -f "$EMBED_MODEL" ]; then
  echo "ERR: labse.Q4_K_M.gguf not found under deploy/models (set EMBED_MODEL=)."
  echo "     The gap/offdomain arm ROUTES on LaBSE cosines. This gate REFUSES to run"
  echo "     lexical-only: the verdict would be about the missing embedder, not the routing."
  exit 2
fi
[ -x "$BIN" ] || { echo "ERR: llama-server not at $BIN (set BIN=)"; exit 2; }

# Reuse an embedder that is already up (run-harness.sh may have left one on :8090) — but only
# if it is the RIGHT one. A 200 on /health says something is answering, not that it is
# labse.Q4_K_M, and the floors this gate routes on were re-measured through that quantization
# with verdicts sitting inside 0.005 of them. Reusing an f16 LaBSE, a different pooling or an
# unrelated model would print a confident verdict about the routing that is really a verdict
# about the substrate. (run-arbitration.mts re-checks the same thing over /props, so a
# standalone tsx run cannot slip past either.)
REUSED=0
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:$EMBED_PORT/health" 2>/dev/null || true)" = "200" ]; then
  LOADED="$(curl -s --max-time 3 "http://localhost:$EMBED_PORT/props" 2>/dev/null | tr ',' '\n' | grep -oE '"model_path" *: *"[^"]*"' | head -1)"
  [ -n "$LOADED" ] || LOADED="$(curl -s --max-time 3 "http://localhost:$EMBED_PORT/v1/models" 2>/dev/null | tr ',' '\n' | grep -oE '"id" *: *"[^"]*"' | head -1)"
  case "$LOADED" in
    *[Ll]abse*[Qq]4_[Kk]_[Mm]*)
      echo ">> embedder already serving on :$EMBED_PORT — reusing it ($LOADED)"
      REUSED=1 ;;
    *)
      echo "ERR: :$EMBED_PORT answers /health but is not labse.Q4_K_M — ${LOADED:-<model could not be identified>}"
      echo "     This gate needs that exact build (the floors' own substrate) and some verdicts sit"
      echo "     within 0.02 of a floor. Free the port, or set EMBED_PORT= to boot elsewhere."
      exit 2 ;;
  esac
fi
if [ $REUSED -eq 0 ]; then
  echo ">> booting LaBSE embedder (GGUF Q4_K_M — the floors' own substrate) on :$EMBED_PORT ..."
  "$BIN" -m "$EMBED_MODEL" --embedding --pooling cls -ngl "${NGL:-99}" --port "$EMBED_PORT" --ctx-size 512 \
    > "$HERE/.embed.log" 2>&1 &
  EMBED_PID=$!
  trap 'kill ${EMBED_PID:-} 2>/dev/null' EXIT
  READY=0
  for _ in $(seq 1 60); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$EMBED_PORT/health" 2>/dev/null || true)" = "200" ] \
      && { READY=1; break; }
    # A dead embedder and a wedged one are different failures and used to look the same:
    # the loop below only exited early on death, so a slow/wedged load fell out silently.
    if ! kill -0 $EMBED_PID 2>/dev/null; then
      echo "ERR: embedder died — see $HERE/.embed.log"; tail -15 "$HERE/.embed.log"; exit 2
    fi
    sleep 2
  done
  [ $READY -eq 1 ] || {
    echo "ERR: embedder not ready after 120s — see $HERE/.embed.log"; tail -15 "$HERE/.embed.log"; exit 2;
  }
  echo ">> embedder ready (gguf Q4_K_M: $EMBED_MODEL)"
fi

EMBED_ENDPOINT="http://localhost:$EMBED_PORT" \
  "$ROOT/node_modules/.bin/tsx" "$HERE/run-arbitration.mts"
RC=$?
[ $REUSED -eq 1 ] && echo ">> (embedder was pre-existing; left running)"
exit $RC
