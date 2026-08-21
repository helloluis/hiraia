#!/usr/bin/env python3
"""
Aggregate the review swarm's verdict files into a report + flagged list.

Reads every review/verdicts/batch-*.jsonl, cross-checks coverage against the
sheet manifests (every tile judged exactly once), and writes:
  review/report.txt    — counts by verdict, per set + overall
  review/flagged.csv   — every non-ok tile: set,id,verdict,note,sheet,row,col

    python3 packages/images/review/aggregate.py
"""
import csv
import json
import os
from collections import Counter

ROOT = os.path.dirname(os.path.abspath(__file__))
VERDICTS = ('ok', 'off-topic', 'text', 'garbled', 'style', 'quality', 'scary')

# every tile that exists, keyed (set, id)
expected = {}
for set_name in ('webp', 'png'):
    with open(os.path.join(ROOT, 'manifests', f'{set_name}-sheets.json')) as fh:
        for sheet in json.load(fh):
            for t in sheet['tiles']:
                expected[(set_name, t['id'])] = {**t, 'set': set_name}

seen = {}
dupes = 0
vdir = os.path.join(ROOT, 'verdicts')
for f in sorted(os.listdir(vdir)):
    if not f.endswith('.jsonl'):
        continue
    with open(os.path.join(vdir, f)) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                v = json.loads(line)
            except json.JSONDecodeError:
                continue
            key = (v.get('set', ''), v.get('id', ''))
            if key in seen:
                dupes += 1
            seen[key] = v

missing = [k for k in expected if k not in seen]
unknown = [k for k in seen if k not in expected]

counts = {s: Counter() for s in ('webp', 'png')}
for (set_name, _), v in seen.items():
    verdict = v.get('v', '?')
    if verdict not in VERDICTS:
        verdict = '?'
    counts[set_name][verdict] += 1

lines = ['=================== ILLUSTRATION REVIEW ===================']
total_flagged = 0
for set_name in ('webp', 'png'):
    n = sum(counts[set_name].values())
    flagged = n - counts[set_name]['ok']
    total_flagged += flagged
    lines.append(f"\n{set_name}: {n} judged | OK {counts[set_name]['ok']} | FLAGGED {flagged} ({100*flagged/max(n,1):.1f}%)")
    for verdict in VERDICTS[1:] + ('?',):
        if counts[set_name][verdict]:
            lines.append(f"  {verdict:10s} {counts[set_name][verdict]}")
lines.append(f"\ncoverage: {len(seen)}/{len(expected)} judged | missing {len(missing)} | dupes {dupes} | unknown ids {len(unknown)}")
if missing[:10]:
    lines.append('missing sample: ' + ', '.join(f'{s}:{i}' for s, i in missing[:10]))

report = '\n'.join(lines) + '\n'
with open(os.path.join(ROOT, 'report.txt'), 'w') as fh:
    fh.write(report)
print(report)

with open(os.path.join(ROOT, 'flagged.csv'), 'w', newline='') as fh:
    w = csv.writer(fh)
    w.writerow(['set', 'id', 'verdict', 'note', 'topic', 'sheet', 'row', 'col'])
    for (set_name, img_id), v in sorted(seen.items()):
        if v.get('v') in VERDICTS[1:]:
            meta = expected.get((set_name, img_id), {})
            w.writerow([set_name, img_id, v['v'], v.get('note', ''), meta.get('topic', ''),
                        os.path.basename(meta.get('sheet', '')), meta.get('row', ''), meta.get('col', '')])
print(f"flagged.csv written ({total_flagged} rows)")
