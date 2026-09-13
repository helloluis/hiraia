#!/usr/bin/env bash
# ============================================================================
# run-smoke.sh — 1-pod smoke test for Cebuano heal generation.
# Provisions ONE A100-80GB, installs vLLM, downloads Sailor2-20B-Chat, generates a
# small batch (prompts-smoke.jsonl), prints AUP-safe metrics (numbers only), then
# TERMINATES the pod. Layered teardown: trap-EXIT terminate + on-pod wall-clock backstop.
# Goal: validate the pipeline + measure real tok/s (→ cost) + ceb-quality ratio BEFORE
# fanning out to 8. Never reads generated Cebuano text into a human/Claude context.
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
MODEL="${MODEL:-sail/Sailor2-20B-Chat}"
POD_ID=""
terminate(){ [ -n "$POD_ID" ] && { echo ">> TERMINATING $POD_ID"; gql "mutation { podTerminate(input: {podId: \\\"$POD_ID\\\"}) }" >/dev/null; echo "terminated"; }; }
trap terminate EXIT

echo ">> provisioning 1× $GPU ..."
for CLOUD in SECURE COMMUNITY; do
  D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: $CLOUD, gpuCount: 1, gpuTypeId: \\\"$GPU\\\", volumeInGb: 0, containerDiskInGb: 100, minVcpuCount: 8, minMemoryInGb: 64, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"hiraia-ceb-smoke\\\" }) { id } }")
  POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$POD_ID" ] && { echo ">> got pod $POD_ID ($CLOUD)"; break; }
  echo ">> no capacity on $CLOUD"
done
[ -n "$POD_ID" ] || { echo "ERR: no A100-80GB capacity"; exit 1; }
echo "$POD_ID smoke $(date)" >> ceb-pods.txt

echo ">> waiting for SSH ..."; IP=""; PORT=""
for i in $(seq 1 50); do
  P=$(gql "query { pod(input:{podId:\\\"$POD_ID\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && { echo ">> ssh root@$IP:$PORT"; break; }; sleep 15
done
[ -n "$PORT" ] || { echo "ERR: no SSH port"; exit 1; }
for i in $(seq 1 40); do ssh $SSH -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done

echo ">> arming on-pod wall-clock backstop (self-terminate in 2h) ..."
ssh $SSH -p "$PORT" "root@$IP" "setsid nohup sh -c 'sleep 7200; curl -s \"$API\" -H \"Content-Type: application/json\" -d \"{\\\"query\\\":\\\"mutation { podTerminate(input: {podId: \\\\\\\"$POD_ID\\\\\\\"}) }\\\"}\"' >/dev/null 2>&1 < /dev/null &" || true

echo ">> installing vLLM (slow step) + a separate numpy<2 LID venv ..."
ssh $SSH -p "$PORT" "root@$IP" 'pip install -q -U vllm 2>&1 | tail -3; python -c "import vllm; print(\"vllm\", vllm.__version__)"; python -m venv /workspace/lidvenv && /workspace/lidvenv/bin/pip install -q "numpy<2" fasttext-wheel huggingface_hub 2>&1 | tail -2 && /workspace/lidvenv/bin/python -c "import fasttext,numpy; print(\"lidvenv numpy\", numpy.__version__)"'

echo ">> uploading scripts + smoke prompts ..."
scp $SSH -P "$PORT" generate-ceb.py metrics-ceb.py ceb-lid.py prompts-smoke.jsonl "root@$IP:/workspace/"

echo ">> GENERATING smoke batch (300 prompts) — measuring tok/s ..."
ssh $SSH -p "$PORT" "root@$IP" "cd /workspace && SHARD=0 PROMPTS=/workspace/prompts-smoke.jsonl MODEL='$MODEL' TEMP=0.8 MAXTOK=512 python generate-ceb.py 2>&1 | grep -E 'shard|tok/s|DONE|Error|error' | tail -8"

echo ">> ===== SMOKE METRICS — GlotLID + filter test (AUP-safe, numbers only) ====="
ssh $SSH -p "$PORT" "root@$IP" 'cd /workspace && echo "LID metrics:" && /workspace/lidvenv/bin/python ceb-lid.py metrics out/ceb-shard-0.jsonl && echo "filter test:" && /workspace/lidvenv/bin/python ceb-lid.py filter out/ceb-shard-0.jsonl out/ceb-shard-0.clean.jsonl'
echo ">> =================================================="
echo ">> smoke complete — pod will terminate on exit."
