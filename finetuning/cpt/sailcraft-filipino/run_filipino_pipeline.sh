#!/usr/bin/env bash
# Validated end-to-end SailCraft run for Tagalog (tl) + Cebuano (ceb).
# Proven 2026-06-22 on real MADLAD-400 v1.5 data (3,000-doc heads). ~$0 local, CPU-only.
#
# This is the "day-1 data recipe" as an executable script. It assumes you have:
#   - a fresh SailCraft clone at $SAILCRAFT  (git clone github.com/sail-sg/sailcraft)
#   - the tl/ceb config edits applied (apply patches/ or paste snippets/ — see README)
#   - uv installed (https://astral.sh/uv) for the Python 3.11 envs
#   - rustup/cargo for stage 3 (curl https://sh.rustup.rs | sh -s -- -y)
#
# Two SEPARATE Python 3.11 venvs are required (their deps conflict):
#   .venv        -> data-cleaning (stages 1 & 4) + arrow->jsonl conversion
#   .venv-dedup  -> text-dedup==0.4.0 (stage 2 only)
set -euo pipefail

SAILCRAFT="${SAILCRAFT:-/tmp/sailcraft-run}"
cd "$SAILCRAFT"
CLEAN_PY="$SAILCRAFT/.venv/bin/python"
DEDUP="$SAILCRAFT/.venv-dedup/bin/python"
source "$HOME/.cargo/env"

run_lang () {
  local LANG_ID="$1"     # SailCraft language id: tl | ceb
  local ALIAS="$2"       # dataset alias (input file = data/data_input/$ALIAS.jsonl)
  echo "############### $ALIAS ($LANG_ID) ###############"

  # --- Stage 1: initial clean ---
  bash code/data_cleaning/run_example.sh "$ALIAS" \
      "data/data_input/$ALIAS.jsonl" "$LANG_ID" \
      data/data_output/cleaned_data_output lm_resource cache/data_clean_cache

  # --- Stage 2: near-dedup (MinHash). NOTE: no --local; 0.4.0 --local means load_from_disk ---
  local NEAR="data/data_output/near_dedup_output/$ALIAS"
  rm -rf "$NEAR"; mkdir -p "$NEAR"
  "$DEDUP" -m text_dedup.minhash \
      --path json --data_files "data/data_output/cleaned_data_output/$ALIAS/data_clean.jsonl" \
      --output "$NEAR" --cache_dir cache/near_dedup_cache \
      --column text --split train --batch_size 10000 --num_perm 256
  "$CLEAN_PY" code/data_cleaning/write_arrow_to_jsonl.py --folder_path "$NEAR"

  # --- Stage 3: exact-dedup (Rust suffix-array). Needs cargo + clean-venv python on PATH ---
  PATH="$SAILCRAFT/.venv/bin:$PATH" \
  bash code/exact_dedup/run_example.sh \
      "$NEAR/data_clean.jsonl" "data/data_output/exact_dedup_output/$ALIAS" \
      "$ALIAS" cache/exact_dedup_cache cache/exact_dedup_cache

  # --- Stage 4: second clean ---
  bash code/data_cleaning/run_example.sh "$ALIAS" \
      "data/data_output/exact_dedup_output/$ALIAS/data_clean.jsonl" "$LANG_ID" \
      data/data_output/final_output lm_resource cache/data_clean_cache

  echo "=== $ALIAS doc counts ==="
  for s in cleaned_data_output near_dedup_output exact_dedup_output final_output; do
    printf "  %-22s %s\n" "$s" "$(wc -l < data/data_output/$s/$ALIAS/data_clean.jsonl)"
  done
}

mkdir -p cache/{data_clean_cache,near_dedup_cache,exact_dedup_cache}
mkdir -p data/data_output/{cleaned_data_output,near_dedup_output,exact_dedup_output,final_output}

run_lang tl  "${TL_ALIAS:-madlad_tl}"
run_lang ceb "${CEB_ALIAS:-madlad_ceb}"
