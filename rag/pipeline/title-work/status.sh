#!/usr/bin/env bash
# One-shot status for the title-polish run. Safe to run any time, from anywhere.
cd "$(dirname "$0")" || exit 1
TOTAL=$(wc -l < worklist.jsonl)
SHARDS=$(( (TOTAL + 39) / 40 ))
DONE=0; EMPTY=0
if [ -d out ]; then
  for f in out/shard-*.jsonl; do
    [ -e "$f" ] || break
    if [ -s "$f" ]; then DONE=$((DONE+1)); else EMPTY=$((EMPTY+1)); fi
  done
fi
echo "shards: $DONE/$SHARDS finished ($EMPTY zero-byte/retryable)"
if [ "$DONE" -gt 0 ]; then
  echo "ops: $(cat out/shard-*.jsonl | python3 -c "
import sys, json, collections
c = collections.Counter(json.loads(l)['op'] for l in sys.stdin if l.strip())
print(' '.join(f'{k}={v}' for k, v in c.most_common()))")"
fi
if pgrep -f title-polish-runner.py > /dev/null; then
  echo "runner: RUNNING (pid $(pgrep -f title-polish-runner.py | head -1))"
else
  echo "runner: NOT RUNNING"
fi
echo "--- last 5 log lines ---"
tail -5 run.log 2>/dev/null || echo "(no run.log)"
