#!/usr/bin/env python3
"""Find Tagalog verbs written with the WRONG affix family, by corpus majority.

Luis noticed "naglalangoy" in a quiz choice. The corpus settles it without any appeal to
anyone's ear:

    lumalangoy  306 in the quiz bank, 105 in the card corpus
    naglalangoy   2 in the quiz bank,   5 in the card corpus

`langoy` takes the -um- actor-focus affix, and both corpora say so overwhelmingly. The mag-
form is a 0.6% outlier -- rare enough that it is a slip, common enough that a model asked
"is this good Tagalog?" would happily wave it through.

So the detector is structural, not judgemental: strip a verb to its root, sort surface forms
into the -um- family and the mag-/nag- family, and flag the minority family when the majority
dominates it by MIN_RATIO. No model, no dictionary, no opinion -- the same shape as the Cebuano
title_unattested.py, which found `kulob` heading the entire boiling curriculum.

It reports CANDIDATES. Some roots genuinely take both affixes with different meanings
(magluto/lumuto), so the output needs triage exactly like every other enumeration here.

  python3 affix_outliers.py [out.json]
"""
import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
QUIZ = os.path.join(ROOT, 'rag/bank/quiz-bank.jsonl')
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
WORD = re.compile(r"[A-Za-zÀ-ÿ]+(?:-[A-Za-zÀ-ÿ]+)*")
VOWELS = 'aeiou'
MIN_TOTAL = 12       # ignore roots too rare to have a majority
MIN_RATIO = 8        # the majority family must dominate this many times over


def dedup(stem):
    """Undo CV- reduplication: lalangoy -> langoy, tatakbo -> takbo."""
    if len(stem) > 3 and stem[0] not in VOWELS and stem[1] in VOWELS:
        if stem[2:].startswith(stem[0]):
            return stem[2:]
    return stem


def analyse(w):
    """-> (root, family) or None. Families: 'um' and 'mag'."""
    if w.startswith(('nag', 'mag')) and len(w) > 5:
        return dedup(w[3:]), 'mag'
    # -um- is infixed after the first consonant: l+um+angoy, t+um+akbo
    if len(w) > 4 and w[0] not in VOWELS and w[1:3] == 'um':
        return dedup(w[0] + w[3:]), 'um'
    return None


def collect():
    freq = collections.Counter()
    where = collections.defaultdict(list)
    for line in open(QUIZ, encoding='utf-8'):
        r = json.loads(line)
        fields = [(r.get('q') or {}).get('tl', ''),
                  (r.get('explanation') or {}).get('tl', '')]
        fields += [(o.get('tl') or '') for o in (r.get('options') or [])]
        for s in fields:
            for w in WORD.findall(s or ''):
                lw = w.lower()
                freq[lw] += 1
                where[lw].append((r['id'], (s or '')[:110]))
    for c in json.load(open(POOL, encoding='utf-8'))['cards']:
        t = ((c.get('fact') or {}).get('tl') or '') + ' ' + ((c.get('title') or {}).get('tl') or '')
        for w in WORD.findall(t):
            freq[w.lower()] += 1
    return freq, where


def main():
    freq, where = collect()
    fam = collections.defaultdict(collections.Counter)   # root -> family -> count
    forms = collections.defaultdict(collections.Counter)  # root -> surface -> count
    for w, n in freq.items():
        a = analyse(w)
        if not a:
            continue
        root, f = a
        fam[root][f] += n
        forms[root][w] += n

    hits = []
    for root, fc in fam.items():
        total = sum(fc.values())
        if total < MIN_TOTAL or len(fc) < 2:
            continue
        maj, mino = max(fc, key=fc.get), min(fc, key=fc.get)
        if fc[maj] >= MIN_RATIO * max(1, fc[mino]):
            bad = {w: n for w, n in forms[root].items()
                   if analyse(w) and analyse(w)[1] == mino}
            hits.append({'root': root, 'majority': maj, 'majority_n': fc[maj],
                         'minority': mino, 'minority_n': fc[mino],
                         'minority_forms': bad,
                         'examples': [x for w in bad for x in where.get(w, [])][:3]})
    hits.sort(key=lambda h: -h['majority_n'])
    print('%d roots where one affix family dominates the other %dx+ (min %d uses)\n'
          % (len(hits), MIN_RATIO, MIN_TOTAL))
    for h in hits[:25]:
        print('  %-14s %s %-5d vs %s %-3d   outliers: %s'
              % (h['root'], h['majority'], h['majority_n'], h['minority'], h['minority_n'],
                 ', '.join('%s(%d)' % (k, v) for k, v in sorted(h['minority_forms'].items(),
                                                                key=lambda x: -x[1])[:3])))
    total_hits = sum(sum(h['minority_forms'].values()) for h in hits)
    print('\n%d outlier tokens across %d roots' % (total_hits, len(hits)))
    if len(sys.argv) > 1:
        json.dump(hits, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
