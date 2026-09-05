#!/usr/bin/env python3
"""Validate a sample/answer file against the SPEC rules without merging.

  python3 rag/pipeline/card-titles-check.py <answers.json>
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
POOL = os.path.join(HERE, 'cardsPool.app.json')
EMOJI = re.compile(r'[\U0001F300-\U0001FAFF]')


def main():
    path = sys.argv[1]
    answers = json.load(open(path))
    pool = {c['id']: c for c in json.load(open(POOL))['cards']}
    bad = []
    for cid, t in answers.items():
        if cid not in pool:
            bad.append((cid, 'unknown id')); continue
        if (pool[cid].get('title') or {}).get('tl'):
            bad.append((cid, 'already titled')); continue
        for k in ('tl', 'en', 'bis'):
            v = (t.get(k) or '').strip()
            if not v:                 bad.append((cid, f'{k} empty'))
            elif len(v) > 32:         bad.append((cid, f'{k} {len(v)} chars > 32: {v!r}'))
            elif v != t[k]:           bad.append((cid, f'{k} untrimmed'))
            elif v.endswith(('.', '?', '!')): bad.append((cid, f'{k} punctuation'))
            elif v[0].islower():      bad.append((cid, f'{k} not Title Case: {v!r}'))
            elif v.isupper() and len(v) > 5: bad.append((cid, f'{k} all caps'))
            elif EMOJI.search(v):     bad.append((cid, f'{k} emoji'))
        if t.get('tl') == pool[cid]['topic']:
            bad.append((cid, 'tl copied the topic'))
    same3 = sum(1 for t in answers.values() if t.get('tl') == t.get('en') == t.get('bis'))
    lens = sorted(len((t.get(k) or '')) for t in answers.values() for k in ('tl', 'en', 'bis'))
    n = len(answers)
    print(f'{n} titles | {len(bad)} problems | identical-across-3: {same3} ({100*same3/max(n,1):.0f}%)')
    if lens:
        print(f'chars: min {lens[0]} median {lens[len(lens)//2]} max {lens[-1]}')
    for b in bad[:40]:
        print('  ', b)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
