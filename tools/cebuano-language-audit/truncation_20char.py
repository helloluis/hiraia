#!/usr/bin/env python3
"""Locate titles cut off by the 20-character title truncation bug.

ROOT CAUSE, established by a length control rather than by reading cards:

    title length | mid-word truncations
        18       |    2
        19       |    6
        20       |  128        <-- 20x the neighbouring rate
        21       |    2
        22       |    4

and the raw length histogram over all 147,468 titles shows a matching cliff -- 12,679 at 18,
12,657 at 19, 12,053 at 20, then 6,808 at 21. The distribution is smooth everywhere else. A
subset of titles was generated (or post-processed) through a hard 20-character cut.

It is NOT a translation defect: it hits English (31), Tagalog (48) and Cebuano (49) about
equally, which is also why the Cebuano LLM sweep almost entirely missed it -- a cut title
reads as terse, not as wrong.

128 is a FLOOR, not a census. It counts only cuts that leave a non-word ("Energy Without
Oxyge", "Sibol mula sa Rhizom"). A cut that happens to land on a word boundary --
"Waling-Waling Orchid" for "Waling-Waling Orchids" -- is indistinguishable from an
intentionally compact title and is deliberately not counted here.

  python3 truncation_20char.py [out.json]
"""
import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
TOK = re.compile(r"[A-Za-zÀ-ÿ]+(?:[-'][A-Za-zÀ-ÿ]+)*")
CUT_LEN = 20


def vocabulary(cards):
    """Most generous possible 'is this a real word': seen anywhere in the pool."""
    v = collections.Counter()
    for c in cards:
        for s in list((c.get('fact') or {}).values()) + list((c.get('title') or {}).values()):
            for w in TOK.findall(s or ''):
                v[w.lower()] += 1
        for t in (c.get('terms') or []):
            for w in TOK.findall(t):
                v[w.lower()] += 1
    return v


def scan(cards, vocab, length=CUT_LEN):
    rows = []
    for c in cards:
        ctx = ' '.join([v or '' for v in (c.get('fact') or {}).values()] +
                       [v or '' for v in (c.get('title') or {}).values()] +
                       (c.get('terms') or []))
        for lang in ('en', 'tl', 'bis'):
            s = ((c.get('title') or {}).get(lang) or '').strip()
            if len(s) != length or len(s.split()) < 2:
                continue
            last = s.split()[-1].strip('.,:;')
            if len(last) < 4 or vocab[last.lower()] > 3:
                continue          # a real word: it recurs across the corpus
            m = re.search(r'\b%s[a-zA-Z]{1,6}\b' % re.escape(last), ctx, re.I)
            if m and m.group(0).lower() != last.lower():
                rows.append({'id': c['id'], 'lang': lang, 'title': s,
                             'truncated': last, 'full_word': m.group(0)})
    return rows


if __name__ == '__main__':
    cards = json.load(open(POOL, encoding='utf-8'))['cards']
    vocab = vocabulary(cards)
    for L in (18, 19, 20, 21, 22):
        n = collections.Counter(r['lang'] for r in scan(cards, vocab, L))
        print('len=%d  en %3d  tl %3d  bis %3d   TOTAL %d'
              % (L, n['en'], n['tl'], n['bis'], sum(n.values())))
    rows = scan(cards, vocab)
    print('\n%d high-confidence truncations at the %d-character cut' % (len(rows), CUT_LEN))
    if len(sys.argv) > 1:
        json.dump(rows, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)
