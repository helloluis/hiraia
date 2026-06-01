#!/usr/bin/env bash
# Train both adapters with QVAC CUDA binaries (from the volume) and run the
# 50-prompt eval through llama-cli. Produces GGUF adapters + eval JSON.
# Assumes qvac_cuda_setup.sh already populated /workspace/qvac-bin.
set -euo pipefail

BIN=/workspace/qvac-bin
WS=/workspace
BASE_QUANT="${BASE_QUANT:-q4_0}"          # set by caller after the probe decision
BASE="$WS/models/qwen3-1.7b-${BASE_QUANT}.gguf"
PROMPTS="$WS/student-prompts.json"

mkdir -p "$WS/models" "$WS/qvac-out"

echo "=== fetch base GGUF ($BASE_QUANT) if missing ==="
if [ ! -f "$BASE" ]; then
  URL="https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-${BASE_QUANT^^}.gguf"
  # try common filename casings
  wget -q -O "$BASE" "$URL" || \
  wget -q -O "$BASE" "https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/main/qwen3-1_7b-${BASE_QUANT}.gguf" || \
  { echo "BASE DOWNLOAD FAILED for $BASE_QUANT"; exit 1; }
fi
ls -la "$BASE"

train() {  # $1=lang  $2=dataset  $3=outname
  echo "=== TRAIN $1 ($BASE_QUANT) ==="
  "$BIN/llama-finetune-lora" \
    -m "$BASE" -f "$WS/$2" \
    --assistant-loss-only -c 1024 -b 128 -ub 128 -ngl 999 -fa off \
    --lora-rank 16 --lora-alpha 32 \
    --lora-modules "attn_q,attn_k,attn_v,attn_o,ffn_gate,ffn_up,ffn_down" \
    --learning-rate 1e-4 --lr-min 1e-8 --lr-scheduler cosine --warmup-ratio 0.1 \
    --num-epochs 3 \
    --checkpoint-save-steps 100 --checkpoint-save-dir "$WS/qvac-out/$3-ckpt" \
    --output-adapter "$WS/qvac-out/$3.gguf" 2>&1 | tail -40
  ls -la "$WS/qvac-out/$3.gguf"
}

train cebuano science-chat-bisaya.jsonl    bisaya-qvac-${BASE_QUANT}
train tagalog science-chat-tagalog-v2.jsonl tagalog-qvac-${BASE_QUANT}

echo "=== ALL TRAINING DONE ==="
ls -la "$WS/qvac-out/"*.gguf
