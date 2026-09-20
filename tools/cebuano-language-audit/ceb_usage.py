#!/usr/bin/env python3
"""Ask the CORPUS how it renders an English concept in Cebuano -- and vice versa.

The governing constraint of this audit is that Claude's Cebuano is weaker than its Tagalog, so
no repair may rest on Claude's ear. This makes the corpus itself the authority: 47,056 cards of
human-reviewed Cebuano is a better reference than the model's judgement, and it is the method
that refuted `bakal`, `lana` and `bulok` after they had already contaminated four sweep chunks.

  python3 ceb_usage.py --en vibrate        how do Cebuano bodies render cards about vibrating?
  python3 ceb_usage.py --bis lingkod       what does the corpus actually use this word FOR?

--en  finds cards whose ENGLISH contains the term and prints the Cebuano sentence beside it,
      plus a frequency table of the candidate Cebuano words that recur across those cards.
--bis finds cards whose CEBUANO body contains the word and prints the English beside it, so a
      false-friend claim can be checked against real usage instead of intuition.

Counts are over Cebuano BODIES only. Titles are excluded deliberately: titles are where the
defects concentrate, so including them would let a defect vouch for itself.
"""
import argparse
import collections
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
TOK = re.compile(r"[A-Za-zÀ-ÿ]+(?:[-'][A-Za-zÀ-ÿ]+)*")

STOP = set('''ang sa ug nga og mga ka ni si na ay kay kini niini ilang imong atong iyang
usa duha tulo upat lima unom pito walo siyam napulo dili wala walay adunay aduna may kung kon
para gikan aron unsa unsay giunsa pila ngano nganong asa kinsa mao ba mas labing pud pod ra
gyud gayud kaayo lang uban laing lain bag-o bag-ong tanan matag apan busa kahay ikaw ako kita
kami sila siya niya nila nato namo nimo nako ni sa'''.split())


def load():
    return json.load(open(POOL, encoding='utf-8'))['cards']


def by_english(cards, term, limit):
    rx = re.compile(r'%s' % term, re.I)
    hits = [c for c in cards
            if rx.search(((c.get('fact') or {}).get('en') or '') + ' ' +
                         ((c.get('title') or {}).get('en') or ''))]
    print('%d cards whose ENGLISH matches %r\n' % (len(hits), term))
    freq = collections.Counter()
    for c in hits:
        for w in TOK.findall((c.get('fact') or {}).get('bis') or ''):
            lw = w.lower()
            if lw not in STOP and len(lw) > 3:
                freq[lw] += 1
    print('Cebuano words most characteristic of these cards:')
    for w, n in freq.most_common(25):
        print('   %-22s %4d' % (w, n))
    print('\nexamples:')
    for c in hits[:limit]:
        print('  %s' % c['id'])
        print('    EN : %s' % (((c.get('fact') or {}).get('en') or '')[:170].replace('\n', ' ')))
        print('    BIS: %s' % (((c.get('fact') or {}).get('bis') or '')[:170].replace('\n', ' ')))


def by_cebuano(cards, word, limit):
    rx = re.compile(r'\b%s\w*' % word, re.I)
    hits = [c for c in cards if rx.search((c.get('fact') or {}).get('bis') or '')]
    tit = [c for c in cards if rx.search((c.get('title') or {}).get('bis') or '')]
    print('%r: %d Cebuano BODIES, %d Cebuano titles\n' % (word, len(hits), len(tit)))
    if not hits:
        print('  NOT ATTESTED IN ANY CEBUANO BODY. Treat as unsourced.')
    for c in hits[:limit]:
        b = (c.get('fact') or {}).get('bis') or ''
        m = rx.search(b)
        s = max(0, m.start() - 70)
        print('  %s' % c['id'])
        print('    BIS: ...%s...' % b[s:m.end() + 70].replace('\n', ' '))
        print('    EN : %s' % (((c.get('fact') or {}).get('en') or '')[:150].replace('\n', ' ')))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--en')
    ap.add_argument('--bis')
    ap.add_argument('--limit', type=int, default=8)
    a = ap.parse_args()
    cards = load()
    if a.en:
        by_english(cards, a.en, a.limit)
    elif a.bis:
        by_cebuano(cards, a.bis, a.limit)
    else:
        ap.error('give --en or --bis')
