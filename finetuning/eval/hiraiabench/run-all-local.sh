#!/usr/bin/env bash
set -uo pipefail
HB="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HB/../../.." && pwd)"
M="$ROOT/deploy/models"
pkill -f 'llama-server' 2>/dev/null; sleep 1
run(){ MODEL="$1" BASE="$2" ADAPTER="${3:-}" PORT=8077 bash "$HB/local-bench.sh"; }
run hiraia-v7   "$M/Sailor2-3B-Chat.Q4_K_M.gguf" "$ROOT/finetuning/adapters/distill-sailor-3b-v7/adapter-tagalog-v7-f16.gguf"
run sailor2-3b  "$M/Sailor2-3B-Chat.Q4_K_M.gguf"
run qwen3-1.7b  "$M/Qwen3-1.7B-Q4_K_M.gguf"
run qwen3.5-9b  "$M/Qwen_Qwen3.5-9B-Q4_K_M.gguf"
echo "ALL LOCAL BENCHES DONE"
