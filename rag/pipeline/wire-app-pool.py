#!/usr/bin/env python3
"""Turn the merged bank into the pool the app imports.

The merged bank records an illustration as {kind, ref} because two libraries feed it: the
named clip-art slugs that IMAGE_MAP already bundles, and the factoid engravings keyed by
factoid id. The app speaks one word for this — `slug` — and resolves it through IMAGE_MAP, so
this flattens the two into that single field.

An illustration is PREFERRED, NOT REQUIRED. Cards whose picture is not bundled keep their ref
in `slug` anyway anyway: resolveImage returns null today and CardPage renders a typographic
card, and the moment those images are added to IMAGE_MAP the same cards light up with no
change here. Cards with no picture at all get an empty slug, which cards.ts is careful never
to treat as a repeated illustration.

  python3 rag/pipeline/wire-app-pool.py
  -> packages/mobile/src/generated/cardsPool.generated.json
"""
import json, os, re, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(HERE, 'cardsPool.merged.json')
IMAGEMAP = os.path.join(ROOT, 'packages/mobile/src/generated/imageMap.ts')
OUT = os.path.join(ROOT, 'packages/mobile/src/generated/cardsPool.generated.json')

# Fields the app's CardFact contract reads, plus the DepEd provenance worth carrying: it is
# what makes a card's claim checkable later, and it costs a few bytes a row.
CARD_ID = re.compile(r'^(?:ffct|dcard)-\d+$')

KEEP = ('id', 'factId', 'domain', 'topic', 'terms', 'fact', 'slug', 'title', 'cats',
        'grade', 'quarter', 'competency', 'source_module', 'source')


def main():
    pool = json.load(open(SRC))
    bundled = set(re.findall(r'"([^"]+)":\s*require', open(IMAGEMAP).read()))
    print(f'  bundled slugs in IMAGE_MAP: {len(bundled):,}')

    out, stat = [], collections.Counter()
    for c in pool['cards']:
        slug = c.get('slug') or ''
        img = c.get('image')
        if not slug and isinstance(img, dict) and img.get('ref'):
            slug = img['ref']
        # A NAMED clip-art slug that has no file anywhere is a dead reference — the
        # re-ranker chose from the QC list (4,388 slugs), which is slightly wider than what
        # assets-png actually bundles (4,228). Clear those so the card is honestly
        # typographic. Card ids (ffct-/dcard-) are NOT cleared even when unbundled: their art
        # exists and is queued, and keeping the ref is what lets it light up on the next
        # image-map run with no edit here.
        if slug and slug not in bundled and not CARD_ID.match(slug):
            slug = ''
        card = {k: c[k] for k in KEEP if k in c}
        card['slug'] = slug
        if not card.get('terms'):
            card['terms'] = []
        out.append(card)
        stat['illustrated' if slug in bundled else ('typographic' if not slug
                                                    else 'awaiting bundling')] += 1

    json.dump({'cards': out, 'taxonomy': pool.get('taxonomy') or []},
              open(OUT, 'w'), ensure_ascii=False)

    src = collections.Counter(c.get('source', 'original') for c in out)
    print(f'\n{len(out):,} cards written to {os.path.relpath(OUT, ROOT)}')
    print(f'  by origin : {dict(src)}')
    print(f'  illustrated now      : {stat["illustrated"]:,}')
    print(f'  typographic (no art) : {stat["typographic"]:,}')
    print(f'  art exists, unbundled: {stat["awaiting bundling"]:,}')
    print(f'  taxonomy leaves      : {len(pool.get("taxonomy") or []):,}')
    missing = [k for k in ('id', 'factId', 'domain', 'topic', 'fact', 'slug')
               if any(k not in c for c in out)]
    print(f'  contract check: {"MISSING " + str(missing) if missing else "all required fields present"}')
    print(f'  file size: {os.path.getsize(OUT)/1e6:.1f} MB')


if __name__ == '__main__':
    main()
