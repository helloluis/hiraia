#!/usr/bin/env bash
# Hiraia model server for the VPS demo.
# Serves Sailor2-3B-Chat (Q4_K_M) + the Tagalog & Bisaya LoRA adapters over an
# OpenAI-compatible HTTP API (llama.cpp `llama-server`), which the web app calls.
#
# Validated path: mainline llama.cpp + mradermacher Q4_K_M base + our adapters,
# with per-request adapter selection (lora id 0 = Tagalog, id 1 = Bisaya).
#
# Usage:
#   ./deploy/serve-model.sh            # build llama.cpp if needed, download base, serve
#   PORT=8080 NGL=0 ./deploy/serve-model.sh
# Env:
#   PORT   listen port (default 8080)
#   NGL    GPU layers to offload (default 0 = CPU; set 99 if the VPS has a GPU)
#   MODELS dir for the base gguf (default ./deploy/models)
set -euo pipefail

PORT="${PORT:-8080}"
NGL="${NGL:-0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS="${MODELS:-$REPO_ROOT/deploy/models}"
ADAPTERS="$REPO_ROOT/finetuning/adapters"
BASE_URL="https://huggingface.co/mradermacher/Sailor2-3B-Chat-GGUF/resolve/main/Sailor2-3B-Chat.Q4_K_M.gguf"
BASE="$MODELS/Sailor2-3B-Chat.Q4_K_M.gguf"

mkdir -p "$MODELS"

# 1. Ensure llama-server is available (build from source if not on PATH).
if command -v llama-server >/dev/null 2>&1; then
  SERVER="llama-server"
else
  echo ">> llama-server not found; building llama.cpp from source..."
  if ! command -v cmake >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y build-essential cmake git curl
  fi
  if [ ! -d "$REPO_ROOT/deploy/llama.cpp" ]; then
    git clone --depth 1 https://github.com/ggml-org/llama.cpp "$REPO_ROOT/deploy/llama.cpp"
  fi
  cmake -S "$REPO_ROOT/deploy/llama.cpp" -B "$REPO_ROOT/deploy/llama.cpp/build"
  cmake --build "$REPO_ROOT/deploy/llama.cpp/build" -j --target llama-server
  SERVER="$REPO_ROOT/deploy/llama.cpp/build/bin/llama-server"
fi

# 2. Download the quantized base model if missing (~3 GB).
if [ ! -f "$BASE" ]; then
  echo ">> downloading base model (Q4_K_M, ~3 GB)..."
  curl -L --fail -o "$BASE" "$BASE_URL"
fi

# 3. Verify adapters exist (they ship in the repo via git-lfs; run `git lfs pull`).
TL="$ADAPTERS/adapter-sailor-tagalog-f16.gguf"
CEB="$ADAPTERS/adapter-sailor-bisaya-f16.gguf"
for f in "$TL" "$CEB"; do
  if [ ! -f "$f" ] || [ "$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f")" -lt 1000000 ]; then
    echo "!! Missing/empty adapter: $f"
    echo "   Run: git lfs install && git lfs pull"
    exit 1
  fi
done

echo ">> starting llama-server on 0.0.0.0:$PORT (ngl=$NGL)"
echo "   lora id 0 = Tagalog, id 1 = Bisaya"
exec "$SERVER" \
  -m "$BASE" \
  --lora "$TL" \
  --lora "$CEB" \
  --host 0.0.0.0 --port "$PORT" \
  -c 2048 -ngl "$NGL"
