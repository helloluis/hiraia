#!/usr/bin/env python3
"""Apply card-cats-patch.json to the pool — sets cats ONLY on cards that have none (§4.2).

DURABILITY WARNING (spec §4.3): `gen-cards-pool.py` regenerates the pool from the bank and
knows nothing about `cats` or titles — a pool regen wipes both until this patch (and the
titles patch) are re-applied. The fix (a re-apply hook in the regen path) is a separate task.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
PATCH = os.path.join(HERE, 'card-cats-patch.json')

pool = json.load(open(POOL))
patch = json.load(open(PATCH))
applied = untouched = 0
for c in pool['cards']:
    p = patch.get(c['id'])
    if p and not c.get('cats'):
        c['cats'] = p
        applied += 1
    elif c.get('cats'):
        untouched += 1

json.dump(pool, open(POOL, 'w'), ensure_ascii=False)
missing = sum(1 for c in pool['cards'] if not c.get('cats'))
print(f"applied {applied} | pre-existing cats untouched {untouched} | still missing {missing}")
