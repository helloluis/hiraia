#!/usr/bin/env python3
"""Normalise Tagalog re-spellings of science loanwords to their English form.

Luis's call, 2026-09-20: "just spell it in English. The PH curriculum is dominated with
English words in science, so there's no point re-spelling everything if the standard
textbooks are showing kids the English version anyway."

Applied corpus-wide, not only to the 75 cards that contradicted themselves -- otherwise the
other ~1,389 cards keep the Tagalog respelling and the bank stays split.

HELD BACK, deliberately: `kalamansi` and `abaka`. Those are Filipino words with anglicised
export spellings, not English science terms respelled into Filipino. The reasoning above is
about DepEd science vocabulary; applying it to Filipino nouns would be a different decision,
so it is left for a human.

EMPHASIS GUARD, as everywhere in this tool: a span not present verbatim after the edit is
silently un-bolded at render time (cards.ts:91). Here the guard covers the WHOLE tl text, not
just the lead, because these substitutions happen anywhere in the body. A card whose span
would break is HELD, and its span is reported.

  python3 normalize_spelling.py --run <dir> [--dry-run]
"""
import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
POOL = ROOT / 'rag/pipeline/cardsPool.app.json'
HOLD = {'kalamansi', 'abaka'}


def match_case(src, dst):
    """Carry the source token's capitalisation onto the replacement."""
    if src.isupper():
        return dst.upper()
    if src[:1].isupper():
        return dst[:1].upper() + dst[1:]
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', required=True)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    run = pathlib.Path(a.run)

    pairs = json.loads((run / 'enum-spelling-pairs.json').read_text(encoding='utf-8'))
    subs = [(p['tl'], p['en']) for p in pairs if p['tl'] not in HOLD]
    held_pairs = [p['tl'] for p in pairs if p['tl'] in HOLD]

    doc = json.loads(POOL.read_text(encoding='utf-8'))
    changed, held = [], []

    for c in doc['cards']:
        fact = c.get('fact') or {}
        title = c.get('title') or {}
        before_tl, before_ttl = fact.get('tl') or '', title.get('tl') or ''
        new_tl, new_ttl = before_tl, before_ttl
        used = []
        for tl_form, en_form in subs:
            pat = re.compile(r'\b' + re.escape(tl_form) + r'\b', re.I)
            if pat.search(new_tl) or pat.search(new_ttl):
                used.append((tl_form, en_form))
                new_tl = pat.sub(lambda m: match_case(m.group(0), en_form), new_tl)
                new_ttl = pat.sub(lambda m: match_case(m.group(0), en_form), new_ttl)
        if not used:
            continue
        # Emphasis guard, over the WHOLE text. Only the `tl` spans are in scope: spans are
        # matched per language against that language's own text, and this pass edits only
        # fact.tl and title.tl. Checking a `bis` span against Tagalog text -- as an earlier
        # version did -- held 115 cards for a collision that cannot happen.
        emph = c.get('emphasis') or {}
        tl_spans = list(emph.get('tl') or [])
        # A span that IS the word being renamed must be renamed with it, or it stops matching.
        new_spans = []
        for sp in tl_spans:
            out = sp
            for tl_form, en_form in used:
                out = re.compile(r'\b' + re.escape(tl_form) + r'\b', re.I).sub(
                    lambda m: match_case(m.group(0), en_form), out)
            new_spans.append(out)
        broken = [f'tl:{sp!r}' for sp, ns in zip(tl_spans, new_spans)
                  if (sp in before_tl or sp in before_ttl) and not (ns in new_tl or ns in new_ttl)]
        if broken:
            held.append({'id': c['id'], 'spans': broken, 'pairs': [p[0] for p in used]})
            continue
        if not a.dry_run:
            fact['tl'], title['tl'] = new_tl, new_ttl
            if tl_spans and new_spans != tl_spans:
                emph['tl'] = new_spans
        changed.append({'id': c['id'], 'pairs': [f'{x}->{y}' for x, y in used]})

    if not a.dry_run:
        POOL.write_text(json.dumps(doc, ensure_ascii=False), encoding='utf-8')

    rep = {'changed': len(changed), 'held': len(held), 'held_pairs_by_policy': held_pairs,
           'changed_items': changed, 'held_items': held}
    (run / 'spelling-normalisation.json').write_text(
        json.dumps(rep, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(('DRY RUN -- ' if a.dry_run else '') +
          f'normalised {len(changed)} cards, held {len(held)} on the emphasis guard')
    for h in held[:10]:
        print(f'    HELD {h["id"]}: would break {h["spans"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
