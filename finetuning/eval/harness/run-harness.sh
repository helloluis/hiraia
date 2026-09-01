#!/usr/bin/env bash
# ============================================================================
# run-harness.sh — the FORMAL gate for the on-device CARD WRITER.
#
# Boots the device-equivalent engine (the shipping GGUF, plus an adapter only if there is one)
# and the LaBSE query embedder, runs the model-free retrieval stress tests, then run-eval.mts
# (real card path + card-shape assertions), then tears everything down. Non-zero on any
# failure. There is no "pending", no advisory mode and no lexical fallback: the gate either
# renders a valid verdict or refuses to render one.
#
# RUN THIS (and require it green) BEFORE building an APK or asking a human to test on-device.
#
# Usage:
#   finetuning/eval/harness/run-harness.sh
#   MODEL=path/to/candidate.gguf ./run-harness.sh
#   ADAPTER=path/to/adapter.gguf ./run-harness.sh     # only if the candidate HAS one
#   SAMPLES=5 ./run-harness.sh                        # more draws per case
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
cd "$ROOT"

BIN="${BIN:-/opt/homebrew/bin/llama-server}"

# deploy/models is gitignored, so in a linked WORKTREE it exists only in the primary checkout.
# git-common-dir points at the main repo's .git from wherever we are.
GIT_COMMON="$(git -C "$ROOT" rev-parse --git-common-dir 2>/dev/null || true)"
case "$GIT_COMMON" in
  "")  MAIN_ROOT="$ROOT" ;;
  /*)  MAIN_ROOT="$(dirname "$GIT_COMMON")" ;;
  *)   MAIN_ROOT="$(cd "$ROOT/$GIT_COMMON/.." 2>/dev/null && pwd || echo "$ROOT")" ;;
esac
find_model() {  # $1 = filename; prefer this checkout, fall back to the primary one
  for d in "$ROOT/deploy/models" "$MAIN_ROOT/deploy/models" "$ROOT/packages/mobile/assets/models"; do
    [ -f "$d/$1" ] && { echo "$d/$1"; return 0; }
  done
  return 1
}

# THE SHIPPING MODEL: the CPT'd + SFT'd Qwen3.5-2B (Cryptopop/hiraia-sft-flagship-2b), which is
# what hiraia.org serves. It is a FULL-PARAMETER SFT — there is no adapter — so ADAPTER is
# optional and empty by default. (--lora with no adapter file is what used to make this script
# impossible to run against the new model at all.)
MODEL="${MODEL:-$(find_model hiraia-sft-2b-Q4_K_M.gguf || true)}"
ADAPTER="${ADAPTER:-}"
PORT="${PORT:-8088}"
NGL="${NGL:-99}"
CTX="${CTX:-4096}"

# THE EMBEDDER — and this choice is load-bearing, so it is a knob, not an accident.
#
# Two thirds of the card path's outcomes (gap vs off-domain) are decided by `isOffDomain` on a
# LaBSE cosine, against floors with very little headroom. There are two defensible embedders
# and the repo makes a measured claim for each:
#   gguf         labse.Q4_K_M.gguf via llama-server --pooling cls. This is the QUANT the phone
#                downloads, and RagStore.ts says the floors were re-measured through it
#                precisely because quantization moves top-1 cosine by min -0.037 / max +0.033 —
#                "re-tune HERE, on Q4_K_M, or the floor you pick is not the floor that ships".
#   transformers sentence-transformers raw-CLS (labse-embed-service.py). The method that BUILT
#                the corpus blob, measured at 0.99999 against QVAC's GGUF — but fp32.
# DEFAULT is gguf, because the thing this gate exists to protect is the off-domain split and
# those floors were cut on Q4_K_M. Set EMBED_BACKEND=transformers to run in the corpus blob's
# own space instead (that is the right choice when regenerating fixtures, not when gating).
# Whichever one ran is printed with the verdict, because the verdict depends on it.
EMBED_PORT="${EMBED_PORT:-8090}"
EMBED_BACKEND="${EMBED_BACKEND:-gguf}"
EMBED_MODEL="${EMBED_MODEL:-$(find_model labse.Q4_K_M.gguf || true)}"

[ -x "$BIN" ] || { echo "ERR: llama-server not at $BIN (set BIN=)"; exit 2; }
if [ -z "$MODEL" ] || [ ! -f "$MODEL" ]; then
  echo "ERR: model GGUF not found (set MODEL=). Looked for hiraia-sft-2b-Q4_K_M.gguf under"
  echo "     $ROOT/deploy/models and $MAIN_ROOT/deploy/models"
  exit 2
fi
if [ -n "$ADAPTER" ] && [ ! -f "$ADAPTER" ]; then echo "ERR: ADAPTER set but not a file: $ADAPTER"; exit 2; fi

echo ">> model:   $MODEL"
[ -n "$ADAPTER" ] && echo ">> adapter: $ADAPTER" || echo ">> adapter: none (full-parameter SFT)"

# ---------------------------------------------------------------------------------------
# BANK <-> cards.db <-> vectors-blob triangle, before anything reads any of them.
# The gate's retrieval runs off the JSONL, but the PHONE reads the bank out of cards.db and
# attaches the vectors blob to it, so an edit that rewrites facts in place (row count
# unchanged) can leave those three disagreeing while every test below stays green. On device
# the mismatch surfaces as attachSemantic throwing inside LocalEngine.initSemantic, which is
# caught and downgraded to a warning — a green gate would ship an APK that had silently fallen
# back to lexical-only retrieval. --check proves ordinal alignment, row content, the inverted
# index, and both hashes.
echo ">> checking fact bank <-> cards.db <-> vectors blob ..."
python3 "$ROOT/rag/pipeline/build-facts-db.py" --check || {
  echo "ERR: cards.db / vectors blob disagree with the fact bank — gate FAILS."
  echo "     rebuild: python3 rag/pipeline/build-cards-db.py  &&  python3 rag/scripts/build-vectors.py"
  exit 1;
}

# Retrieval stress-tests — model-independent and fast, so they fail before a server boots.
# Retrieval matters MORE to a card writer than it did to a chat tutor: two of the three card
# shapes are decided here and never reach the model at all.
echo ">> running retrieval stress-test (lexical, model-independent) ..."
"$ROOT/node_modules/.bin/tsx" "$ROOT/rag/pipeline/retrieval-stress.mts" || {
  echo "ERR: retrieval regressions — gate FAILS (see above)"; exit 1;
}
echo ">> running HYBRID retrieval gate (R1, model-independent) ..."
"$ROOT/node_modules/.bin/tsx" "$ROOT/rag/pipeline/hybrid-stress.mts" || {
  echo "ERR: hybrid R1 regressions — gate FAILS (see above)"; exit 1;
}

# ---------------------------------------------------------------------------------------
# Boot the embedder. GGUF via llama-server first (device-faithful quantization); otherwise the
# transformers raw-CLS service, which needs the gitignored .convert-venv — present only in the
# primary checkout, so look there too.
EMBED_PID=""
EMBED_KIND=""
if [ "$EMBED_BACKEND" = "gguf" ] && [ -n "$EMBED_MODEL" ] && [ -f "$EMBED_MODEL" ]; then
  echo ">> booting LaBSE embedder (GGUF Q4_K_M — the floors' own substrate) on :$EMBED_PORT ..."
  "$BIN" -m "$EMBED_MODEL" --embedding --pooling cls -ngl "$NGL" --port "$EMBED_PORT" --ctx-size 512 \
    > "$HERE/.embed.log" 2>&1 &
  EMBED_PID=$!; EMBED_KIND="gguf Q4_K_M ($EMBED_MODEL)"
else
  if [ -z "${EMBED_PY:-}" ]; then
    for _cand in "$ROOT/finetuning/.convert-venv/bin/python" "$MAIN_ROOT/finetuning/.convert-venv/bin/python"; do
      [ -x "$_cand" ] && { EMBED_PY="$_cand"; break; }
    done
  fi
  if [ -z "${EMBED_PY:-}" ] || [ ! -x "${EMBED_PY:-}" ]; then
    echo "ERR: no embedder. Wanted labse.Q4_K_M.gguf under deploy/models (set EMBED_MODEL=),"
    echo "     or the transformers service (set EMBED_PY=/path/to/.convert-venv/bin/python)."
    echo "     The card path ROUTES on LaBSE cosines: without one, every query looks off-domain"
    echo "     and the verdict would be about the missing embedder, not the model."
    exit 2
  fi
  echo ">> booting LaBSE embed service (transformers raw-CLS) on :$EMBED_PORT ..."
  "$EMBED_PY" "$HERE/labse-embed-service.py" "$EMBED_PORT" > "$HERE/.embed.log" 2>&1 &
  EMBED_PID=$!; EMBED_KIND="transformers raw-CLS"
fi
EMBED_READY=0
for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$EMBED_PORT/health" 2>/dev/null || true)" = "200" ] \
    && { EMBED_READY=1; echo ">> embedder ready ($EMBED_KIND)"; break; }
  if ! kill -0 $EMBED_PID 2>/dev/null; then
    echo "ERR: embedder died — see $HERE/.embed.log"; tail -15 "$HERE/.embed.log"; exit 2
  fi
  sleep 2
done
# The loop above only exits early when the embedder DIES. One that stays alive but never
# serves /health (slow load, wedged) used to fall out of it silently — the script then booted
# the card model anyway (~30s more) and run-eval died on `no embedder`, blaming the wrong step
# and never showing this log. Mirror the model's own readiness branch below.
[ $EMBED_READY -eq 1 ] || {
  echo "ERR: embedder not ready after 120s — see $HERE/.embed.log"; tail -15 "$HERE/.embed.log"; exit 2;
}

# ---------------------------------------------------------------------------------------
# Boot the card writer.
SERVER_PID=""
trap 'kill ${SERVER_PID:-} ${EMBED_PID:-} 2>/dev/null' EXIT
LORA_ARGS=()
[ -n "$ADAPTER" ] && LORA_ARGS=(--lora "$ADAPTER")
echo ">> booting model on :$PORT ..."
# `${LORA_ARGS[@]+...}` and not a bare `"${LORA_ARGS[@]}"`: macOS ships bash 3.2, where an
# EMPTY array expands to an unbound variable under `set -u` — so on the default (adapter-less)
# configuration, which is the one the shipping full-parameter SFT uses, this line aborted the
# script before llama-server was ever exec'd and the failure surfaced as "server died" with a
# STALE .server.log from the previous run.
"$BIN" -m "$MODEL" ${LORA_ARGS[@]+"${LORA_ARGS[@]}"} -ngl "$NGL" --port "$PORT" --ctx-size "$CTX" > "$HERE/.server.log" 2>&1 &
SERVER_PID=$!
READY=0
for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:$PORT/health" 2>/dev/null || true)" = "200" ] && { READY=1; break; }
  if ! kill -0 $SERVER_PID 2>/dev/null; then echo "ERR: server died — see $HERE/.server.log"; tail -15 "$HERE/.server.log"; exit 2; fi
  sleep 2
done
[ $READY -eq 1 ] || { echo "ERR: server not ready — see $HERE/.server.log"; exit 2; }

# ONE pass. There is no per-language adapter to swap any more: all three card languages run
# against the same weights, which is exactly how the phone and hiraia.org serve them.
echo ">> card gate ..."
ENDPOINT="http://localhost:$PORT" EMBED_ENDPOINT="http://localhost:$EMBED_PORT" \
  ${ADAPTER:+LORA_SCALE=1.0} \
  "$ROOT/node_modules/.bin/tsx" "$HERE/run-eval.mts"
RC=$?

echo ">> embedder was: $EMBED_KIND"
[ $RC -eq 0 ] && echo ">> GATE GREEN" || echo ">> GATE RED"
exit $RC
