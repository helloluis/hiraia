#!/usr/bin/env bash
# finalize-heal.sh — check the detached heal pipeline; if PIPELINE_DONE, scp the healed model
# back + terminate the pod. If still running, just print progress. Reads .heal-pod.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
set -a; . ../../../.env.local; set +a
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
KEY="$HOME/.ssh/id_ed25519"; SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=20 -i $KEY"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
read -r POD_ID IP PORT NGPU < .heal-pod
echo ">> pod $POD_ID @ $IP:$PORT (${NGPU} gpu)"
echo "=== pipeline.log tail ==="
LOG=$(ssh $SSH -p "$PORT" "root@$IP" "tail -10 /workspace/pipeline.log; echo '--- gpu ---'; nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader | paste -sd, -" 2>&1)
echo "$LOG"
if echo "$LOG" | grep -q PIPELINE_DONE; then
  echo ">> PIPELINE_DONE - scp healed model back ..."; mkdir -p healed
  scp $SSH -P "$PORT" -r "root@$IP:/workspace/sailor2-2b4-healed" "healed/" && echo ">> healed -> healed/sailor2-2b4-healed" || echo ">> WARN scp failed (retry finalize)"
  echo ">> terminating $POD_ID ..."; gql "mutation { podTerminate(input:{podId: \\\"$POD_ID\\\"}) }" >/dev/null; echo "terminated"
elif echo "$LOG" | grep -q PIPELINE_FAIL; then
  echo ">> PIPELINE FAILED - terminating $POD_ID to stop billing"; gql "mutation { podTerminate(input:{podId: \\\"$POD_ID\\\"}) }" >/dev/null; echo "terminated"
else
  echo ">> still running - re-run finalize-heal.sh later (or when pipeline.log shows PIPELINE_DONE)."
fi
