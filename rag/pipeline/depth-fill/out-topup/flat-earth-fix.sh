#!/usr/bin/env bash
# Detached verification chain for the 2026-09-08 gate fixes (runs > 10 min, so it is nohup'd):
# rebuild the LaBSE vectors for the new bank row -> rebuild cards.db -> re-diagnose the flat-earth
# query -> two full gate runs. Progress goes to $L; the last line is "ALL DONE".
set -u
cd /Users/luis/Code/hiraia-depth-fill
L=/tmp/flat-earth-fix.log
date '+%H:%M:%S' > "$L"
for p in $(pgrep -f 'rag/scripts/build-vectors.py'); do kill "$p"; done
for p in $(pgrep -f 'llama-server.*--port 80(88|90)'); do kill "$p"; done
sleep 3
echo "=== build-vectors $(date +%H:%M:%S)" >> "$L"
/Users/luis/Code/hiraia/finetuning/.convert-venv/bin/python rag/scripts/build-vectors.py >> "$L" 2>&1
echo "VECTORS EXIT $?" >> "$L"
echo "=== build-cards-db $(date +%H:%M:%S)" >> "$L"
/opt/homebrew/bin/python3 rag/pipeline/build-cards-db.py 2>&1 | grep -E "dbVersion|cards$" >> "$L"
echo "=== diag $(date +%H:%M:%S)" >> "$L"
/opt/homebrew/bin/llama-server -m /Users/luis/Code/hiraia/deploy/models/labse.Q4_K_M.gguf --embedding --pooling cls -ngl 99 --port 8090 --ctx-size 512 > /tmp/embed-diag.log 2>&1 &
EP=$!
for i in $(seq 1 40); do curl -s -m 2 http://localhost:8090/health | grep -q '"ok"' && break; sleep 1; done
EMBED_ENDPOINT=http://localhost:8090 node_modules/.bin/tsx finetuning/eval/retrieval-diag-one.mts "totoo po bang patag ang mundo?" tagalog >> "$L" 2>&1
kill "$EP" 2>/dev/null
sleep 2
for n in 1 2; do
  echo "=== gate run $n $(date +%H:%M:%S)" >> "$L"
  bash finetuning/eval/harness/run-harness.sh > "/tmp/gate-fix-$n.log" 2>&1
  echo "GATE $n EXIT $?" >> "$L"
  grep -E "passed|FAIL|GATE" "/tmp/gate-fix-$n.log" | tail -4 >> "$L"
done
date '+%H:%M:%S' >> "$L"
echo "ALL DONE" >> "$L"
