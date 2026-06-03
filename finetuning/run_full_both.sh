#!/bin/bash
# Driver: train + convert both Tagalog and Bisaya adapters back-to-back on the pod.
set -e
cd /workspace
export LD_LIBRARY_PATH=/workspace/qvac-bin-v8828:$LD_LIBRARY_PATH

run_one () {
  local LANG=$1 DATA=$2 OUT=$3
  echo "############### TRAIN $LANG ###############"
  python train-full.py "$DATA" "$OUT" 3
  echo "############### CONVERT $LANG ###############"
  cd /workspace/qvac-src-v8828
  python convert_lora_to_gguf.py "$OUT/final-adapter" \
    --base-model-id Qwen/Qwen3-1.7B --outtype f16 \
    --outfile "$OUT/adapter-$LANG-f16.gguf"
  cd /workspace
  echo "DONE_$LANG $OUT/adapter-$LANG-f16.gguf"
}

run_one tagalog /workspace/science-chat-tagalog-short.jsonl /workspace/output/tagalog-full
run_one bisaya  /workspace/science-chat-bisaya-short.jsonl  /workspace/output/bisaya-full
echo "ALL_DONE"
