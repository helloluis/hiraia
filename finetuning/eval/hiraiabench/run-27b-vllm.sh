#!/usr/bin/env bash
# Provision a GPU pod, serve Qwen3.5-27B (bf16) via vLLM, run the hiraiabench probe pool, pull answers.
# Faster than building llama.cpp; bf16 (footnote the quant diff). No auto-terminate.
#   cd finetuning/eval/hiraiabench && ./run-27b-vllm.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
DISK_GB=120; POD_NAME="hiraia-bench-27b-vllm"; KEY="$HOME/.ssh/id_ed25519"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -i $KEY"
RUNPOD_API_KEY="$(grep '^RUNPOD_API_KEY=' "$ROOT/.env.local" | cut -d= -f2-)"; : "${RUNPOD_API_KEY:?}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }

GPUS=("NVIDIA H100 80GB HBM3" "NVIDIA H100 NVL" "NVIDIA H100 PCIe" "NVIDIA A100 80GB PCIe")
POD_ID=""
for CLOUD in SECURE COMMUNITY; do for G in "${GPUS[@]}"; do
  echo ">> try $G ($CLOUD) ..."
  D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: $CLOUD, gpuCount: 1, gpuTypeId: \\\"$G\\\", volumeInGb: 0, containerDiskInGb: $DISK_GB, minVcpuCount: 8, minMemoryInGb: 80, supportPublicIp: true, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"$POD_NAME\\\" }) { id } }")
  POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$POD_ID" ] && { GPU="$G ($CLOUD)"; break 2; }
done; done
[ -n "$POD_ID" ] || { echo "ERR: no GPU"; exit 1; }
echo ">> POD_ID=$POD_ID GPU=$GPU"

IP=""; PORT=""
for i in $(seq 1 40); do
  P=$(gql "query { pod(input:{podId:\\\"$POD_ID\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && { echo ">> ssh root@$IP:$PORT"; break; }; sleep 15
done
[ -n "$PORT" ] || { echo "ERR: no SSH. terminate $POD_ID."; exit 1; }
for i in $(seq 1 30); do ssh $SSH -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done

echo ">> installing vLLM + launching Qwen3.5-27B (downloads ~54GB) ..."
ssh $SSH -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE'
set -e; cd /root
pip install -q -U vllm >/dev/null 2>&1 || pip install -q -U vllm
python -c "import vllm; print('vllm', vllm.__version__)"
rm -f vllm.log
setsid nohup python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen3.5-27B --served-model-name default \
  --max-model-len 8192 --gpu-memory-utilization 0.92 --port 8080 \
  > vllm.log 2>&1 < /dev/null &
echo "vllm launching (pid $!)"
REMOTE

echo ">> waiting for vLLM /health (model download + load, up to ~20 min) ..."
for i in $(seq 1 160); do
  ssh $SSH -p "$PORT" "root@$IP" 'curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:8080/health' 2>/dev/null | grep -q 200 && { echo ">> vLLM ready"; break; }
  sleep 10
done

echo ">> uploading bench + running ..."
scp $SSH -P "$PORT" "$HERE/bench-set.json" "$HERE/bench_run.py" "root@$IP:/root/"
ssh $SSH -p "$PORT" "root@$IP" 'cd /root && ENDPOINT=http://localhost:8080 MODEL=qwen3.5-27b MODEL_API_NAME=default NO_THINK=1 python bench_run.py'
scp $SSH -P "$PORT" "root@$IP:/root/answers.qwen3.5-27b.json" "$HERE/answers.qwen3.5-27b.json"

cat <<EOF

================= 27B vLLM BENCH DONE: $POD_ID =================
answers -> $HERE/answers.qwen3.5-27b.json
TERMINATE: curl -s "$API" -H 'Content-Type: application/json' -d '{"query":"mutation { podTerminate(input: {podId: \\"$POD_ID\\"}) }"}'
POD_ID=$POD_ID
============================================================
EOF
