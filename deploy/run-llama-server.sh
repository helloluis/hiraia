#!/usr/bin/env bash
export LD_LIBRARY_PATH="/root/hiraia/deploy/llama.cpp/build/bin:${LD_LIBRARY_PATH:-}"
exec /root/hiraia/deploy/llama.cpp/build/bin/llama-server \
  -m /root/hiraia/deploy/models/Sailor2-3B-Chat.Q4_K_M.gguf \
  --lora /root/hiraia/finetuning/adapters/adapter-sailor-tagalog-f16.gguf \
  --lora /root/hiraia/finetuning/adapters/adapter-sailor-bisaya-f16.gguf \
  --host 127.0.0.1 --port 8080 -c 2048 -ngl 0 -t 4
