#!/usr/bin/env bash
# resft-guard.sh — poll the detached re-SFT pipeline; on RESFT_PIPELINE_DONE the adapters are
# already on HF (pushed by the pipeline), so just report + terminate. On FAIL, terminate to
# stop billing. Reads .resft-pod. Ceiling 4h. Independent of the launcher.
set -uo pipefail
cd /Users/luis/Code/hiraia/finetuning/distill/ceb-heal
set -a; . ../../../.env.local; set +a
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"; KEY="$HOME/.ssh/id_ed25519"
read -r POD IP PORT NGPU < .resft-pod
gql(){ curl -s --max-time 30 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
sp(){ ssh -n -o StrictHostKeyChecking=no -o ConnectTimeout=20 -i "$KEY" -p "$PORT" "root@$IP" "$1" 2>/dev/null; }
term(){ gql "mutation { podTerminate(input: {podId: \\\"$POD\\\"}) }" >/dev/null; }
START=$SECONDS; CEIL=14400
echo ">> resft-guard watching $POD @ $IP:$PORT"
while true; do
  LOG=$(sp "tail -5 /workspace/pipeline.log"); EL=$((SECONDS-START))
  if echo "$LOG" | grep -q RESFT_PIPELINE_DONE; then
    echo ">> RESFT_PIPELINE_DONE at ${EL}s — adapters on HF (resft-tl-adapter, resft-bis-adapter)"
    sp "grep -E 'Training done|TL_DONE|BIS_DONE|ADAPTERS_PUSHED' /workspace/pipeline.log | tail -6"
    term; echo "TERMINATED (done)"; break
  fi
  if echo "$LOG" | grep -qE 'RESFT_FAIL'; then echo ">> FAIL:"; echo "$LOG"; term; echo "TERMINATED (fail)"; break; fi
  if [ "$EL" -gt "$CEIL" ]; then echo ">> CEILING -> terminate"; term; echo "TERMINATED (ceiling)"; break; fi
  STAGE=$(echo "$LOG" | grep -oE 'TRAIN (TAGALOG|BISAYA)|TL_DONE|BIS_DONE|PUSH both|RESFT PIPELINE START|deps|pull healed' | tail -1)
  STEP=$(echo "$LOG" | grep -oE '[0-9]+/[0-9]+ \[' | tail -1)
  echo "[$(date +%H:%M:%S)] ${EL}s | ${STAGE:-?} ${STEP:-}"
  sleep 120
done
echo ">> guard exit"; gql "query { myself { pods { id } clientBalance } }"
