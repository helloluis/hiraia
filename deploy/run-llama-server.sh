#!/usr/bin/env bash
export LD_LIBRARY_PATH="/root/hiraia/deploy/llama.cpp/build/bin:${LD_LIBRARY_PATH:-}"
exec /root/hiraia/deploy/llama.cpp/build/bin/llama-server \
  -m /root/hiraia/deploy/models/Sailor2-3B-Chat.Q4_K_M.gguf \
  --lora /root/hiraia/packages/mobile/assets/models/adapter-tagalog.gguf \
  --lora /root/hiraia/packages/mobile/assets/models/adapter-bisaya.gguf \
  --host 127.0.0.1 --port 8080 -c 4096 -ngl 0 -t 4 \
  -np 1 --cache-reuse 256
# Adapters: these are the SAME GGUFs bundled in the shipped APK (the single source of
#   truth — packages/mobile/assets/models/, git-lfs). id 0 = adapter-tagalog (the v2a
#   intent-distillation adapter, which also serves English); id 1 = adapter-bisaya.
#   Pointing here (instead of finetuning/adapters/adapter-sailor-*-f16.gguf) guarantees
#   the web demo serves exactly what the phone ships; `git lfs pull` on deploy keeps them
#   in sync. The grounded web path (api/demo/chat) sends v2a's trained prompt shape
#   (static system prompt + grounding folded into the user turn), so it stays in-distribution.
# -np 1: single slot so each conversation's turns reuse the same KV cache. With the
#   default 4 slots, follow-up turns bounced to a fresh slot, the cross-slot prompt-
#   cache restore missed (sim=0.000), and the whole ~1800-token thread was re-evaluated
#   (~90s before the first token). One slot also gives the conversation the full -c
#   context instead of 2048/4. Trade-off: concurrent users serialize — fine for this
#   CPU demo box, which can't run parallel 3B inference anyway.
# --cache-reuse 256: KV-shift to reuse a common prefix even when it shifts (e.g. when
#   the client's sliding history window drops the oldest turns).
