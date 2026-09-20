#!/usr/bin/env python3
"""Find Cebuano TITLE words that appear in no Cebuano BODY anywhere in the corpus.

This is the strongest detector in the audit and the only one that needs no judgement of
Cebuano at all. The signal is purely structural: if a word heads >=3 card titles but appears
in ZERO of 47,056 Cebuano bodies -- and in no English, Tagalog or terms field either -- then
whatever produced the titles was not drawing on the same vocabulary as whatever produced the
bodies. That is a generator defect, and it is invisible to a reader who only sees one card.

The case that revealed it: `kulob` heads 27 Cebuano titles, 25 of them boiling-point cards
("100 Degrees Kulob Tubig", "373 Kelvin Kulob", "Asin Kulob Taas"), and appears in no Cebuano
body at all -- while the bodies of those same cards say mobukal/nagbukal. The two non-boiling
uses are the word's real meaning: "Kulob nga Tudlo sa Tubig" = why fingers WRINKLE in water.
So the entire boiling curriculum is headed by a word meaning wrinkled/face-down.

NOT every hit is a defect. Legitimate spelling variants (daku/dako, itum/itom) and Spanish
loans (azul) land here too, because the bodies happen to prefer the other form. The output is
a CANDIDATE list and must be triaged card by card, like every other enumeration in this audit.

  python3 title_unattested.py [out.json]
"""
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
TOK = re.compile(r"[A-Za-zÀ-ÿ]+(?:[-'][A-Za-zÀ-ÿ]+)*")
MIN_TITLES = 3          # below this it is noise, not a systematic substitution
MIN_LEN = 4


def detect(cards):
    body, title, other, where = (collections.Counter(), collections.Counter(),
                                 collections.Counter(), collections.defaultdict(list))
    for c in cards:
        fact, ttl = c.get('fact') or {}, c.get('title') or {}
        for w in set(TOK.findall(fact.get('bis') or '')):
            body[w.lower()] += 1
        for w in set(TOK.findall(ttl.get('bis') or '')):
            title[w.lower()] += 1
            where[w.lower()].append(c['id'])
        # a word the card's OTHER languages use is a loan or a name, not a generator defect
        for f in ('en', 'tl'):
            for w in TOK.findall((fact.get(f) or '') + ' ' + (ttl.get(f) or '')):
                other[w.lower()] += 1
        for t in (c.get('terms') or []):
            for w in TOK.findall(t):
                other[w.lower()] += 1

    hits = [{'word': w, 'titles': n, 'ids': where[w]}
            for w, n in title.items()
            if n >= MIN_TITLES and body[w] == 0 and other[w] == 0 and len(w) >= MIN_LEN]
    hits.sort(key=lambda h: -h['titles'])
    return hits


if __name__ == '__main__':
    hits = detect(json.load(open(POOL, encoding='utf-8'))['cards'])
    cards_touched = {i for h in hits for i in h['ids']}
    print('%d title words unattested in any Cebuano body, touching %d cards\n'
          % (len(hits), len(cards_touched)))
    for h in hits[:40]:
        print('   %-18s %3d titles   e.g. %s' % (h['word'], h['titles'], ' '.join(h['ids'][:3])))
    if len(sys.argv) > 1:
        json.dump(hits, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)
