#!/usr/bin/env python3
"""Propose repairs for the 20-character title truncations, in all three languages.

The generator bug is already fixed (fw-gen-*-titles.py `_fit`), but that only stops NEW titles
being severed. This repairs the ones already in the pool. It is the cheapest repair in the
whole audit because the answer is always present: a title was cut mid-word, and the whole word
is still sitting in the same card's English, body or terms.

Two repairs are possible: RESTORE the missing letters, or TRIM the severed word away. I
expected this to be a product decision, because restoring pushes every title past TITLE_MAX.
Measuring it settled the question instead:

    restored titles land at 21-23 characters
    36.5% of the 147,468 titles already in the pool are longer than 20 characters
    9.2% are longer than 27, the width the generator's own comment says the band fits
    ZERO of the restores reach 27

So a 21-character title is unremarkable in this corpus, and TITLE_MAX = 20 was the defect --
not the titles. RESTORE is simply correct here; TRIM would drop the subject noun, which the
generator's own prompt forbids ("It MUST NAME THE SUBJECT").

Still dry-run by default: this touches English and Tagalog titles as well as Cebuano, which is
wider than the audit that found it, so the en/tl half wants a human to say go.

  python3 repair_truncations.py [--apply]
"""
import argparse
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
RUN = os.path.join(HERE, 'runs/2026-09-20-scope')
TOK = re.compile(r"[A-Za-zÀ-ÿ]+(?:[-'][A-Za-zÀ-ÿ]+)*")


def match_case(src, dst):
    if src.isupper():
        return dst.upper()
    if src[:1].isupper():
        return dst[:1].upper() + dst[1:]
    return dst


def gate_emphasis(card, lang, new_title):
    """A span that stops matching verbatim silently loses the card's bolding."""
    broken = []
    for l, spans in (card.get('emphasis') or {}).items():
        body = (card.get('fact') or {}).get(l, '') or ''
        t_old = (card.get('title') or {}).get(l, '') or ''
        old_txt = body + '\n' + t_old
        new_txt = body + '\n' + (new_title if l == lang else t_old)
        for s in (spans or []):
            if s and s in old_txt and s not in new_txt:
                broken.append((l, s))
    return broken


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--lang', help='restrict to one language (en|tl|bis)')
    args = ap.parse_args()

    doc = json.load(open(POOL, encoding='utf-8'))
    cards = {c['id']: c for c in doc['cards']}
    rows = json.load(open(os.path.join(RUN, 'truncation-20char.json'), encoding='utf-8'))

    proposed, held = [], []
    for r in rows:
        c = cards.get(r['id'])
        if not c:
            held.append({**r, 'reason': 'card not in pool'}); continue
        lang, old = r['lang'], (c.get('title') or {}).get(r['lang'], '') or ''
        if args.lang and lang != args.lang:
            continue
        if old.strip() != r['title'].strip():
            held.append({**r, 'reason': 'title changed since the scan'}); continue
        # the severed token is always the LAST one; restore it from the full word on the card
        toks = old.split()
        full = match_case(toks[-1], r['full_word'])
        new = ' '.join(toks[:-1] + [full])
        if new == old:
            held.append({**r, 'reason': 'no change'}); continue
        br = gate_emphasis(c, lang, new)
        if br:
            held.append({**r, 'reason': 'emphasis span lost %s' % br}); continue
        proposed.append({'id': r['id'], 'lang': lang, 'old': old, 'new': new,
                         'old_len': len(old), 'new_len': len(new)})

    by = collections.Counter(p['lang'] for p in proposed)
    over = [p for p in proposed if p['new_len'] > 20]
    print('proposed %d restores (en %d, tl %d, bis %d); %d held'
          % (len(proposed), by['en'], by['tl'], by['bis'], len(held)))
    print('of those, %d would exceed 20 characters (median new length %d)'
          % (len(over), sorted(p['new_len'] for p in proposed)[len(proposed) // 2] if proposed else 0))
    for p in proposed[:15]:
        print('   %-12s %-4s %-24r -> %-26r %d->%d' % (p['id'], p['lang'], p['old'], p['new'],
                                                       p['old_len'], p['new_len']))
    for h in held[:10]:
        print('   HELD %-12s %s' % (h['id'], h['reason']))

    json.dump({'proposed': proposed, 'held': held},
              open(os.path.join(RUN, 'truncation-repairs.json'), 'w'), ensure_ascii=False, indent=1)

    if not args.apply:
        print('\ndry run; nothing written. Pass --apply, optionally with --lang bis.')
        return

    orig = json.loads(json.dumps(doc, ensure_ascii=False))
    ocards = {c['id']: c for c in orig['cards']}
    for p in proposed:
        cards[p['id']]['title'][p['lang']] = p['new']
    # A card can be truncated in more than one language (ffct-38221 is cut in both en and tl),
    # so the scope check has to ignore EVERY language it edited on that card at once. Checking
    # one language at a time reports the sibling edit as an out-of-scope change.
    edited = collections.defaultdict(set)
    for p in proposed:
        edited[p['id']].add(p['lang'])
    for cid, langs in edited.items():
        a = json.loads(json.dumps(ocards[cid], ensure_ascii=False))
        b = json.loads(json.dumps(cards[cid], ensure_ascii=False))
        for l in langs:
            a.get('title', {}).pop(l, None); b.get('title', {}).pop(l, None)
        if a != b:
            sys.exit('SCOPE FAILED on %s: a field other than title.%s changed'
                     % (cid, '/'.join(sorted(langs))))
    with open(POOL, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False)
    print('\nwrote %d title restores to %s' % (len(proposed), POOL))


if __name__ == '__main__':
    main()
