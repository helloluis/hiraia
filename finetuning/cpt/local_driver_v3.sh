#!/usr/bin/env bash
# ============================================================================
# local_driver_v3.sh — v3 tl stages 2-4 ON THE MAC (user decision 2026-08-22,
# after four silent pod deaths in full-pool minhash on RunPod shared hosts).
# Sharded 3x (~6.8M docs/3.1GB each) — 32GB RAM envelope; cross-shard near-dups
# accepted (global dedup happens at tokenization/mix time).
# Input:  finetuning/cpt/local-v3-run/stage1_tl_v3.jsonl (verified 20,321,484 lines)
# Output: finetuning/cpt/local-v3-run/final_tl_v3.jsonl (+ shard outputs under
#         /tmp/sailcraft-local/data/data_output/final_output/shard_*)
# ============================================================================
set -uo pipefail
SC=/tmp/sailcraft-local
HERE=/Users/luis/Code/hiraia/finetuning/cpt
RUN="$HERE/local-v3-run"
export SAILCRAFT="$SC"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$SC/.venv/bin:$PATH"
CLEAN_PY="$SC/.venv/bin/python"; DEDUP="$SC/.venv-dedup/bin/python"
LANG_ID=tl
cd "$SC"

step(){ echo; echo "=== [$(date +%FT%T)] $* ==="; }

NP=$(( $(sysctl -n hw.ncpu) - 2 ))   # 8 on the M-series 10-core
NP2=6                                # minhash: RAM caution on 32GB
echo ">> local run: num_proc=$NP, stage2 num_proc=$NP2"

step "shard stage-1 output into 3"
SHARDS="$SC/data/data_input/v3shards"
mkdir -p "$SHARDS"
if [ ! -s "$SHARDS/shard_0.jsonl" ]; then
  split -n l/3 -a 1 -d "$RUN/stage1_tl_v3.jsonl" "$SHARDS/shard_0" || {
    echo "gnu split -n unsupported? falling back to line-count split"
    total=$(wc -l < "$RUN/stage1_tl_v3.jsonl"); per=$(( (total + 2) / 3 ))
    split -l "$per" -a 1 -d "$RUN/stage1_tl_v3.jsonl" "$SHARDS/shard_"
  }
fi
# normalize names to shard_0/1/2.jsonl whatever split produced
i=0; for f in "$SHARDS"/shard_*; do
  case "$f" in *.jsonl) continue;; esac
  mv "$f" "$SHARDS/shard_$i.jsonl"; i=$((i+1))
done
ls -la "$SHARDS"

run_shard(){
  local SH="$1"
  local IN="$SHARDS/$SH.jsonl"
  step "$SH stage 2 (minhash, num_proc=$NP2)"
  local NEAR="data/data_output/near_dedup_output/$SH"
  rm -rf "$NEAR" cache/near_dedup_cache; mkdir -p "$NEAR"
  "$DEDUP" -m text_dedup.minhash --path json \
    --data_files "$IN" --output "$NEAR" --cache_dir cache/near_dedup_cache \
    --column text --split train --batch_size 10000 --num_perm 256 --num_proc "$NP2"
  "$CLEAN_PY" code/data_cleaning/write_arrow_to_jsonl.py --folder_path "$NEAR"

  step "$SH stage 3 (exact dedup, Rust)"
  rm -rf cache/exact_dedup_cache; mkdir -p cache/exact_dedup_cache  # run_example.sh realpaths it
  bash code/exact_dedup/run_example.sh "$NEAR/data_clean.jsonl" \
    "data/data_output/exact_dedup_output/$SH" "$SH" \
    cache/exact_dedup_cache cache/exact_dedup_cache

  step "$SH stage 4 (second clean, num_proc=$NP)"
  "$CLEAN_PY" code/data_cleaning/main_filtering.py \
    --dataset_name "data/data_output/exact_dedup_output/$SH/data_clean.jsonl" \
    --dataset_alias "$SH" --lang_dataset_id "$LANG_ID" \
    --path_dir_save_dataset data/data_output/final_output \
    --path_sentencepiece_model "lm_resource/$LANG_ID.sp.model" \
    --path_kenlm_model "lm_resource/$LANG_ID.arpa.bin" \
    --path_fasttext_model lm_resource/lid.176.bin \
    --hf_cache_dir cache/data_clean_cache \
    --log_folder_path code/data_cleaning/filtering_logs \
    --num_proc "$NP"
  "$CLEAN_PY" code/data_cleaning/write_arrow_to_jsonl.py \
    --folder_path "data/data_output/final_output/$SH"
  # only declare done + clean intermediates if the final actually landed
  if [ -s "data/data_output/final_output/$SH/data_clean.jsonl" ]; then
    rm -rf "data/data_output/near_dedup_output/$SH" \
           "data/data_output/exact_dedup_output/$SH" \
           cache/near_dedup_cache cache/exact_dedup_cache
    echo ">> $SH done"; df -h /tmp | tail -1
  else
    echo ">> $SH FAILED (no final) — leaving intermediates for diagnosis"
  fi
}

for s in shard_0 shard_1 shard_2; do
  [ -s "$SHARDS/$s.jsonl" ] || { echo ">> $s missing, skipping"; continue; }
  [ -s "data/data_output/final_output/$s/data_clean.jsonl" ] && { echo ">> $s final exists, skip"; continue; }
  run_shard "$s"
done

step "concatenate -> $RUN/final_tl_v3.jsonl"
missing=0
for s in shard_0 shard_1 shard_2; do
  [ -s "data/data_output/final_output/$s/data_clean.jsonl" ] || { echo ">> $s final missing"; missing=1; }
done
if [ "$missing" = 1 ]; then
  echo "=== LOCAL V3 DRIVER ABORT: missing shard finals, not concatenating ==="
  exit 1
fi
cat data/data_output/final_output/shard_*/data_clean.jsonl > "$RUN/final_tl_v3.jsonl"
wc -l "$RUN/final_tl_v3.jsonl"; du -h "$RUN/final_tl_v3.jsonl"

step "local verify (head/tail JSON parse)"
python3 - "$RUN/final_tl_v3.jsonl" <<'PYEOF'
import json, sys
p = sys.argv[1]
with open(p, encoding="utf-8") as f:
    json.loads(f.readline())
with open(p, "rb") as f:
    f.seek(0, 2); size = f.tell(); f.seek(max(0, size - 100000))
    json.loads(f.readlines()[-1])
print("LOCAL VERIFY OK:", p)
PYEOF
echo "=== LOCAL V3 DRIVER DONE ==="
