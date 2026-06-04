#!/usr/bin/env bash
export LD_LIBRARY_PATH="/root/hiraia/deploy/llama.cpp/build/bin:${LD_LIBRARY_PATH:-}"
exec /root/hiraia/deploy/llama.cpp/build/bin/llama-server \
  -m /root/hiraia/deploy/models/Sailor2-3B-Chat.Q4_K_M.gguf \
  --lora /root/hiraia/finetuning/adapters/adapter-sailor-tagalog-f16.gguf \
  --lora /root/hiraia/finetuning/adapters/adapter-sailor-bisaya-f16.gguf \
  --host 127.0.0.1 --port 8080 -c 2048 -ngl 0 -t 4 \
  -np 1 --cache-reuse 256
# -np 1: single slot so each conversation's turns reuse the same KV cache. With the
#   default 4 slots, follow-up turns bounced to a fresh slot, the cross-slot prompt-
#   cache restore missed (sim=0.000), and the whole ~1800-token thread was re-evaluated
#   (~90s before the first token). One slot also gives the conversation the full -c
#   context instead of 2048/4. Trade-off: concurrent users serialize — fine for this
#   CPU demo box, which can't run parallel 3B inference anyway.
# --cache-reuse 256: KV-shift to reuse a common prefix even when it shifts (e.g. when
#   the client's sliding history window drops the oldest turns).
