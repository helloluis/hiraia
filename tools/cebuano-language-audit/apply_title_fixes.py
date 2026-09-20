#!/usr/bin/env python3
"""Apply the C5a Cebuano title repairs to the card pool, behind three mechanical gates.

Nothing here trusts the proposing agent's prose. Each gate is recomputed from the data:

  GATE 1  EMPHASIS. packages/mobile/src/data/cards.ts:91 -- a span not present verbatim is
          silently not emphasised. So for EVERY language, every span present verbatim in that
          language's old text must still be present verbatim in the new text. Checked per
          language against ITS OWN text: a `bis` span is never matched against `tl` prose.
          (These edits touch only title.bis, and no span in this tranche sits inside a bis
          title, so the gate should be a no-op -- which is exactly why it is worth running.
          A trip means the edit did something unintended.)

  GATE 2  SOURCING. The governing constraint of this audit is that Claude's Cebuano is weaker
          than its Tagalog, so the repair may not INVENT Cebuano. Every content word in the new
          title must already appear in that card's own fact_bis, terms, title_en, title_tl, or
          be an ordinary function word. This is the gate the agent was told about; here it is
          enforced rather than believed.

  GATE 3  SCOPE. Exactly one field changes -- title.bis -- and the card is otherwise byte-
          identical. Anything else is a bug in the pipeline, not a repair.

A card that trips any gate is HELD and reported, never written. The pool is re-serialised with
the same separators it is stored with, so the diff is one line rather than 2,070,923.

  python3 apply_title_fixes.py [--apply]     (default is a dry run)
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
RUN = os.path.join(HERE, 'runs/2026-09-20-scope')

TOK = re.compile(r"[A-Za-zÀ-ÿ0-9]+(?:[-'][A-Za-zÀ-ÿ0-9]+)*")

# Ordinary Cebuano/Tagalog grammar words plus units and digits. Deliberately SMALL: anything
# outside it must be attested on the card itself.
FUNCTION = {
    'ang', 'sa', 'ug', 'nga', 'og', 'mga', 'ka', 'ni', 'kang', 'si', 'ang', 'na', 'ay',
    'walay', 'wala', 'adunay', 'aduna', 'may', 'kung', 'kon', 'para', 'gikan', 'aron',
    'unsa', 'unsay', 'giunsa', 'pila', 'ngano', 'nganong', 'asa', 'kinsa', 'kanus-a',
    'dili', 'ba', 'kay', 'isip', 'batok', 'sama', 'usa', 'duha', 'tulo', 'upat', 'lima',
    'matag', 'tanan', 'uban', 'laing', 'lain', 'bag-o', 'bag-ong', 'kini', 'niini',
    'ilang', 'imong', 'atong', 'iyang', 'nila', 'mo', 'ni', 'mas', 'labing', 'pinaka',
    'km', 'cm', 'mm', 'kg', 'g', 'ml', 'l', 'c', 'f', 'm', 'bilyon', 'milyon', 'libo',
}


def words(s):
    return [w.lower() for w in TOK.findall(s or '')]


def sourced_vocabulary(card):
    """Everything this card itself attests, in any field."""
    v = set()
    for s in (card.get('fact') or {}).values():
        v.update(words(s))
    for s in (card.get('title') or {}).values():
        v.update(words(s))
    for t in (card.get('terms') or []):
        v.update(words(t))
    v.update(words(card.get('topic') or ''))
    return v


def gate_sourcing(card, new_title):
    """Content words that appear nowhere on the card. Empty list = pass."""
    attested = sourced_vocabulary(card)
    bad = []
    for w in words(new_title):
        if w in FUNCTION or w in attested or w.isdigit():
            continue
        # allow a sourced word plus a Cebuano linker/plural (humok -> humoka, bukog -> bukoga)
        if any(w.startswith(a) and len(w) - len(a) <= 2 for a in attested if len(a) >= 4):
            continue
        if any(a.startswith(w) and len(a) - len(w) <= 2 for a in attested if len(w) >= 4):
            continue
        bad.append(w)
    return bad


def gate_emphasis(card, old_title, new_title):
    """Spans checked PER LANGUAGE against that language's own text."""
    broken = []
    emph = card.get('emphasis') or {}
    texts_old, texts_new = {}, {}
    for lang in ('en', 'tl', 'bis'):
        body = (card.get('fact') or {}).get(lang, '') or ''
        t_old = (card.get('title') or {}).get(lang, '') or ''
        t_new = new_title if lang == 'bis' else t_old
        texts_old[lang] = body + '\n' + t_old
        texts_new[lang] = body + '\n' + t_new
    for lang, spans in emph.items():
        for s in (spans or []):
            if not s:
                continue
            if s in texts_old.get(lang, '') and s not in texts_new.get(lang, ''):
                broken.append((lang, s))
    return broken


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    res = json.load(open(os.path.join(RUN, 'c5a-proposals.json'), encoding='utf-8'))
    props = {p['id']: p for p in res['proposals']}
    verds = {v['id']: v for v in res['verdicts']}

    doc = json.load(open(POOL, encoding='utf-8'))
    cards = {c['id']: c for c in doc['cards']}

    applied, held = [], []
    for cid, p in sorted(props.items()):
        rec = {'id': cid, 'old': (cards[cid].get('title') or {}).get('bis', ''),
               'new': p.get('new_title_bis', '')}
        v = verds.get(cid)
        if p.get('verdict') != 'REWRITE':
            rec['reason'] = 'proposer HOLD'; held.append(rec); continue
        if not v or v.get('verdict') != 'ACCEPT':
            rec['reason'] = 'adversarial REJECT: ' + (v or {}).get('reason', 'no verdict')
            held.append(rec); continue
        if not rec['new'].strip() or rec['new'].strip() == rec['old'].strip():
            rec['reason'] = 'empty or unchanged'; held.append(rec); continue
        bad = gate_sourcing(cards[cid], rec['new'])
        if bad:
            rec['reason'] = 'GATE 2 sourcing: unattested word(s) %s' % bad
            held.append(rec); continue
        br = gate_emphasis(cards[cid], rec['old'], rec['new'])
        if br:
            rec['reason'] = 'GATE 1 emphasis: span(s) lost %s' % br
            held.append(rec); continue
        applied.append(rec)

    print('proposals %d   -> APPLY %d   HOLD %d' % (len(props), len(applied), len(held)))
    by = {}
    for h in held:
        by.setdefault(h['reason'].split(':')[0], []).append(h['id'])
    for k, v in sorted(by.items(), key=lambda x: -len(x[1])):
        print('   HELD %-28s %3d' % (k, len(v)))

    json.dump({'applied': applied, 'held': held},
              open(os.path.join(RUN, 'c5a-applied.json'), 'w'), ensure_ascii=False, indent=1)

    if not args.apply:
        print('\ndry run; nothing written. re-run with --apply')
        return

    # GATE 3: only title.bis may differ.
    before = json.dumps(doc, ensure_ascii=False)
    for rec in applied:
        cards[rec['id']]['title']['bis'] = rec['new']
    after_cards = {c['id']: c for c in doc['cards']}
    changed = []
    for cid in props:
        a, b = cards[cid], after_cards[cid]
        assert a is b
    # recompute: a card is legal iff every key except title.bis is untouched
    orig = {c['id']: c for c in json.loads(before)['cards']}
    for rec in applied:
        o, n = orig[rec['id']], cards[rec['id']]
        o2 = json.loads(json.dumps(o, ensure_ascii=False)); n2 = json.loads(json.dumps(n, ensure_ascii=False))
        o2.get('title', {}).pop('bis', None); n2.get('title', {}).pop('bis', None)
        if o2 != n2:
            sys.exit('GATE 3 FAILED on %s: a field other than title.bis changed' % rec['id'])
        changed.append(rec['id'])

    with open(POOL, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False)
    print('\nwrote %d title.bis repairs to %s' % (len(changed), POOL))


if __name__ == '__main__':
    main()
