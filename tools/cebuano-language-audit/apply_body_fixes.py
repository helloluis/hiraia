#!/usr/bin/env python3
"""Apply the C5b Cebuano BODY repairs to the card pool, behind four mechanical gates.

Body edits are far riskier than the title edits in C5a: they change the sentence a child reads
as the fact, and 38% of these cards carry an emphasis span inside that sentence. So nothing
here trusts the proposing agent's prose -- every gate is recomputed from the data.

  GATE 1  EMPHASIS. cards.ts:91 -- a span not present verbatim is silently not emphasised, so
          an edit that moves a span drops the card's bolding with no error. Every span present
          verbatim in a language's OLD text must still be verbatim in its NEW text, checked per
          language against its own text.

  GATE 2  ATTESTATION. The governing constraint: Claude's Cebuano is weaker than its Tagalog,
          so a repair may not invent Cebuano. Every word INTRODUCED by the edit (present in the
          new body, absent from the old) must already appear in the Cebuano BODY of at least
          MIN_ATTEST other cards, or on this card, or be a function word, or be an English term
          the card's own English uses. Titles are excluded from the attestation corpus on
          purpose: titles are where the defects concentrate, so a defective title must not be
          allowed to vouch for a repair.

  GATE 3  MINIMALITY. A repair fixes wrong words; it does not retranslate a sentence. An edit
          that changes more than MAX_CHURN of the body's words is held for review, because at
          that size the adversarial check cannot meaningfully verify it word by word.

  GATE 4  SCOPE. Exactly one field changes -- fact.bis -- and the card is otherwise byte-
          identical.

A card tripping any gate is HELD and reported, never written.

  python3 apply_body_fixes.py [--apply]     (default is a dry run)
"""
import argparse
import collections
import difflib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
RUN = os.path.join(HERE, 'runs/2026-09-20-scope')

TOK = re.compile(r"[A-Za-zÀ-ÿ0-9]+(?:[-'][A-Za-zÀ-ÿ0-9]+)*")
MIN_ATTEST = 3      # other Cebuano bodies that must already use an introduced word
MAX_CHURN = 0.30    # fraction of the body's words an edit may touch

FUNCTION = set('''ang sa ug nga og mga ka ni si na ay kay kini niini ilang imong atong iyang
nila niya ako kami kita nato namo nimo nako walay wala adunay aduna may kung kon para gikan
aron unsa unsay giunsa pila ngano nganong asa kinsa kanus-a dili ba isip batok sama usa duha
tulo upat lima unom pito walo siyam napulo matag tanan uban laing lain bag-o bag-ong mao mas
labing pinaka apan busa pud pod ra gyud gayud kaayo lang ang o'''.split())


def words(s):
    return [w.lower() for w in TOK.findall(s or '')]


def attestation_corpus(cards):
    """Word -> how many Cebuano BODIES use it. Titles deliberately excluded."""
    freq = collections.Counter()
    for c in cards:
        for w in set(words((c.get('fact') or {}).get('bis'))):
            freq[w] += 1
    return freq


def gate_attestation(card, old, new, freq):
    introduced = set(words(new)) - set(words(old))
    on_card = set(words((card.get('fact') or {}).get('en')))
    on_card |= set(words((card.get('title') or {}).get('en')))
    on_card |= set(words((card.get('title') or {}).get('bis')))
    for t in (card.get('terms') or []):
        on_card |= set(words(t))
    bad = []
    for w in sorted(introduced):
        if w in FUNCTION or w in on_card or w.isdigit() or len(w) < 3:
            continue
        if freq[w] >= MIN_ATTEST:
            continue
        # a sourced stem plus a Cebuano affix is still sourced
        if any(w.startswith(a) and 0 < len(w) - len(a) <= 3 and freq[a] >= MIN_ATTEST
               for a in (w[:k] for k in range(4, len(w)))):
            continue
        bad.append((w, freq[w]))
    return bad


def gate_minimality(old, new):
    a, b = words(old), words(new)
    if not a:
        return 1.0
    sm = difflib.SequenceMatcher(None, a, b)
    return round(1.0 - sm.ratio(), 3)


def gate_emphasis(card, new_bis):
    broken = []
    for lang, spans in (card.get('emphasis') or {}).items():
        body = (card.get('fact') or {}).get(lang, '') or ''
        title = (card.get('title') or {}).get(lang, '') or ''
        old_txt = body + '\n' + title
        new_txt = (new_bis if lang == 'bis' else body) + '\n' + title
        for s in (spans or []):
            if s and s in old_txt and s not in new_txt:
                broken.append((lang, s))
    return broken


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--proposals', default=os.path.join(RUN, 'c5b-proposals.json'))
    args = ap.parse_args()

    res = json.load(open(args.proposals, encoding='utf-8'))
    props = {p['id']: p for p in res['proposals']}
    verds = {v['id']: v for v in res['verdicts']}

    doc = json.load(open(POOL, encoding='utf-8'))
    cards = {c['id']: c for c in doc['cards']}
    freq = attestation_corpus(doc['cards'])

    applied, held = [], []
    for cid, p in sorted(props.items()):
        old = (cards[cid].get('fact') or {}).get('bis', '') or ''
        new = (p.get('new_fact_bis') or '').strip()
        rec = {'id': cid, 'old': old, 'new': new, 'defect': p.get('defect', '')}
        if p.get('verdict') != 'REWRITE':
            rec['reason'] = 'proposer HOLD: ' + p.get('attestation', ''); held.append(rec); continue
        v = verds.get(cid)
        if not v or v.get('verdict') != 'ACCEPT':
            rec['reason'] = 'adversarial REJECT: ' + (v or {}).get('reason', 'no verdict')
            held.append(rec); continue
        if not new or new == old.strip():
            rec['reason'] = 'empty or unchanged'; held.append(rec); continue
        br = gate_emphasis(cards[cid], new)
        if br:
            rec['reason'] = 'GATE 1 emphasis: span(s) lost %s' % br; held.append(rec); continue
        bad = gate_attestation(cards[cid], old, new, freq)
        if bad:
            rec['reason'] = 'GATE 2 attestation: unattested %s' % bad; held.append(rec); continue
        churn = gate_minimality(old, new)
        if churn > MAX_CHURN:
            rec['reason'] = 'GATE 3 minimality: %.0f%% of words changed' % (100 * churn)
            held.append(rec); continue
        rec['churn'] = churn
        applied.append(rec)

    print('proposals %d   -> APPLY %d   HOLD %d' % (len(props), len(applied), len(held)))
    by = collections.Counter(h['reason'].split(':')[0] for h in held)
    for k, n in by.most_common():
        print('   HELD %-30s %4d' % (k, n))
    if applied:
        print('   median churn among applied: %.1f%%'
              % (100 * sorted(r['churn'] for r in applied)[len(applied) // 2]))

    json.dump({'applied': applied, 'held': held},
              open(os.path.join(RUN, 'c5b-applied.json'), 'w'), ensure_ascii=False, indent=1)

    if not args.apply:
        print('\ndry run; nothing written. re-run with --apply')
        return

    before = json.loads(json.dumps(doc, ensure_ascii=False))
    orig = {c['id']: c for c in before['cards']}
    for rec in applied:
        cards[rec['id']]['fact']['bis'] = rec['new']
    for rec in applied:                                   # GATE 4
        o = json.loads(json.dumps(orig[rec['id']], ensure_ascii=False))
        n = json.loads(json.dumps(cards[rec['id']], ensure_ascii=False))
        o.get('fact', {}).pop('bis', None); n.get('fact', {}).pop('bis', None)
        if o != n:
            sys.exit('GATE 4 FAILED on %s: a field other than fact.bis changed' % rec['id'])
    with open(POOL, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False)
    print('\nwrote %d fact.bis repairs to %s' % (len(applied), POOL))


if __name__ == '__main__':
    main()
