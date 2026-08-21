#!/usr/bin/env python3
"""
Split the sheet manifests into per-agent review batches (12 sheets = 192 tiles
per batch) and write one batch-manifest JSON per agent under review/batches/.

Run after make-sheets.py:
    python3 packages/images/review/make-batches.py
"""
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
SHEETS_PER_BATCH = 12

entries = []
for set_name in ('webp', 'png'):
    with open(os.path.join(ROOT, 'manifests', f'{set_name}-sheets.json')) as fh:
        for sheet in json.load(fh):
            entries.append({'set': set_name, 'sheet': sheet['sheet'], 'tiles': sheet['tiles']})

os.makedirs(os.path.join(ROOT, 'batches'), exist_ok=True)
os.makedirs(os.path.join(ROOT, 'verdicts'), exist_ok=True)

n = 0
for bi in range(0, len(entries), SHEETS_PER_BATCH):
    chunk = entries[bi:bi + SHEETS_PER_BATCH]
    path = os.path.join(ROOT, 'batches', f'batch-{n:03d}.json')
    with open(path, 'w') as fh:
        json.dump(chunk, fh)
    n += 1
print(f'{len(entries)} sheets -> {n} batches of up to {SHEETS_PER_BATCH}')
