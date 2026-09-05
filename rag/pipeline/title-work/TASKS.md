# Title polish run — VPS instructions

Fixes judge findings #1 (keyword-salad titles) and #3 (spoiler titles) with Kimi, model-routed:
K2.7 for cheap triage, K3 for hard rewrites. Resumable; safe to kill and restart.

## On the VPS

```bash
mkdir -p ~/title-work && cd ~/title-work
# upload from local (run from hiraia-unified):
#   scp -P 22 rag/pipeline/title-work/worklist.jsonl \
#          rag/pipeline/title-work/title-polish-runner.py VPS:~/title-work/

export KIMI_API_KEY=<key>

# 1) PILOT first — 60 cards, proportional slice, verifies prompts+parse before spend:
LIMIT=60 python3 title-polish-runner.py
# inspect: jq -c '.op' out/*.jsonl | sort | uniq -c  (keep/fix/escalate split sane?)
#           spot-check fixes read like titles

# 2) FULL run (nohup — survives disconnect):
nohup python3 title-polish-runner.py > run.log 2>&1 &

# 3) progress while traveling: tail run.log ; count shards: ls out | wc -l
```

Failure semantics: a shard that throws writes NOTHING (zero-byte = unfinished) and is retried
on the next run — so `python3 title-polish-runner.py` after any crash just resumes.
Escalations the smart model also fails are merged as `keep` locally (visible in the merge report).

## Back on local (after landing)

```bash
rsync -z VPS:~/title-work/out/ rag/pipeline/title-work/out/
python3 rag/pipeline/merge-title-polish.py    # validate + patch pool + report
python3 rag/pipeline/build-cards-db.py        # rebuild cards.db
cd packages/mobile && npx tsx scripts/session-walk.mts   # tripwires must stay green
```
