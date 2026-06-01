#!/usr/bin/env bash
# Build QVAC fabric-llm.cpp (fabric-llm-finetune branch) with CUDA ONCE, and
# install the binaries to the PERSISTENT network volume (/workspace/qvac-bin).
# On any future pod this script detects the existing build and skips straight
# to ready — no recompile.
set -euo pipefail

REPO=https://github.com/tetherto/qvac-fabric-llm.cpp
BRANCH=fabric-llm-finetune
SRC=/workspace/qvac-src/qvac-fabric-llm.cpp     # source kept on volume too (for rebuilds)
BUILD="$SRC/build"
BIN=/workspace/qvac-bin                          # <-- persistent install dir on the volume
NEEDED="llama-finetune-lora llama-cli llama-export-lora"

# ---- fast path: already built & installed on the volume? ----
have_all=1
for b in $NEEDED; do [ -x "$BIN/$b" ] || have_all=0; done
if [ "$have_all" = 1 ]; then
  echo "=== QVAC CUDA binaries already on volume ($BIN) — skipping build ==="
  ls -la "$BIN"
  # sanity: do they run against this pod's CUDA libs?
  "$BIN/llama-finetune-lora" --help >/dev/null 2>&1 && echo "RUN_OK" || \
    echo "WARN: binary present but failed --help (CUDA lib mismatch?) — may need rebuild"
  echo "READY"
  exit 0
fi

echo "=== building QVAC CUDA (first time on this volume) ==="
echo "=== [1/5] toolchain ==="
nvcc --version | tail -2 || { echo "NO NVCC — wrong base image"; exit 1; }
command -v cmake >/dev/null || apt-get update -qq && apt-get install -y -qq cmake
nvidia-smi --query-gpu=name --format=csv,noheader

echo "=== [2/5] clone (shallow, single branch) onto volume ==="
mkdir -p "$(dirname "$SRC")"
if [ ! -d "$SRC/.git" ]; then
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$SRC"
fi
cd "$SRC"; echo "HEAD: $(git rev-parse --short HEAD)"

echo "=== [3/5] configure CUDA (H100 = sm_90) ==="
cmake -B "$BUILD" -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=90 \
  -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF 2>&1 | tail -12

echo "=== [4/5] build (parallel) ==="
cmake --build "$BUILD" --config Release -j "$(nproc)" --target $NEEDED 2>&1 | tail -20

echo "=== [5/5] install binaries + their bundled .so to persistent $BIN ==="
mkdir -p "$BIN"
# copy the executables and any ggml/cuda shared libs the build produced
find "$BUILD/bin" -maxdepth 1 -type f \( -name "llama-*" -o -name "*.so" \) -exec cp -v {} "$BIN/" \;
find "$BUILD" -name "*.so" -exec cp -n {} "$BIN/" \; 2>/dev/null || true
ls -la "$BIN"
"$BIN/llama-finetune-lora" --help >/dev/null 2>&1 && echo "RUN_OK" || echo "WARN: --help failed"
echo "READY (built + installed to volume; future pods skip this)"
