#!/usr/bin/env bash
# ============================================================================
# run-heal.sh — FIRE-AND-POLL heal launcher. Provisions multi-GPU (combo fallback), scp's
# scripts, launches heal-pipeline.sh (prune -> build-data -> train) DETACHED on the pod, then
# CLEARS its teardown trap and EXITS. The pod runs independently, protected by an on-pod backstop.
# Poll pipeline.log + finalize (scp + terminate) with finalize-heal.sh. No long-held ssh; killing
# this launcher does NOT nuke the pod (that mistake cost us a build before).
#   env: TOTAL (heal tokens, default 800M)
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
set -a; . ../../../.env.local; set +a
: "${RUNPOD_API_KEY:?}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
KEY="$HOME/.ssh/id_ed25519"; SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=20 -i $KEY"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
IMAGE="runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"
TOTAL="${TOTAL:-800000000}"; BACK=43200
# prefer max parallelism first (~halve wall-clock, same FLOP-bound cost). 8x A100-SXM has NVLink
# (best DDP scaling); 8x A100 PCIe / 4x H100 ~= 4 H100-equiv throughput. 2x H100 = last resort.
COMBOS=("NVIDIA A100-SXM4-80GB|8" "NVIDIA A100 80GB PCIe|8" "NVIDIA H100 PCIe|4" "NVIDIA H100 80GB HBM3|4" "NVIDIA A100-SXM4-80GB|4" "NVIDIA H100 PCIe|2")
POD_ID=""; NGPU=""
terminate(){ [ -n "$POD_ID" ] && { echo ">> teardown (launch failed): terminating $POD_ID"; gql "mutation { podTerminate(input: {podId: \\\"$POD_ID\\\"}) }" >/dev/null; }; }
trap terminate EXIT

echo ">> provisioning (TOTAL=$TOTAL) - trying multi-GPU combos ..."
for combo in "${COMBOS[@]}"; do
  G="${combo%|*}"; C="${combo#*|}"; echo ">> try ${C}x ${G} ..."
  for CLOUD in SECURE COMMUNITY; do
    D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: $CLOUD, gpuCount: $C, gpuTypeId: \\\"$G\\\", volumeInGb: 0, containerDiskInGb: 120, minVcpuCount: 8, minMemoryInGb: 80, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"hiraia-heal\\\" }) { id } }")
    POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$POD_ID" ] && { GPU="$G"; NGPU="$C"; echo ">> pod $POD_ID = ${C}x ${G} ($CLOUD)"; break 2; }
  done
done
[ -n "$POD_ID" ] || { echo "ERR: no multi-GPU capacity in any combo"; exit 1; }

echo ">> waiting for SSH ..."; IP=""; PORT=""
for i in $(seq 1 50); do
  P=$(gql "query { pod(input:{podId:\\\"$POD_ID\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && { echo ">> ssh root@$IP:$PORT"; break; }; sleep 15
done
[ -n "$PORT" ] || { echo "ERR: no SSH"; exit 1; }
for i in $(seq 1 40); do ssh $SSH -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done

echo ">> on-pod backstop (${BACK}s) ..."
ssh $SSH -p "$PORT" "root@$IP" "setsid nohup sh -c 'sleep $BACK; curl -s \"$API\" -H \"Content-Type: application/json\" -d \"{\\\"query\\\":\\\"mutation { podTerminate(input: {podId: \\\\\\\"$POD_ID\\\\\\\"}) }\\\"}\"' >/dev/null 2>&1 < /dev/null &" || true

echo ">> installing deps ..."
ssh $SSH -p "$PORT" "root@$IP" 'pip install -q -U transformers accelerate datasets safetensors huggingface_hub 2>&1 | tail -1; python -c "import transformers,torch; print(\"tf\",transformers.__version__,\"ngpu\",torch.cuda.device_count())"'

echo ">> uploading scripts (ceb corpus pulled from HF on-pod, no 497MB scp) ..."
scp $SSH -P "$PORT" prune-ffn.py calib.jsonl eval-holdout.jsonl build-heal-data.py train-heal.py heal-pipeline.sh "root@$IP:/workspace/"

echo ">> launching DETACHED heal-pipeline (prune -> HF-cached tokens -> train) ..."
ssh $SSH -p "$PORT" "root@$IP" "cd /workspace && rm -f pipeline.log && HF_TOKEN=$HUGGINGFACE_API_KEY TOTAL=$TOTAL NGPU=$NGPU setsid nohup bash heal-pipeline.sh > pipeline.log 2>&1 < /dev/null & echo launched-pid \$!"

trap - EXIT   # SUCCESS: pod now runs independently — do NOT terminate on exit
echo "POD_ID=$POD_ID"; echo "IP=$IP"; echo "PORT=$PORT"; echo "NGPU=$NGPU"
echo "$POD_ID $IP $PORT $NGPU heal-fireandpoll $(date)" >> ceb-pods.txt
echo "$POD_ID $IP $PORT $NGPU" > .heal-pod
echo ">> LAUNCHED. Orchestrator exiting; pod runs independently (backstop ${BACK}s)."
echo ">> poll:     ssh -i $KEY -p $PORT root@$IP 'tail -6 /workspace/pipeline.log'"
echo ">> finalize: ./finalize-heal.sh   (when pipeline.log shows PIPELINE_DONE)"
