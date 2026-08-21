#!/usr/bin/env python3
"""
Build the regeneration worklist from the review's flagged.csv.

- text / style / garbled / quality flags: keep the ORIGINAL subject prompt (the
  boilerplate fix addresses those failure classes).
- off-topic / scary flags: need a REWRITTEN subject — emitted to rewrite-input.jsonl
  for the agent rewrite pass; merge-rewrites.py folds the results back in.

Run from the worktree repo root:
    python3 packages/images/review/build-regen-worklist.py
"""
import csv
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
IMAGES = os.path.dirname(ROOT)

# original prompts: the worklist copy (webp set) + slug-pngs have no stored prompt
# (their "subject" is derived from the slug/topic).
wl = {}
with open(os.path.join(ROOT, 'worklist.jsonl')) as fh:
    for line in fh:
        d = json.loads(line)
        wl[d['id']] = d

rows = list(csv.DictReader(open(os.path.join(ROOT, 'flagged.csv'))))
keep, rewrite, missing = [], [], []
for r in rows:
    entry = {'id': r['id'], 'set': r['set'], 'verdict': r['verdict'], 'note': r['note'], 'topic': r['topic']}
    orig = wl.get(r['id'])
    if orig:
        entry['prompt'] = orig['prompt']
    if r['verdict'] in ('off-topic', 'scary'):
        rewrite.append(entry)
    else:
        if r['set'] == 'webp' and not orig:
            missing.append(r['id'])
            continue
        # png rows carry no stored prompt; synthesize a subject from the topic text
        if 'prompt' not in entry:
            entry['prompt'] = 'A simple illustration of ' + r['topic'].split(': ', 1)[-1]
        keep.append(entry)

with open(os.path.join(ROOT, 'regen-keep-subject.jsonl'), 'w') as fh:
    for e in keep:
        fh.write(json.dumps(e) + '\n')
with open(os.path.join(ROOT, 'rewrite-input.jsonl'), 'w') as fh:
    for e in rewrite:
        fh.write(json.dumps(e) + '\n')

print(f'flagged: {len(rows)} | keep-subject: {len(keep)} | needs-rewrite: {len(rewrite)} | missing-from-worklist: {len(missing)}')
if missing:
    print('missing ids:', missing[:10])
