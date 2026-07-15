#!/usr/bin/env python3
"""Generate the bundled card-feed POOL from the factoid bank: the subset of factoids that
resolve to a real bundled illustration, joined to their source fact's `terms` (needed by the
feed's term-overlap retrieval for deep/lateral edges AND the search box). For Q&A factoids the
question is baked into the displayed text as a prequestion hook ("Q?\n\nA"). Output is a JSON
module imported by packages/mobile/src/data/cards.ts.

  python3 rag/pipeline/gen-cards-pool.py
"""
import json, re

FACTS = 'rag/bank/science-facts.jsonl'
FACTOIDS = 'rag/bank/factoids.jsonl'
IMAGEMAP = 'packages/mobile/src/generated/imageMap.ts'
OUT = 'packages/mobile/src/generated/cardsPool.generated.json'

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

cards = []
for l in open(FACTOIDS):
    l = l.strip()
    if not l:
        continue
    fo = json.loads(l)
    slug = fo['image'].get('slug')
    if not slug or slug not in bundled:
        continue
    fact = {lang: display(fo, lang) for lang in ('en', 'tl', 'bis')}
    if not (fact['tl'] or fact['en']):
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
