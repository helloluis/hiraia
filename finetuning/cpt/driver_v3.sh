#!/usr/bin/env bash
# ============================================================================
# driver_v3.sh — corpus-v3 end-to-end driver (runs ON the expansion pod,
# DETACHED; /workspace = hiraia-cpt-expansion 6er6skgoyb).
#
# Steps: DCAD pull -> OPUS harvest -> DepEd crawl -> prep pools -> shuf ->
# SailCraft stages (ceb then tl) -> verify finals -> Qwen3.5 token yield ->
# report -> rm intermediates -> SELF-TERMINATE (trap EXIT).
#
# Env via /root/.driver-env (pod env does NOT reach SSH sessions — v2 lesson).
# ============================================================================
set -uo pipefail
[ -f /root/.driver-env ] && { set -a; . /root/.driver-env; set +a; }
export SAILCRAFT=/workspace/sailcraft-run
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$SAILCRAFT/.venv/bin:$PATH"
PULL_PY=/workspace/venv-pull/bin/python
CORPUS=/workspace/corpus
LOGDIR=$CORPUS/logs
mkdir -p "$LOGDIR" "$CORPUS/raw"
STATUS="FAILED (driver died mid-run)"

step(){ echo; echo "=== [$(date -u +%FT%TZ)] $* ==="; }

finish(){
  rc=$?
  step "driver exiting rc=$rc status=$STATUS"
  {
    echo ""
    echo "## Run $(date -u +%F) — pod ${RUNPOD_POD_ID:-unknown} (v3)"
    echo "- status: $STATUS"
    echo "- pod: ${RUNPOD_POD_ID:-?} (H100 SXM on-demand US-NE-1, self-terminated)"
    echo "- see EXPANSION-REPORT-v3.md for yields"
  } >> "$CORPUS/LEDGER.md" 2>/dev/null || true
  if [ "${SELF_TERMINATE:-1}" = 1 ] && [ -n "${RUNPOD_API_KEY:-}" ] && [ -n "${RUNPOD_POD_ID:-}" ]; then
    echo ">> self-terminating pod $RUNPOD_POD_ID"
    curl -s --max-time 30 -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" \
      "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID" -w "terminate: HTTP %{http_code}\n" || true
  fi
}
trap finish EXIT

step "disk check"; df -h /workspace
FREE_GB=$(df --output=avail -BG /workspace | tail -1 | tr -dc '0-9')
[ "${FREE_GB:-0}" -ge 80 ] || { echo "ABORT: <80GB free on volume"; exit 1; }

step "1/6 DCAD-2000 pull (fil mala-keep + fw2-remove; ceb mala-keep + new_cc)"
HF_TOKEN="${HF_TOKEN:-}" $PULL_PY -u /root/pull_corpus_v3.py

step "2/6 OPUS tl+ceb mono harvest"
$PULL_PY -u /root/harvest_opus.py

step "3/6 DepEd LR portal crawl (Drive PDFs -> pdftotext)"
$PULL_PY -u /root/crawl_deped.py

step "4/6 prep pools (v3 = new material only, DCAD quality pre-filter)"
SAILCRAFT=$SAILCRAFT "$SAILCRAFT/.venv/bin/python" -u /root/prep_pools_v3.py

step "5/6 shuffle pools"
for p in pool_ceb_v3 pool_tl_v3; do
  f="$SAILCRAFT/data/data_input/$p.jsonl"
  [ -s "$f" ] && { shuf "$f" -o "$f.shuf" && mv "$f.shuf" "$f"; echo "shuffled $f ($(wc -l < "$f") docs)"; }
done

step "6/6 SailCraft stages — ceb then tl"
for spec in "ceb pool_ceb_v3" "tl pool_tl_v3"; do
  set -- $spec
  [ -s "$SAILCRAFT/data/data_input/$2.jsonl" ] || { echo ">> skip $2 (empty/missing)"; continue; }
  SELF_TERMINATE=0 SAILCRAFT=$SAILCRAFT ALIAS="$2" LANG_ID="$1" \
    bash /root/run_sailcraft_stages.sh
  if [ -s "$SAILCRAFT/data/data_output/final_output/$2/data_clean.jsonl" ]; then
    rm -rf "$SAILCRAFT/data/data_output/near_dedup_output/$2" \
           "$SAILCRAFT/data/data_output/exact_dedup_output/$2" \
           "$SAILCRAFT/cache/near_dedup_cache" "$SAILCRAFT/cache/exact_dedup_cache"
    echo ">> intermediates for $2 removed"; df -h /workspace | tail -1
  fi
done

step "verify finals + measure Qwen3.5 token yield"
VERIFY=$($PULL_PY - <<'PYEOF'
import json, os
SC = "/workspace/sailcraft-run/data/data_output/final_output"
ok = True
for pool in ("pool_ceb_v3", "pool_tl_v3"):
    p = f"{SC}/{pool}/data_clean.jsonl"
    if not os.path.exists(p):
        print(f"{pool}: MISSING"); ok = False; continue
    n = sum(1 for _ in open(p, "rb"))
    with open(p, encoding="utf-8") as f:
        first = f.readline()
    with open(p, "rb") as f:
        f.seek(0, 2); size = f.tell(); f.seek(max(0, size - 100000))
        last = f.readlines()[-1]
    try:
        json.loads(first); json.loads(last)
        print(f"{pool}: {n} lines, head+tail JSON OK, {os.path.getsize(p)/1e9:.2f} GB")
    except Exception as e:
        print(f"{pool}: JSON PARSE FAIL {e}"); ok = False
print("VERIFY=" + ("OK" if ok else "FAIL"))
PYEOF
)
echo "$VERIFY"
echo "$VERIFY" | grep -q "VERIFY=OK" && STATUS="OK (finals verified)"

FINALS=""
for pool in pool_ceb_v3 pool_tl_v3; do
  f="$SAILCRAFT/data/data_output/final_output/$pool/data_clean.jsonl"
  [ -s "$f" ] && FINALS="$FINALS $f"
done
[ -n "$FINALS" ] && HF_TOKEN="${HF_TOKEN:-}" $PULL_PY -u /root/measure_tokens.py \
  $FINALS --out "$CORPUS/TOKEN-YIELD.v3.json" || echo ">> no finals to measure"

step "write EXPANSION-REPORT-v3.md"
{
  echo "# Corpus expansion (v3) report — $(date -u +%F)"
  echo ""
  echo "Pod ${RUNPOD_POD_ID:-?} / volume hiraia-cpt-expansion (6er6skgoyb), self-terminated."
  echo "v3 sources: DCAD-2000 fil/ceb (mala keep + fw2 remove + new_cc), OPUS mono tl/ceb,"
  echo "DepEd LR portal (Google Site, Drive PDFs). BalitaNLP dropped (license). LRMDS"
  echo "skipped (JS/session-gated downloads)."
  echo ""
  echo '## Verification'; echo '```'; echo "$VERIFY"; echo '```'
  echo ""; echo '## Token yield (Qwen3.5 tokenizer, 10k-doc sample extrapolated by bytes)'
  echo '```'; cat "$CORPUS/TOKEN-YIELD.v3.json" 2>/dev/null || echo "(no measurement)"; echo '```'
  echo ""; echo '## Pool inputs (incl. DCAD pre-filter drops)'
  echo '```'; cat "$SAILCRAFT/data/data_input/POOLS-MANIFEST.v3.json" 2>/dev/null; echo '```'
  echo ""; echo '## DepEd crawl stats'
  echo '```'; cat "$CORPUS/raw/deped-lrportal/CRAWL-STATS.json" 2>/dev/null; echo '```'
  echo ""; echo '## Pull manifest'
  echo '```'; cat "$CORPUS/raw/MANIFEST.v3.json" 2>/dev/null; echo '```'
} > "$CORPUS/EXPANSION-REPORT-v3.md"

step "final disk state"; df -h /workspace; du -sh "$CORPUS"/raw/* 2>/dev/null
echo "=== DRIVER DONE: $STATUS ==="
