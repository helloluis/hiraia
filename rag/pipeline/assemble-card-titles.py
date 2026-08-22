#!/usr/bin/env python3
"""Join the generated card TITLES + taxonomy CATS back into the bundled card pool.

fw-gen-card-titles.py writes one jsonl shard per batch; this folds them into
packages/mobile/src/generated/cardsPool.generated.json as `title` (trilingual, mirroring
`fact`) and `cats` (taxonomy leaf ids). Idempotent — safe to re-run after filling gaps.

Cards with no generated title keep none: cards.ts's cardTitle() returns '' and the index band
falls back to `topic`, exactly as it did before. A partial run therefore degrades per-card
rather than breaking the feed, which is why this does not require 100% coverage to be useful.

  python3 rag/pipeline/assemble-card-titles.py
"""
import json, glob, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'packages/mobile/src/generated/cardsPool.generated.json')
SHARDS = os.path.join(HERE, 'card-titles', 'titles-*.jsonl')
TAX = os.path.join(HERE, 'card-taxonomy.json')

valid_cats = {o['id'] for o in json.load(open(TAX))['leaves']}

titles = {}
dupes = 0
for f in sorted(glob.glob(SHARDS)):
    for line in open(f):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        if r['id'] in titles:
            dupes += 1
        titles[r['id']] = r

pool = json.load(open(POOL))
cards = pool['cards']

applied = no_title = bad_cat = uncategorised = 0
for c in cards:
    r = titles.get(c['id'])
    if not r:
        no_title += 1
        continue
    en = (r.get('title_en') or '').strip()
    if not en:
        no_title += 1
        continue
    # Fall back per-language rather than dropping the title: a missing Cebuano title is not a
    # reason to show the reader a truncated topic instead.
    c['title'] = {
        'en': en,
        'tl': (r.get('title_tl') or en).strip(),
        'bis': (r.get('title_bis') or r.get('title_tl') or en).strip(),
    }
    cats = [x for x in (r.get('cats') or []) if x in valid_cats]
    bad_cat += len([x for x in (r.get('cats') or []) if x not in valid_cats])
    if cats:
        c['cats'] = cats
    else:
        uncategorised += 1
    applied += 1

# Embed the taxonomy alongside the cards so the app imports ONE generated module. The feed
# needs the trilingual leaf LABELS at render time ("other marine animals" / "iba pang
# hayop-dagat"), and shipping them separately would let the ids in `cats` drift from the
# labels that describe them.
pool['taxonomy'] = json.load(open(TAX))['leaves']

with open(POOL, 'w') as fh:
    json.dump(pool, fh, ensure_ascii=False)

n = len(cards)
print(f'pool {n} cards | titles applied {applied} ({100 * applied / n:.1f}%) | without a title {no_title}')
print(f'  duplicate shard rows ignored: {dupes} | out-of-vocabulary cats dropped: {bad_cat}')
print(f'  titled but UNCATEGORISED: {uncategorised}')

lens = [len(c['title']['en']) for c in cards if c.get('title')]
if lens:
    lens.sort()
    print(f"  title length: min {lens[0]} median {lens[len(lens) // 2]} max {lens[-1]}")

dist = collections.Counter(cat for c in cards for cat in (c.get('cats') or []))
print(f'  categories in use: {len(dist)}/{len(valid_cats)} leaves')
if dist:
    big = [(k, v) for k, v in dist.most_common() if v > 800]
    small = [(k, v) for k, v in dist.items() if v < 20]
    print(f'  oversized (>800 cards): {big}')
    print(f'  undersized (<20 cards): {len(small)}')
    print('  top 12:', ', '.join(f'{k}={v}' for k, v in dist.most_common(12)))
