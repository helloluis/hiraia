#!/usr/bin/env python3
"""Apply C5c's word-level title repairs: swap one Cebuano word for another across many titles.

C5c decides at WORD level -- "kulob is not a boiling word, the corpus uses mobukal" -- and one
decision can touch 25 cards at once. That leverage cuts both ways, so this applier is stricter
than the card-level ones: a single wrong word here corrupts a whole topic area.

  GATE 0  CONFIRMED. Only words the triage called DEFECT *and* the adversarial check ACCEPTED.
  GATE 1  EMPHASIS. Per language against its own text; a span that stops matching verbatim
          silently loses the card's bolding.
  GATE 2  ATTESTATION. The replacement must appear in >= MIN_ATTEST Cebuano BODIES. A repair
          that introduces an unattested word is not a repair -- it is a second guess.
  GATE 3  SUBSTITUTION SAFETY. The swap is whole-word only, case-preserving, and must actually
          change the title. If the word does not appear as a whole word in that title, the card
          is skipped rather than force-matched on a substring.
  GATE 4  SCOPE. Exactly one field changes, title.bis.
  GATE 5  RELEVANCE. A word decision fires on EVERY card using the word, which is wrong when
          the word is genuinely ambiguous. Each card must independently show the replacement
          belongs -- some corpus card whose Cebuano body uses it must share an English
          content word with this card.

  python3 apply_word_fixes.py [--apply]     (default is a dry run)
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
MIN_ATTEST = 5      # bodies that must already use the replacement; higher than the card-level
                    # gate because one decision propagates to every card using the word


def body_freq(cards):
    f = collections.Counter()
    for c in cards:
        for w in set(TOK.findall((c.get('fact') or {}).get('bis') or '')):
            f[w.lower()] += 1
    return f


def match_case(src, dst):
    """Titles are Capitalised; keep the shape of the word being replaced."""
    if src.isupper():
        return dst.upper()
    if src[:1].isupper():
        return dst[:1].upper() + dst[1:]
    return dst


def swap(title, word, replacement):
    rx = re.compile(r'\b%s\b' % re.escape(word), re.I)
    if not rx.search(title):
        return None
    return rx.sub(lambda m: match_case(m.group(0), replacement), title)


EN_STOP = set((
    'the a an of and or in on to for with is are was were be by from at as it its this that '
    'these those how why what when where which who does do did can could will would not no yes '
    'than then so if into over under more most less least your you our we they them their make '
    'makes made use uses used get gets got one two three also very much many some other others '
    'like just because about there here them then have has had but all each even only same'
).split())
MIN_LIFT = 3.0          # a term must be >=3x likelier on this word's cards than corpus-wide
MIN_SCORE = 8.0         # and the card's overlapping terms must sum to this much lift
RELEVANCE_TOPK = 30


def en_keys(card):
    t = ((card.get('title') or {}).get('en') or '') + ' ' + ((card.get('fact') or {}).get('en') or '')
    return {w.lower() for w in TOK.findall(t) if len(w) > 3 and w.lower() not in EN_STOP}


def build_relevance(cards):
    """Cebuano word -> {English term: lift} for the terms most distinctive of its cards.

    Lift is how much likelier a term is on cards whose BODY uses this Cebuano word than on
    cards generally. Keeping the lift (rather than just the term) is what lets one very
    distinctive term carry a card on its own -- see gate_relevance.
    """
    doc_en, use, joint = collections.Counter(), collections.Counter(), collections.defaultdict(collections.Counter)
    n = 0
    for c in cards:
        bis = {w.lower() for w in TOK.findall((c.get('fact') or {}).get('bis') or '')}
        if not bis:
            continue
        n += 1
        keys = en_keys(c)
        for k in keys:
            doc_en[k] += 1
        for w in bis:
            use[w] += 1
            for k in keys:
                joint[w][k] += 1
    rel = {}
    for w, cnt in joint.items():
        if use[w] < 3:
            continue
        scored = []
        for k, j in cnt.items():
            if j < 2 or doc_en[k] < 2:
                continue
            lift = (j / use[w]) / (doc_en[k] / n)
            if lift >= MIN_LIFT:
                scored.append((lift, k))
        scored.sort(reverse=True)
        rel[w] = {k: lift for lift, k in scored[:RELEVANCE_TOPK]}
    return rel


def gate_relevance(card, replacement, rel):
    """GATE 5 -- is the replacement DISTINCTIVELY associated with this card's subject?

    A word decision fires on every card using the word, which is wrong whenever the word is
    ambiguous: `kulob` heads 25 boiling cards AND "Kulob nga Tudlo sa Tubig" = why fingers
    WRINKLE in water, where swapping in `mobukal` would invent a defect.

    Counting overlapping terms was the obvious test and it is wrong in both directions: two
    weak terms pass while one decisive term fails, so "Jellyfish Life Cycle" got refused for
    `dikya` on the grounds that it only says jellyfish once. Summing LIFT fixes both -- a lone
    "jellyfish" (~50x) clears the bar by itself, while a lone "water" (~3x) does not.
    """
    keys = en_keys(card)
    if not keys:
        return False
    lifts = rel.get(replacement.lower(), {})
    return sum(lifts.get(k, 0.0) for k in keys) >= MIN_SCORE


def gate_emphasis(card, new_title):
    broken = []
    for lang, spans in (card.get('emphasis') or {}).items():
        body = (card.get('fact') or {}).get(lang, '') or ''
        t_old = (card.get('title') or {}).get(lang, '') or ''
        old_txt = body + '\n' + t_old
        new_txt = body + '\n' + (new_title if lang == 'bis' else t_old)
        for s in (spans or []):
            if s and s in old_txt and s not in new_txt:
                broken.append((lang, s))
    return broken


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    res = json.load(open(os.path.join(RUN, 'c5c-triage.json'), encoding='utf-8'))
    verds = {v['word']: v for v in res['verdicts']}
    unattested = {h['word']: h for h in
                  json.load(open(os.path.join(RUN, 'title-unattested.json'), encoding='utf-8'))}

    doc = json.load(open(POOL, encoding='utf-8'))
    cards = {c['id']: c for c in doc['cards']}
    freq = body_freq(doc['cards'])
    rel = build_relevance(doc['cards'])

    applied, held, skipped = [], [], []
    for claim in res['claims']:
        w, rep = claim['word'], (claim.get('replacement') or '').strip()
        rec = {'word': w, 'replacement': rep, 'verdict': claim['verdict']}
        if claim['verdict'] != 'DEFECT':
            rec['reason'] = 'not a defect (%s)' % claim['verdict']; held.append(rec); continue
        v = verds.get(w)
        if not v:
            rec['reason'] = 'UNVERIFIED: no adversarial verdict'; held.append(rec); continue
        if v['verdict'] != 'ACCEPT':
            rec['reason'] = 'adversarial REJECT: ' + v.get('reason', ''); held.append(rec); continue
        if not rep or ' ' in rep:
            rec['reason'] = 'GATE 2: replacement missing or not a single word (%r)' % rep
            held.append(rec); continue
        if freq[rep.lower()] < MIN_ATTEST:
            rec['reason'] = ('GATE 2 attestation: replacement %r has only %d Cebuano bodies'
                             % (rep, freq[rep.lower()]))
            held.append(rec); continue

        ids = claim.get('affected_ids') or unattested.get(w, {}).get('ids', [])
        edits = []
        for cid in ids:
            c = cards.get(cid)
            if not c:
                continue
            old = (c.get('title') or {}).get('bis', '') or ''
            new = swap(old, w, rep)
            if not new or new == old:                                   # GATE 3
                skipped.append({'id': cid, 'word': w, 'title': old}); continue
            br = gate_emphasis(c, new)                                   # GATE 1
            if br:
                skipped.append({'id': cid, 'word': w, 'title': old, 'emphasis': br}); continue
            if not gate_relevance(c, rep, rel):                           # GATE 5
                skipped.append({'id': cid, 'word': w, 'title': old,
                                'title_en': (c.get('title') or {}).get('en', ''),
                                'reason': 'GATE 5 relevance'}); continue
            edits.append({'id': cid, 'old': old, 'new': new})
        rec['edits'] = edits
        rec['evidence'] = claim.get('evidence', '')
        applied.append(rec)

    n_cards = sum(len(r['edits']) for r in applied)
    print('words %d -> DEFECT confirmed %d, touching %d cards (%d card-level skips)'
          % (len(res['claims']), len(applied), n_cards, len(skipped)))
    for r in sorted(applied, key=lambda x: -len(x['edits'])):
        print('   %-16s -> %-16s %3d cards' % (r['word'], r['replacement'], len(r['edits'])))
    by = collections.Counter(h['reason'].split(':')[0].split('(')[0].strip() for h in held)
    for k, n in by.most_common():
        print('   HELD %-34s %3d words' % (k, n))

    json.dump({'applied': applied, 'held': held, 'skipped': skipped},
              open(os.path.join(RUN, 'c5c-applied.json'), 'w'), ensure_ascii=False, indent=1)

    if not args.apply:
        print('\ndry run; nothing written. re-run with --apply')
        return

    orig = json.loads(json.dumps(doc, ensure_ascii=False))
    ocards = {c['id']: c for c in orig['cards']}
    for r in applied:
        for e in r['edits']:
            cards[e['id']]['title']['bis'] = e['new']
    for r in applied:                                                    # GATE 4
        for e in r['edits']:
            a = json.loads(json.dumps(ocards[e['id']], ensure_ascii=False))
            b = json.loads(json.dumps(cards[e['id']], ensure_ascii=False))
            a.get('title', {}).pop('bis', None); b.get('title', {}).pop('bis', None)
            if a != b:
                sys.exit('GATE 4 FAILED on %s: a field other than title.bis changed' % e['id'])
    with open(POOL, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False)
    print('\nwrote %d title.bis word repairs to %s' % (n_cards, POOL))


if __name__ == '__main__':
    main()
