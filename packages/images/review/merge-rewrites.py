#!/usr/bin/env python3
"""
Merge the regen worklist: keep-subject rows (original prompt) + rewritten rows
(new subject from the agent pass). Output rows are {"id", "prompt"} — the shape
batch-submit-all.py consumes via WORKLIST.

    python3 packages/images/review/merge-rewrites.py
"""
import glob
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))

out = []
with open(os.path.join(ROOT, 'regen-keep-subject.jsonl')) as fh:
    for line in fh:
        d = json.loads(line)
        out.append({'id': d['id'], 'prompt': d['prompt']})

n_rewritten = 0
for f in sorted(glob.glob(os.path.join(ROOT, 'rewrite-out', '*.jsonl'))):
    with open(f) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            out.append({'id': d['id'], 'prompt': d['subject']})
            n_rewritten += 1

dest = os.path.join(ROOT, 'regen-worklist.jsonl')
with open(dest, 'w') as fh:
    for r in out:
        fh.write(json.dumps(r, ensure_ascii=False) + '\n')
print(f'{dest}: {len(out)} rows ({n_rewritten} rewritten)')
