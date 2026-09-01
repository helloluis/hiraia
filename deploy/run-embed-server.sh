#!/usr/bin/env bash
#
# LaBSE embedding server for the VPS web demo's server-side RAG.
#
# The grounded web path (packages/web/src/app/api/demo/card + server/rag.ts) needs to
# embed each visitor query in the SAME space as the bundled corpus vectors so the
# hybrid retriever + abstain floor behave exactly like the phone. That means the SAME
# model + pooling the on-device embedder uses:
#   - model:   labse.Q4_K_M.gguf   (NOT fp16 — the corpus blob's 0.99999 query/corpus
#              parity was verified against the Q4_K_M GGUF; see mobile config EMBEDDER)
#   - pooling: CLS   (--pooling cls)   ; the route L2-normalizes the result (embdNormalize:2)
#
# Runs as a SECOND llama-server on 127.0.0.1:8090 (not publicly exposed); the Next.js
# route reaches it via HIRAIA_EMBED_URL (default http://localhost:8090). Tiny footprint
# (~0.4 GB) next to the 3.3 GB generation server — fits the box's headroom.
#
# pm2:  pm2 start /root/hiraia/deploy/run-embed-server.sh --name hiraia-embed && pm2 save
set -euo pipefail

REPO=/root/hiraia
MODEL="$REPO/deploy/models/labse.Q4_K_M.gguf"
BIN="$REPO/deploy/llama.cpp/build/bin/llama-server"
PORT="${EMBED_PORT:-8090}"

# Fetch the embedder from our own model mirror if it isn't on disk yet (deploy/models
# is gitignored, so it persists across update.sh's hard reset — download once).
if [ ! -f "$MODEL" ] || [ "$(stat -c%s "$MODEL" 2>/dev/null || echo 0)" -lt 1000000 ]; then
  echo ">> labse.Q4_K_M.gguf missing — downloading from the model mirror..."
  curl -L --fail -o "$MODEL" https://hiraia.b11.dev/models/labse.Q4_K_M.gguf
fi

export LD_LIBRARY_PATH="$REPO/deploy/llama.cpp/build/bin:${LD_LIBRARY_PATH:-}"
# --embedding: serve /v1/embeddings ; --pooling cls: LaBSE's sentence vector lives in the
# CLS token. -ub 512 >= the max query length so the non-causal encoder batches the whole
# prompt in one ubatch (embedding models need n_ubatch >= n_tokens). -np 1, CPU, 2 threads.
exec "$BIN" \
  -m "$MODEL" \
  --embedding --pooling cls \
  --host 127.0.0.1 --port "$PORT" \
  -c 512 -ub 512 -ngl 0 -t 2 -np 1
