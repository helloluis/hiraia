#!/usr/bin/env bash
export LD_LIBRARY_PATH="/root/hiraia/deploy/llama.cpp/build/bin:${LD_LIBRARY_PATH:-}"
exec /root/hiraia/deploy/llama.cpp/build/bin/llama-server \
  -m /root/hiraia/deploy/models/hiraia-sft-2b-Q4_K_M.gguf \
  --host 127.0.0.1 --port 8080 -c 4096 -ngl 0 -t 4 \
  -np 1 --cache-reuse 256
# Model: the CPT'd + SFT'd Qwen3.5-2B (Cryptopop/hiraia-sft-flagship-2b, gguf/), which
#   replaces Sailor2-3B. NO --lora: this is a full-parameter SFT, so the Tagalog/Bisaya
#   adapters do not apply to it — they belong to the Sailor2 line and loading them here
#   would be meaningless at best. It is also 1.27 GB against 3.23 GB and a 2B rather than a
#   3B, which matters on this box: -ngl 0, everything on CPU.
#
# ⚠️ Qwen3.5 is a THINKING model. A caller that does not send
#   `chat_template_kwargs: {enable_thinking: false}` gets an EMPTY `content` with the answer
#   stranded in `reasoning_content` — every generation silently reads as a failure. Both web
#   routes (api/demo/card, api/demo/chat) send it; anything new that talks to :8080 must too.
#   Measured locally: without it, content='' and finish_reason='stop'.
#
# Sailor2-3B-Chat.Q4_K_M.gguf stays on disk and is still served over /models/ for the APK —
#   phones in the field verify it against a declared md5, so that file must not move or change.
# -np 1: single slot so each conversation's turns reuse the same KV cache. With the
#   default 4 slots, follow-up turns bounced to a fresh slot, the cross-slot prompt-
#   cache restore missed (sim=0.000), and the whole ~1800-token thread was re-evaluated
#   (~90s before the first token). One slot also gives the conversation the full -c
#   context instead of 2048/4. Trade-off: concurrent users serialize — fine for this
#   CPU demo box, which can't run parallel 3B inference anyway.
# --cache-reuse 256: KV-shift to reuse a common prefix even when it shifts (e.g. when
#   the client's sliding history window drops the oldest turns).
