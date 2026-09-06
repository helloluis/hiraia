#!/usr/bin/env python3
"""Merge the backfilled cats shards into card-cats-patch.json (CARD-CATS-BACKFILL-SPEC §4.1).

Reads rag/pipeline/card-cats/cats-*.jsonl, validates (1-2 ids, all in the 108-leaf ladder,
no duplicates within a card), dedupes by id (last wins), and writes
rag/pipeline/card-cats-patch.json. STRICT=1 exits non-zero on any invalid row.

Also emits rag/pipeline/card-cats-unplaced.json (spec §5): todo cards that appear in NO
shard — with topic/title_en, ready for hand-assignment or a new-leaf decision.
"""
import json, os, glob, collections, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
TAX = os.path.join(HERE, 'card-taxonomy.json')
SHARDS = os.path.join(HERE, 'card-cats', 'cats-*.jsonl')
STRICT = os.environ.get('STRICT') == '1'

valid = {l['id'] for l in json.load(open(TAX))['leaves']}
pool = json.load(open(POOL))
todo = [c for c in pool['cards'] if not c.get('cats')]
todo_ids = {c['id'] for c in todo}

patch, invalid, dupes = {}, 0, 0
for f in sorted(glob.glob(SHARDS)):
    for line in open(f):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        cid = r.get('id')
        cats = r.get('cats') or []
        cats = list(dict.fromkeys(cats))  # dedupe within card
        ok = (
            cid in todo_ids
            and 1 <= len(cats) <= 2
            and all(c in valid for c in cats)
        )
        if not ok:
            invalid += 1
            continue
        if cid in patch:
            dupes += 1
        patch[cid] = cats

unplaced = [
    {'id': c['id'], 'topic': c.get('topic'), 'title_en': (c.get('title') or {}).get('en', '')}
    for c in todo if c['id'] not in patch
]
json.dump({cid: cats for cid, cats in patch.items()}, open(os.path.join(HERE, 'card-cats-patch.json'), 'w'), ensure_ascii=False, indent=0)
json.dump(unplaced, open(os.path.join(HERE, 'card-cats-unplaced.json'), 'w'), ensure_ascii=False, indent=1)

print(f"rows read: todo={len(todo)} | patch covers {len(patch)}/{len(todo)} "
      f"({100*len(patch)/max(len(todo),1):.2f}%) | invalid dropped {invalid} | dupes {dupes}")
print(f"unplaced: {len(unplaced)} -> card-cats-unplaced.json")
if unplaced:
    for u in unplaced[:10]:
        print(f"  {u['id']}: {u['topic']} | {u['title_en']}")
if STRICT and (invalid or unplaced):
    sys.exit(1)
