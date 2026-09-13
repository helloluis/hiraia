#!/usr/bin/env bash
# ============================================================================
# run-prune.sh — FFN-width prune Sailor2-3B → ~2.4B on one A100-80GB.
# Provisions (CUDA-13.0), installs transformers, runs prune-ffn.py (downloads the 3B,
# scores FFN importance on the ceb/tl/en calib set, prunes intermediate 9352→4608,
# reports ppl before/after + param count), scp's the pruned model back, terminates.
# Layered teardown: trap-EXIT + on-pod 1h backstop.
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
set -a; . ../../../.env.local; set +a
: "${RUNPOD_API_KEY:?}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
KEY="$HOME/.ssh/id_ed25519"; SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -i $KEY"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
GPU="${GPU:-NVIDIA A100 80GB PCIe}"
IMAGE="runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"
NEWI="${NEWI:-4608}"
POD_ID=""
terminate(){ [ -n "$POD_ID" ] && { echo ">> TERMINATING $POD_ID"; gql "mutation { podTerminate(input: {podId: \\\"$POD_ID\\\"}) }" >/dev/null; }; }
trap terminate EXIT

echo ">> provisioning 1× $GPU (CUDA 13.0) ..."
for CLOUD in SECURE COMMUNITY; do
  D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: $CLOUD, gpuCount: 1, gpuTypeId: \\\"$GPU\\\", allowedCudaVersions: [\\\"13.0\\\"], volumeInGb: 0, containerDiskInGb: 100, minVcpuCount: 8, minMemoryInGb: 64, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"hiraia-prune\\\" }) { id } }")
  POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$POD_ID" ] && { echo ">> pod $POD_ID ($CLOUD)"; break; }
done
[ -n "$POD_ID" ] || { echo "ERR: no capacity"; exit 1; }
echo "$POD_ID prune $(date)" >> ceb-pods.txt

echo ">> waiting for SSH ..."; IP=""; PORT=""
for i in $(seq 1 50); do
  P=$(gql "query { pod(input:{podId:\\\"$POD_ID\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && { echo ">> ssh root@$IP:$PORT"; break; }; sleep 15
done
[ -n "$PORT" ] || { echo "ERR: no SSH"; exit 1; }
for i in $(seq 1 40); do ssh $SSH -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done

echo ">> on-pod 1h backstop ..."
ssh $SSH -p "$PORT" "root@$IP" "setsid nohup sh -c 'sleep 3600; curl -s \"$API\" -H \"Content-Type: application/json\" -d \"{\\\"query\\\":\\\"mutation { podTerminate(input: {podId: \\\\\\\"$POD_ID\\\\\\\"}) }\\\"}\"' >/dev/null 2>&1 < /dev/null &" || true

echo ">> installing transformers ..."
ssh $SSH -p "$PORT" "root@$IP" 'pip install -q -U transformers accelerate safetensors huggingface_hub 2>&1 | tail -2; python -c "import transformers,torch; print(\"tf\",transformers.__version__,\"torch\",torch.__version__,\"cuda\",torch.cuda.is_available())"'

echo ">> uploading prune script + calib ..."
scp $SSH -P "$PORT" prune-ffn.py calib.jsonl "root@$IP:/workspace/"

echo ">> RUNNING PRUNE (9352 -> $NEWI) ..."
ssh $SSH -p "$PORT" "root@$IP" "cd /workspace && python prune-ffn.py --model sail/Sailor2-3B --calib calib.jsonl --new-intermediate $NEWI --out sailor2-2b4 2>&1 | grep -vE 'Loading checkpoint|it/s\]|Fetching' | tail -30"

echo ">> scp pruned model back (~5GB) ..."
mkdir -p pruned
scp $SSH -P "$PORT" -r "root@$IP:/workspace/sailor2-2b4" "pruned/" >/dev/null 2>&1 && echo ">> pruned model saved -> pruned/sailor2-2b4" || echo ">> WARN scp pruned model failed"
ls -la pruned/sailor2-2b4/ 2>/dev/null | head
echo ">> done (pod terminates on exit)."
