#!/usr/bin/env python3
"""Generate the bundled card-feed POOL from the factoid bank: the subset of factoids that
resolve to a real bundled illustration, joined to their source fact's `terms` (needed by the
feed's term-overlap retrieval for deep/lateral edges AND the search box). For Q&A factoids the
question is baked into the displayed text as a prequestion hook ("Q?\n\nA"). Output is a JSON
module imported by packages/mobile/src/data/cards.ts.

A factoid resolves to an illustration in one of two ways, checked in this order:
  1. its `image.slug` names a bundled clip-art PNG (packages/images/assets-png), or
  2. its own ffct id has a bundled engraving (packages/images/cards-png/<id>.png, made by
     packages/images/to-card-png.mjs) — then `slug` = the id, exactly as card-ui's
     wire-app-pool.py does. Both live in IMAGE_MAP, so the app resolves either the same way.
Ordering is the bank's (factoids.jsonl) order, so the output is deterministic. A card whose displayed
text exceeds the notebook page's word budget in any language (BUDGET, = card-harness.mts's long-factoid
threshold) is never shipped: fix it in factoid-patches.json (fw-compress-factoids.py), then re-run.

  python3 rag/pipeline/gen-cards-pool.py
"""
import json, re

FACTS = 'rag/bank/science-facts.jsonl'
FACTOIDS = 'rag/bank/factoids.jsonl'
IMAGEMAP = 'packages/mobile/src/generated/imageMap.ts'
OUT = 'packages/mobile/src/generated/cardsPool.generated.json'
BUDGET = 48                      # displayed words per language (Q hook + body); apply-card-fixes.py compresses to <=46

# source-fact terms, by id (lexical retrieval signal the factoids don't carry themselves)
terms_by_id = {}
for l in open(FACTS):
    l = l.strip()
    if l:
        r = json.loads(l)
        terms_by_id[r['id']] = [t.lower() for t in r.get('terms', [])]

# slugs that are actually bundled as PNGs (every card must show a real illustration)
bundled = set(re.findall(r'"([^"]+)":\s*require', open(IMAGEMAP).read()))

def display(fo, lang):
    body = (fo['text'].get(lang) or '').strip()
    q = (fo.get('q') or {}).get(lang, '') if fo.get('format') == 'qa' else ''
    q = (q or '').strip()
    return f'{q}\n\n{body}' if q and body else body

cards, over = [], []
for l in open(FACTOIDS):
    l = l.strip()
    if not l:
        continue
    fo = json.loads(l)
    if fo.get('retired'):            # tombstoned in rag/pipeline/factoid-patches.json: id kept, card not shipped
        continue
    slug = fo['image'].get('slug')
    if not slug or slug not in bundled:             # no bundled clip-art -> the card's own engraving, if bundled
        slug = fo['id'] if fo['id'] in bundled else None
    if not slug:
        continue
    fact = {lang: display(fo, lang) for lang in ('en', 'tl', 'bis')}
    if not (fact['tl'] or fact['en']):
        continue
    if max(len(t.split()) for t in fact.values()) > BUDGET:   # over-budget page: patch it, never ship it
        over.append(fo['id'])
        continue
    cards.append({
        'id': fo['id'],
        'factId': fo['factId'],
        'domain': fo.get('domain') or '',
        'topic': fo.get('topic', ''),
        'terms': terms_by_id.get(fo['factId'], []),
        'fact': fact,
        'slug': slug,
    })

with open(OUT, 'w') as f:
    json.dump({'cards': cards}, f, ensure_ascii=False)

import os
from collections import Counter
print(f'wrote {len(cards)} cards -> {OUT}  ({os.path.getsize(OUT)/1e6:.1f} MB)')
print('by domain:', dict(Counter(c['domain'] for c in cards)))
print('with terms:', sum(1 for c in cards if c['terms']), '/', len(cards))
print(f'over budget (>{BUDGET} displayed words in some language, NOT shipped): {len(over)}' + (f' — {" ".join(over[:20])}' + (' …' if len(over) > 20 else '') if over else ''))
print('engraving-backed (slug = own id):', sum(1 for c in cards if c['slug'] == c['id']), '| clip-art-backed:', sum(1 for c in cards if c['slug'] != c['id']))
