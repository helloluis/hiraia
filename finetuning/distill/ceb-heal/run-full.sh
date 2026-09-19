#!/usr/bin/env bash
# ============================================================================
# run-full.sh — full 8× Cebuano heal generation. Provisions N A100-80GB pods (one per
# shard), each: vLLM Sailor2-20B generate (detached+polled, survives ssh drops) → GlotLID
# filter (numpy<2 venv) → scp CLEAN ceb back to out/clean/ → terminate. Global trap +
# per-pod 5h backstop guarantee no idle billing. AUP: clean ceb only touches disk/HF, never echoed.
# Budget: 8× A100-80GB @ $1.19/hr ≈ $9.5/hr; ~3h ⇒ ~$25-30. HARD-watch the $160 cap.
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
NPODS="${NPODS:-8}"; BACKSTOP="${BACKSTOP:-18000}"; MAXPOLL="${MAXPOLL:-220}"  # poll up to ~3.7h
mkdir -p out/clean logs
PODS_FILE="ceb-pods-full.txt"; : > "$PODS_FILE"

terminate_all(){ echo ">> teardown: terminating all recorded pods"; while read -r pid _; do [ -n "$pid" ] && gql "mutation { podTerminate(input:{podId: \\\"$pid\\\"}) }" >/dev/null 2>&1; done < "$PODS_FILE"; }
trap terminate_all EXIT

provision(){ # $1 shard -> echo POD_ID or empty
  local s=$1 D pid
  for CLOUD in SECURE COMMUNITY; do
    D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: $CLOUD, gpuCount: 1, gpuTypeId: \\\"$GPU\\\", allowedCudaVersions: [\\\"13.0\\\"], volumeInGb: 0, containerDiskInGb: 100, minVcpuCount: 8, minMemoryInGb: 64, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"hiraia-ceb-$s\\\" }) { id } }")
    pid=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
    [ -n "$pid" ] && { echo "$pid"; return 0; }
  done; echo ""
}

ssh_addr(){ # $1 pod -> "ip port" (waits)
  local pid=$1 P PORT IP
  for i in $(seq 1 50); do
    P=$(gql "query { pod(input:{podId:\\\"$pid\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
    PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
    IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
    [ -n "$PORT" ] && { echo "$IP $PORT"; return 0; }; sleep 15
  done; echo ""
}

run_shard(){ # $1 shard  $2 pod
  local s=$1 pid=$2 addr ip port
  addr=$(ssh_addr "$pid"); ip=$(echo "$addr" | awk '{print $1}'); port=$(echo "$addr" | awk '{print $2}')
  [ -n "$port" ] || { echo "[$s] no SSH — terminating $pid"; gql "mutation { podTerminate(input:{podId: \\\"$pid\\\"}) }" >/dev/null; return 1; }
  for i in $(seq 1 40); do ssh $SSH -p "$port" "root@$ip" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done
  echo "[$s] arming 5h backstop on $pid"
  ssh $SSH -p "$port" "root@$ip" "setsid nohup sh -c 'sleep $BACKSTOP; curl -s \"$API\" -H \"Content-Type: application/json\" -d \"{\\\"query\\\":\\\"mutation { podTerminate(input: {podId: \\\\\\\"$pid\\\\\\\"}) }\\\"}\"' >/dev/null 2>&1 < /dev/null &" || true
  echo "[$s] installing vllm + lidvenv on $pid"
  ssh $SSH -p "$port" "root@$ip" 'pip install -q -U vllm >/dev/null 2>&1; python -c "import vllm" && python -m venv /workspace/lidvenv && /workspace/lidvenv/bin/pip install -q "numpy<2" fasttext-wheel huggingface_hub >/dev/null 2>&1 && echo setup-ok' | grep -q setup-ok || { echo "[$s] setup FAILED on $pid"; gql "mutation { podTerminate(input:{podId: \\\"$pid\\\"}) }" >/dev/null; return 1; }
  echo "[$s] uploading + launching detached generation on $pid"
  scp $SSH -P "$port" generate-ceb.py ceb-lid.py "prompts-shard-$s.jsonl" "root@$ip:/workspace/" >/dev/null
  ssh $SSH -p "$port" "root@$ip" "cd /workspace && rm -f gen-$s.log && SHARD=$s PROMPTS=/workspace/prompts-shard-$s.jsonl MODEL='$MODEL' TEMP=0.8 MAXTOK=512 setsid nohup python generate-ceb.py > gen-$s.log 2>&1 < /dev/null & echo launched"
  echo "[$s] polling for completion (up to $MAXPOLL min) ..."
  CRASHED=0
  for i in $(seq 1 "$MAXPOLL"); do
    st=$(ssh $SSH -p "$port" "root@$ip" "if grep -q DONE /workspace/gen-$s.log 2>/dev/null; then echo DONE; elif pgrep -f generate-ceb >/dev/null; then echo RUN; else echo DEAD; fi" 2>/dev/null)
    [ "$st" = DONE ] && { echo "[$s] generation DONE"; break; }
    [ "$st" = DEAD ] && { echo "[$s] generation process DIED — aborting shard. tail:"; ssh $SSH -p "$port" "root@$ip" "tail -3 /workspace/gen-$s.log" 2>/dev/null; CRASHED=1; break; }
    sleep 60
  done
  if [ "$CRASHED" = 1 ]; then echo "[$s] terminating crashed pod $pid"; gql "mutation { podTerminate(input:{podId: \\\"$pid\\\"}) }" >/dev/null; return 1; fi
  echo "[$s] filtering (GlotLID) on $pid"
  ssh $SSH -p "$port" "root@$ip" "cd /workspace && /workspace/lidvenv/bin/python ceb-lid.py filter out/ceb-shard-$s.jsonl out/ceb-shard-$s.clean.jsonl"
  echo "[$s] scp clean ceb back"
  scp $SSH -P "$port" "root@$ip:/workspace/out/ceb-shard-$s.clean.jsonl" "out/clean/" >/dev/null 2>&1 || echo "[$s] WARN scp clean failed"
  echo "[$s] terminating $pid"
  gql "mutation { podTerminate(input:{podId: \\\"$pid\\\"}) }" >/dev/null
}

echo ">> provisioning up to $NPODS × $GPU ..."
GOT=0
for s in $(seq 0 $((NPODS-1))); do
  pid=$(provision "$s")
  if [ -n "$pid" ]; then echo "$pid shard$s" >> "$PODS_FILE"; echo ">> shard $s -> $pid"; GOT=$((GOT+1)); else echo ">> shard $s: NO CAPACITY (skipped)"; fi
done
echo ">> provisioned $GOT/$NPODS pods. burn ≈ \$$(echo "$GOT*1.19" | bc)/hr"
[ "$GOT" -gt 0 ] || { echo "ERR: no pods"; exit 1; }

while read -r pid tag; do
  s="${tag#shard}"
  run_shard "$s" "$pid" > "logs/shard-$s.log" 2>&1 &
done < "$PODS_FILE"
echo ">> all shards launched in parallel; waiting ..."
wait

cat out/clean/ceb-shard-*.clean.jsonl > out/ceb-pilot-core.jsonl 2>/dev/null || true
KEPT=$(wc -l < out/ceb-pilot-core.jsonl 2>/dev/null || echo 0)
TOK=$(python3 -c "import json,sys; print(sum(json.loads(l).get('ntok',0) for l in open('out/ceb-pilot-core.jsonl')))" 2>/dev/null || echo "?")
echo ">> ============================================================"
echo ">> FULL RUN DONE. clean ceb gens: $KEPT · clean ceb tokens: $TOK"
echo ">> corpus: out/ceb-pilot-core.jsonl  (per-shard logs in logs/)"
echo ">> ============================================================"
