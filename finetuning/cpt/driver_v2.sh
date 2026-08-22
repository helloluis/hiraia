#!/usr/bin/env bash
# ============================================================================
# driver_v2.sh — corpus-v2 end-to-end driver (runs ON the expansion pod,
# DETACHED via nohup; /workspace = hiraia-cpt-expansion 6er6skgoyb).
#
# Steps: pull MADLAD fil (noisy) -> BloomLibrary tl+ceb -> tlwiki -> prep pools
# -> shuf -> SailCraft stages (ceb first = fast path validation, then tl) ->
# verify finals -> Qwen3.5 token yield -> report -> rm intermediates ->
# SELF-TERMINATE (trap EXIT — never leave billing to a session loop).
#
# Env (pod env at creation): RUNPOD_API_KEY (self-terminate), HF_TOKEN (HF).
# RUNPOD_POD_ID is set by RunPod automatically. SELF_TERMINATE=0 to debug.
# ============================================================================
set -uo pipefail
# Pod env does NOT propagate into SSH sessions on this image (found 2026-08-22:
# RUNPOD_POD_ID empty over ssh) — the deploy drops /root/.driver-env instead.
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
    echo "## Run $(date -u +%F) — pod ${RUNPOD_POD_ID:-unknown}"
    echo "- status: $STATUS"
    echo "- pod: ${RUNPOD_POD_ID:-?} (H100 SXM on-demand US-NE-1, self-terminated)"
    echo "- see EXPANSION-REPORT.md for yields"
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

step "1/7 MADLAD-400 data/fil/* @ pinned v1 revision (noisy split is the target)"
HF_TOKEN="${HF_TOKEN:-}" $PULL_PY -u /root/pull_corpus_v2.py

step "2/7 BloomLibrary tl+ceb harvest (Parse API + S3)"
$PULL_PY -u /root/harvest_bloom.py

step "3/7 tlwiki dump + wikiextractor"
WIKI_DIR=$CORPUS/raw/tlwiki
mkdir -p "$WIKI_DIR"
if [ ! -s "$WIKI_DIR/tlwiki-latest-pages-articles.xml.bz2" ]; then
  curl -sL --retry 3 -o "$WIKI_DIR/tlwiki-latest-pages-articles.xml.bz2" \
    https://dumps.wikimedia.org/tlwiki/latest/tlwiki-latest-pages-articles.xml.bz2
fi
QUOTA=$(awk '{print ($1=="max") ? 32 : int($1/$2)}' /sys/fs/cgroup/cpu.max)
NP=$(( QUOTA > 4 ? QUOTA - 2 : QUOTA ))
echo ">> cgroup quota=$QUOTA -> wikiextractor --processes $NP"
if [ ! -d "$WIKI_DIR/extracted" ]; then
  /workspace/venv-pull/bin/wikiextractor --json --processes "$NP" \
    -o "$WIKI_DIR/extracted" "$WIKI_DIR/tlwiki-latest-pages-articles.xml.bz2"
fi
ls "$WIKI_DIR/extracted"/AA | head -3

step "4/7 prep pools (v2 = new material only)"
SAILCRAFT=$SAILCRAFT "$SAILCRAFT/.venv/bin/python" -u /root/prep_pools_v2.py

step "5/7 shuffle pools (shard balance — always before the pipeline)"
for p in pool_ceb_v2 pool_tl_v2; do
  f="$SAILCRAFT/data/data_input/$p.jsonl"
  [ -s "$f" ] && { shuf "$f" -o "$f.shuf" && mv "$f.shuf" "$f"; echo "shuffled $f ($(wc -l < "$f") docs)"; }
done

step "6/7 SailCraft stages — ceb first (fast validation), then tl (long haul)"
for spec in "ceb pool_ceb_v2" "tl pool_tl_v2"; do
  set -- $spec
  [ -s "$SAILCRAFT/data/data_input/$2.jsonl" ] || { echo ">> skip $2 (empty/missing)"; continue; }
  SELF_TERMINATE=0 SAILCRAFT=$SAILCRAFT ALIAS="$2" LANG_ID="$1" \
    bash /root/run_sailcraft_stages.sh
  # free intermediates for this pool as soon as its final output exists
  if [ -s "$SAILCRAFT/data/data_output/final_output/$2/data_clean.jsonl" ]; then
    rm -rf "$SAILCRAFT/data/data_output/near_dedup_output/$2" \
           "$SAILCRAFT/data/data_output/exact_dedup_output/$2" \
           "$SAILCRAFT/cache/near_dedup_cache" "$SAILCRAFT/cache/exact_dedup_cache"
    echo ">> intermediates for $2 removed"; df -h /workspace | tail -1
  fi
done

step "7/7 verify finals + measure Qwen3.5 token yield"
VERIFY=$($PULL_PY - <<'PYEOF'
import json, os
SC = "/workspace/sailcraft-run/data/data_output/final_output"
ok = True
for pool in ("pool_ceb_v2", "pool_tl_v2"):
    p = f"{SC}/{pool}/data_clean.jsonl"
    if not os.path.exists(p):
        print(f"{pool}: MISSING"); ok = False; continue
    n = sum(1 for _ in open(p, "rb"))
    with open(p, encoding="utf-8") as f:
        first = f.readline()
    last = b""
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
for pool in pool_ceb_v2 pool_tl_v2; do
  f="$SAILCRAFT/data/data_output/final_output/$pool/data_clean.jsonl"
  [ -s "$f" ] && FINALS="$FINALS $f"
done
[ -n "$FINALS" ] && HF_TOKEN="${HF_TOKEN:-}" $PULL_PY -u /root/measure_tokens.py \
  $FINALS --out "$CORPUS/TOKEN-YIELD.v2.json" || echo ">> no finals to measure"

step "write EXPANSION-REPORT.md"
{
  echo "# Corpus expansion (v2) report — $(date -u +%F)"
  echo ""
  echo "Pod ${RUNPOD_POD_ID:-?} / volume hiraia-cpt-expansion (6er6skgoyb), self-terminated."
  echo ""
  echo '## Verification'; echo '```'; echo "$VERIFY"; echo '```'
  echo ""; echo '## Token yield (Qwen3.5 tokenizer, 10k-doc sample extrapolated by bytes)'
  echo '```'; cat "$CORPUS/TOKEN-YIELD.v2.json" 2>/dev/null || echo "(no measurement)"; echo '```'
  echo ""; echo '## Pool inputs'
  echo '```'; cat "$SAILCRAFT/data/data_input/POOLS-MANIFEST.v2.json" 2>/dev/null; echo '```'
  echo ""; echo '## BloomLibrary harvest stats'
  echo '```'; cat "$CORPUS/raw/bloomlibrary-tl/HARVEST-STATS.json" "$CORPUS/raw/bloomlibrary-ceb/HARVEST-STATS.json" 2>/dev/null; echo '```'
  echo ""; echo '## Pull manifest'
  echo '```'; cat "$CORPUS/raw/MANIFEST.v2.json" 2>/dev/null; echo '```'
  echo ""
  echo "Skipped by decision: OPUS (sentence-level, low CPT value), FineWeb-2 'removed'"
  echo "config (FW2's own filter rejects), ceb.wikipedia (Lsjbot trap)."
} > "$CORPUS/EXPANSION-REPORT.md"

step "final disk state"; df -h /workspace; du -sh "$CORPUS"/raw/* 2>/dev/null
echo "=== DRIVER DONE: $STATUS ==="
