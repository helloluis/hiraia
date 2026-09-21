#!/usr/bin/env python3
"""Apply confirmed wrong-affix repairs to the Tagalog quiz strings.

A root-level decision fires on every occurrence of that root, so this is the strictest applier
in the project. Five gates, all recomputed from the data.

THE SUBTLETY THAT MATTERS: the swap has to preserve ASPECT. Tagalog marks aspect by prefix and
by CV- reduplication, and the two families mark it differently:

    mag- family   maglangoy (infinitive)  naglangoy (completed)  naglalangoy (progressive)
    -um- family   lumangoy  (inf/completed)                      lumalangoy  (progressive)

So naglalangoy -> lumalangoy, but naglangoy -> lumangoy. Mapping every mag- form onto a single
-um- form would fix the affix and break the tense, which is a worse card than the one we
started with.

The construction: rebuild the stem with or without its CV- reduplication to match the source
form, then infix -um- after the first consonant.

    langoy, reduplicated -> lalangoy -> l + um + alangoy -> lumalangoy
    langoy, plain        -> langoy   -> l + um + angoy   -> lumangoy

GATE 5 then refuses to write any form the corpus does not already attest at least MIN_ATTEST
times. Generating a morphologically plausible word is not the same as knowing Tagalog, and
this project has been wrong about that often enough to legislate against it.

  python3 apply_affix_fixes.py [--apply]
"""
import argparse
import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
QUIZ = os.path.join(ROOT, 'rag/bank/quiz-bank.jsonl')
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
RUN = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'runs/2026-09-21-tl')
WORD = re.compile(r"[A-Za-zÀ-ÿ]+")
VOWELS = 'aeiou'
MIN_ATTEST = 20          # the replacement must be this well attested before we write it


def corpus_freq():
    f = collections.Counter()
    for line in open(QUIZ, encoding='utf-8'):
        r = json.loads(line)
        for s in ([(r.get('q') or {}).get('tl', ''), (r.get('explanation') or {}).get('tl', '')]
                  + [(o.get('tl') or '') for o in (r.get('options') or [])]):
            for w in WORD.findall(s or ''):
                f[w.lower()] += 1
    for c in json.load(open(POOL, encoding='utf-8'))['cards']:
        t = ((c.get('fact') or {}).get('tl') or '') + ' ' + ((c.get('title') or {}).get('tl') or '')
        for w in WORD.findall(t):
            f[w.lower()] += 1
    return f


def is_reduplicated(stem, root):
    """naglalangoy -> stem 'lalangoy' against root 'langoy' -> True."""
    return stem != root and stem.endswith(root)


def to_um(root, reduplicated):
    stem = (root[0] + root[1] + root) if reduplicated else root
    if len(stem) < 2 or stem[0] in VOWELS:
        return None
    return stem[0] + 'um' + stem[1:]


def plan(root, surface):
    """mag-/nag- surface form -> the aspect-matched -um- form, or None."""
    low = surface.lower()
    if not low.startswith(('mag', 'nag')):
        return None
    stem = low[3:]
    if not stem.endswith(root):
        return None
    return to_um(root, is_reduplicated(stem, root))


def match_case(src, dst):
    if src.isupper():
        return dst.upper()
    if src[:1].isupper():
        return dst[:1].upper() + dst[1:]
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    res = json.load(open(os.path.join(RUN, 'affix-triage.json'), encoding='utf-8'))
    verds = {v['root']: v for v in res['verdicts']}
    freq = corpus_freq()

    subs, held = {}, []
    for c in res['claims']:
        root = c['root']
        if c['verdict'] != 'DEFECT':                                   # GATE 1
            held.append({'root': root, 'reason': 'not a defect (%s)' % c['verdict']}); continue
        v = verds.get(root)
        if not v or v['verdict'] != 'ACCEPT':                          # GATE 2
            held.append({'root': root, 'reason': 'adversarial ' +
                         ((v or {}).get('verdict', 'UNVERIFIED'))}); continue
        for surface in (c.get('minority_forms') or _forms(root)):
            tgt = plan(root, surface)                                  # GATE 3 aspect
            if not tgt:
                held.append({'root': root, 'form': surface,
                             'reason': 'no aspect-matched -um- form'}); continue
            if freq[tgt] < MIN_ATTEST:                                 # GATE 4 attestation
                held.append({'root': root, 'form': surface, 'target': tgt,
                             'reason': 'target attested only %dx' % freq[tgt]}); continue
            subs[surface] = tgt

    print('substitutions confirmed: %d' % len(subs))
    for a, b in sorted(subs.items()):
        print('   %-18s -> %-18s (target attested %d)' % (a, b, freq[b]))
    by = collections.Counter(h['reason'].split('(')[0].strip() for h in held)
    for k, n in by.most_common():
        print('   HELD %-34s %3d' % (k, n))
    json.dump({'subs': subs, 'held': held}, open(os.path.join(RUN, 'affix-applied.json'), 'w'),
              ensure_ascii=False, indent=1)
    if not args.apply or not subs:
        print('\ndry run; nothing written.' if not args.apply else '\nnothing to apply.')
        return

    rx = re.compile(r'\b(%s)\b' % '|'.join(sorted(subs, key=len, reverse=True)), re.I)
    changed = touched = 0
    out = []
    for line in open(QUIZ, encoding='utf-8'):
        r = json.loads(line)
        before = json.loads(line)
        n = 0

        def fix(s):
            nonlocal n
            def rep(m):
                nonlocal n
                t = subs.get(m.group(0).lower())
                if not t:
                    return m.group(0)
                n += 1
                return match_case(m.group(0), t)
            return rx.sub(rep, s or '')

        if r.get('q'):
            r['q']['tl'] = fix(r['q'].get('tl'))
        if r.get('explanation'):
            r['explanation']['tl'] = fix(r['explanation'].get('tl'))
        for o in (r.get('options') or []):
            o['tl'] = fix(o.get('tl'))
        if n:                                                          # GATE 5 scope
            assert r['answer'] == before['answer']
            assert len(r['options']) == len(before['options'])
            assert [o['en'] for o in r['options']] == [o['en'] for o in before['options']]
            assert r['q']['en'] == before['q']['en']
            changed += 1
            touched += n
        out.append(json.dumps(r, ensure_ascii=False))
    open(QUIZ, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    print('\nwrote %d token replacements across %d quiz items' % (touched, changed))


def _forms(root):
    return []


if __name__ == '__main__':
    main()
