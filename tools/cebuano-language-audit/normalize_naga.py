#!/usr/bin/env python3
"""Normalise the Hiligaynon/old-Cebuano `naga-` progressive to Cebu Cebuano `nag-`.

Luis's decision: the app speaks Cebuano as spoken in Cebu, not Hiligaynon. Both forms are
correct Cebuano -- this is a dialect choice, not a defect repair -- but the corpus currently
mixes them, and 259 cards switch between the two inside a single body:

    ffct-00053  "...ang NAGASUYOP og tubig ... ug NAGPALIG-on sa tanom."

The edit is one letter: naga- -> nag-, maga- -> mag-.

THE TRAP, and it is why this is gated rather than a sed one-liner: not every word beginning
"maga"/"naga" is the prefix plus a root. `magahi` is ma- + gahi (hard), and stripping the `a`
would produce "maghi", which is nothing. So the ONLY forms rewritten are those whose target is
ALREADY ATTESTED in the corpus at least MIN_ATTEST times. A form the corpus has never used is
a form this script will not invent -- the same rule that has caught every bad idea in this
audit, including several of mine.

  python3 normalize_naga.py [--apply]
"""
import argparse
import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
QUIZ = os.path.join(ROOT, 'rag/bank/quiz-bank.jsonl')
RUN = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'runs/2026-09-20-scope')
WORD = re.compile(r"[A-Za-zÀ-ÿ]+(?:-[A-Za-zÀ-ÿ]+)*")
SRC = re.compile(r'^(n|m)aga(.{3,})$', re.I)
MIN_ATTEST = 10


def corpus_freq(cards, quiz):
    f = collections.Counter()
    for c in cards:
        t = ((c.get('fact') or {}).get('bis') or '') + ' ' + ((c.get('title') or {}).get('bis') or '')
        for w in WORD.findall(t):
            f[w.lower()] += 1
    for r in quiz:
        for s in ([(r.get('q') or {}).get('bis', ''), (r.get('explanation') or {}).get('bis', '')]
                  + [(o.get('bis') or '') for o in (r.get('options') or [])]):
            for w in WORD.findall(s or ''):
                f[w.lower()] += 1
    return f


def targets(word):
    """Candidate nag-/mag- forms, best-attested first.

    A vowel-initial root needs the hyphen the prefix hides: nagaagos -> nag-agos, not
    "nagagos"; nagausab -> nag-usab (454 attested) and not "nagusab" (2). Offer both and let
    the corpus pick.
    """
    m = SRC.match(word)
    if not m:
        return []
    p, stem = m.group(1).lower(), m.group(2).lower()
    return [p + 'ag' + stem, p + 'ag-' + stem]


def match_case(src, dst):
    if src.isupper():
        return dst.upper()
    if src[:1].isupper():
        return dst[:1].upper() + dst[1:]
    return dst


def build_subs(freq):
    subs, held = {}, []
    for w, n in sorted(freq.items()):
        cand = targets(w)
        if not cand:
            continue
        best = max(cand, key=lambda t: freq[t])
        if freq[best] < MIN_ATTEST:
            held.append({'form': w, 'uses': n, 'target': best, 'target_uses': freq[best]})
            continue
        subs[w] = best
    return subs, held


def spans_ok(card, new_bis, new_title):
    for lang, sp in (card.get('emphasis') or {}).items():
        if lang != 'bis':
            continue
        old = ((card.get('fact') or {}).get('bis') or '') + '\n' + ((card.get('title') or {}).get('bis') or '')
        new = new_bis + '\n' + new_title
        for s in (sp or []):
            if s and s in old and s not in new:
                return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    doc = json.load(open(POOL, encoding='utf-8'))
    quiz = [json.loads(l) for l in open(QUIZ, encoding='utf-8')]
    freq = corpus_freq(doc['cards'], quiz)
    subs, held = build_subs(freq)

    print('naga-/maga- forms with an attested nag-/mag- target : %d' % len(subs))
    print('held (target attested <%dx -- probably not the prefix): %d' % (MIN_ATTEST, len(held)))
    for h in sorted(held, key=lambda x: -x['uses'])[:8]:
        print('   HELD %-16s %3d uses -> %-16s attested %d' % (h['form'], h['uses'], h['target'], h['target_uses']))
    json.dump({'subs': subs, 'held': held}, open(os.path.join(RUN, 'naga-normalisation.json'), 'w'),
              ensure_ascii=False, indent=1)
    if not subs:
        return
    rx = re.compile(r'\b(%s)\b' % '|'.join(sorted(subs, key=len, reverse=True)), re.I)

    def fix(s, counter):
        def rep(m):
            t = subs.get(m.group(0).lower())
            if not t:
                return m.group(0)
            counter[0] += 1
            return match_case(m.group(0), t)
        return rx.sub(rep, s or '')

    n_card = [0]; cards_hit = 0; skipped = 0
    for c in doc['cards']:
        f, t = c.get('fact') or {}, c.get('title') or {}
        before = n_card[0]
        nb, nt = fix(f.get('bis'), n_card), fix(t.get('bis'), n_card)
        if n_card[0] == before:
            continue
        if not spans_ok(c, nb, nt):
            n_card[0] = before; skipped += 1; continue
        if f.get('bis') is not None: f['bis'] = nb
        if t.get('bis') is not None: t['bis'] = nt
        cards_hit += 1
    n_quiz = [0]; quiz_hit = 0
    for r in quiz:
        before = n_quiz[0]
        if r.get('q'): r['q']['bis'] = fix(r['q'].get('bis'), n_quiz)
        if r.get('explanation'): r['explanation']['bis'] = fix(r['explanation'].get('bis'), n_quiz)
        for o in (r.get('options') or []):
            o['bis'] = fix(o.get('bis'), n_quiz)
        if n_quiz[0] != before:
            quiz_hit += 1

    print('\ncards: %d tokens across %d cards  (%d skipped on the emphasis guard)'
          % (n_card[0], cards_hit, skipped))
    print('quiz : %d tokens across %d items' % (n_quiz[0], quiz_hit))
    if not args.apply:
        print('\ndry run; nothing written.')
        return
    json.dump(doc, open(POOL, 'w'), ensure_ascii=False)
    open(QUIZ, 'w', encoding='utf-8').write(
        '\n'.join(json.dumps(r, ensure_ascii=False) for r in quiz) + '\n')
    print('\nWRITTEN.')


if __name__ == '__main__':
    main()
