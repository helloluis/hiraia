#!/usr/bin/env bash
# ============================================================================
# run_sailcraft_stages.sh — TEMPLATE: SailCraft stages 2-4 for one pool, with
# every 2026-08-21 lesson baked in. Adapt ALIAS/LANG_ID/paths per run.
# (Stage 1 for very large pools: use the filter_chunk.py parallel bypass if
# datasets.map misbehaves; at quota-sized num_proc it normally doesn't.)
#
# LESSONS ENCODED (see memory hiraia-runpod-cgroup-quota):
#   - num_proc = cgroup quota − 2 (read cpu.max; NEVER trust nproc — host cores leak through)
#   - clean venv on PATH (SailCraft stage scripts call bare `python`)
#   - shuffle the input pool BEFORE stage 1 (shard balance)
#   - volume paths for data (local overlay disk is small); rm intermediates when done
#   - SELF-TERMINATE the pod at the end (never rely on a session loop overnight)
# ============================================================================
set -euo pipefail
SAILCRAFT="${SAILCRAFT:-/workspace/sailcraft-run}"
ALIAS="${ALIAS:?set ALIAS (e.g. pool_tl_v2)}"
LANG_ID="${LANG_ID:?set LANG_ID (tl|ceb)}"
cd "$SAILCRAFT"
[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"  # tolerate fresh pods (v3 lesson)
export PATH="$SAILCRAFT/.venv/bin:$PATH"
CLEAN_PY="$SAILCRAFT/.venv/bin/python"; DEDUP="$SAILCRAFT/.venv-dedup/bin/python"

QUOTA=$(awk '{print ($1=="max") ? 32 : int($1/$2)}' /sys/fs/cgroup/cpu.max)
NP=$(( QUOTA > 4 ? QUOTA - 2 : QUOTA ))
echo ">> cgroup quota=$QUOTA -> num_proc=$NP (nproc says $(nproc) — ignored)"

echo "############### $ALIAS stage 1 (initial clean, num_proc=$NP) ###############"
"$CLEAN_PY" code/data_cleaning/main_filtering.py \
  --dataset_name "data/data_input/$ALIAS.jsonl" \
  --dataset_alias "$ALIAS" --lang_dataset_id "$LANG_ID" \
  --path_dir_save_dataset data/data_output/cleaned_data_output \
  --path_sentencepiece_model "lm_resource/$LANG_ID.sp.model" \
  --path_kenlm_model "lm_resource/$LANG_ID.arpa.bin" \
  --path_fasttext_model lm_resource/lid.176.bin \
  --hf_cache_dir cache/data_clean_cache \
  --log_folder_path code/data_cleaning/filtering_logs \
  --num_proc "$NP"
"$CLEAN_PY" code/data_cleaning/write_arrow_to_jsonl.py --folder_path "data/data_output/cleaned_data_output/$ALIAS"

echo "############### $ALIAS stage 2 (minhash, num_proc=$NP) ###############"
NEAR="data/data_output/near_dedup_output/$ALIAS"
rm -rf "$NEAR"; mkdir -p "$NEAR"
"$DEDUP" -m text_dedup.minhash --path json \
  --data_files "data/data_output/cleaned_data_output/$ALIAS/data_clean.jsonl" \
  --output "$NEAR" --cache_dir cache/near_dedup_cache \
  --column text --split train --batch_size 10000 --num_perm 256 --num_proc "$NP"
"$CLEAN_PY" code/data_cleaning/write_arrow_to_jsonl.py --folder_path "$NEAR"

echo "############### $ALIAS stage 3 (exact dedup, Rust) ###############"
bash code/exact_dedup/run_example.sh "$NEAR/data_clean.jsonl" \
  "data/data_output/exact_dedup_output/$ALIAS" "$ALIAS" \
  cache/exact_dedup_cache cache/exact_dedup_cache

echo "############### $ALIAS stage 4 (second clean, num_proc=$NP) ###############"
"$CLEAN_PY" code/data_cleaning/main_filtering.py \
  --dataset_name "data/data_output/exact_dedup_output/$ALIAS/data_clean.jsonl" \
  --dataset_alias "$ALIAS" --lang_dataset_id "$LANG_ID" \
  --path_dir_save_dataset data/data_output/final_output \
  --path_sentencepiece_model "lm_resource/$LANG_ID.sp.model" \
  --path_kenlm_model "lm_resource/$LANG_ID.arpa.bin" \
  --path_fasttext_model lm_resource/lid.176.bin \
  --hf_cache_dir cache/data_clean_cache \
  --log_folder_path code/data_cleaning/filtering_logs \
  --num_proc "$NP"
"$CLEAN_PY" code/data_cleaning/write_arrow_to_jsonl.py --folder_path "data/data_output/final_output/$ALIAS"

echo "=== $ALIAS doc counts ==="
for s in cleaned_data_output near_dedup_output exact_dedup_output final_output; do
  printf "  %-22s %s\n" "$s" "$(wc -l < data/data_output/$s/$ALIAS/data_clean.jsonl)"
done

# --- SELF-TERMINATE (set SELF_TERMINATE=0 to keep the pod for debugging) ---
if [ "${SELF_TERMINATE:-1}" = 1 ] && [ -n "${RUNPOD_API_KEY:-}" ] && [ -n "${RUNPOD_POD_ID:-}" ]; then
  echo ">> work done — terminating own pod $RUNPOD_POD_ID"
  curl -s --max-time 30 -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" \
    "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID" -w "terminate: HTTP %{http_code}\n"
fi
