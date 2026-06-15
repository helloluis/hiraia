#!/usr/bin/env bash
# ============================================================================
# run-27b-bench.sh — provision a GPU pod, build llama.cpp (CUDA), serve the Qwen3.5-27B Q4_K_M GGUF
# (SAME stack as the local 9B: Q4 + llama.cpp + enable_thinking=false → a clean same-stack 9B-vs-27B
# comparison), run the hiraiabench probe pool on it, and pull answers.qwen3.5-27b.json back.
# No auto-terminate — verify, then terminate manually (prints the command).
#   cd finetuning/eval/hiraiabench && ./run-27b-bench.sh
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
DISK_GB=80; POD_NAME="hiraia-bench-27b"; KEY="$HOME/.ssh/id_ed25519"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -i $KEY"
RUNPOD_API_KEY="$(grep '^RUNPOD_API_KEY=' "$ROOT/.env.local" | cut -d= -f2-)"
: "${RUNPOD_API_KEY:?}"; API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }

GPUS=("NVIDIA H100 80GB HBM3" "NVIDIA H100 PCIe" "NVIDIA H100 NVL" "NVIDIA A100 80GB PCIe" "NVIDIA L40S")
POD_ID=""
for CLOUD in SECURE COMMUNITY; do for G in "${GPUS[@]}"; do
  echo ">> try $G ($CLOUD) ..."
  D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: $CLOUD, gpuCount: 1, gpuTypeId: \\\"$G\\\", volumeInGb: 0, containerDiskInGb: $DISK_GB, minVcpuCount: 8, minMemoryInGb: 64, supportPublicIp: true, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"$POD_NAME\\\" }) { id } }")
  POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$POD_ID" ] && { GPU="$G ($CLOUD)"; break 2; }
done; done
[ -n "$POD_ID" ] || { echo "ERR: no GPU capacity"; exit 1; }
echo ">> POD_ID=$POD_ID GPU=$GPU"

echo ">> waiting for SSH ..."; IP=""; PORT=""
for i in $(seq 1 40); do
  P=$(gql "query { pod(input:{podId:\\\"$POD_ID\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && { echo ">> ssh root@$IP:$PORT"; break; }; sleep 15
done
[ -n "$PORT" ] || { echo "ERR: no SSH. terminate $POD_ID manually."; exit 1; }
for i in $(seq 1 30); do ssh $SSH -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done

echo ">> building llama.cpp (CUDA) + downloading Qwen3.5-27B Q4_K_M ..."
ssh $SSH -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE'
set -e; cd /workspace 2>/dev/null || cd /root
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq && apt-get install -y -qq cmake git build-essential >/dev/null 2>&1 || true
pip install -q huggingface_hub >/dev/null 2>&1
if [ ! -x llama.cpp/build/bin/llama-server ]; then
  rm -rf llama.cpp; git clone --depth 1 https://github.com/ggml-org/llama.cpp >/dev/null 2>&1
  cmake -S llama.cpp -B llama.cpp/build -DGGML_CUDA=ON -DLLAMA_CURL=OFF >/dev/null 2>&1
  cmake --build llama.cpp/build -j --target llama-server >/dev/null 2>&1
fi
python -c "from huggingface_hub import hf_hub_download as d; print(d('bartowski/Qwen_Qwen3.5-27B-GGUF','Qwen_Qwen3.5-27B-Q4_K_M.gguf',local_dir='/root/m'))" 2>&1 | tail -1
ls -la /root/m/*.gguf
echo BUILD_DONE
REMOTE

echo ">> launching llama-server (27B) ..."
ssh $SSH -p "$PORT" "root@$IP" \
  'cd /root && rm -f srv.log && setsid nohup llama.cpp/build/bin/llama-server -m /root/m/Qwen_Qwen3.5-27B-Q4_K_M.gguf -ngl 99 --host 0.0.0.0 --port 8080 --ctx-size 8192 > srv.log 2>&1 < /dev/null & echo launched'
for i in $(seq 1 60); do ssh $SSH -p "$PORT" "root@$IP" 'curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:8080/health' 2>/dev/null | grep -q 200 && { echo ">> server ready"; break; }; sleep 5; done

echo ">> uploading bench + running ..."
scp $SSH -P "$PORT" "$HERE/bench-set.json" "$HERE/bench_run.py" "root@$IP:/root/"
ssh $SSH -p "$PORT" "root@$IP" 'cd /root && ENDPOINT=http://localhost:8080 MODEL=qwen3.5-27b NO_THINK=1 python bench_run.py'
echo ">> pulling answers ..."
scp $SSH -P "$PORT" "root@$IP:/root/answers.qwen3.5-27b.json" "$HERE/answers.qwen3.5-27b.json"

cat <<EOF

================= 27B BENCH DONE: $POD_ID =================
answers -> $HERE/answers.qwen3.5-27b.json
TERMINATE (stop billing):
  curl -s "$API" -H 'Content-Type: application/json' -d '{"query":"mutation { podTerminate(input: {podId: \\"$POD_ID\\"}) }"}'
POD_ID=$POD_ID
========================================================
EOF
