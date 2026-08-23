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
ED = os.path.join(os.path.dirname(ROOT), 'hiraia/rag/pipeline/editorial.json')
ART = os.path.join(HERE, 'original-art-chosen.json')
IMAGEMAP = os.path.join(ROOT, 'packages/mobile/src/generated/imageMap.ts')
OUT = os.path.join(ROOT, 'packages/mobile/src/generated/cardsPool.generated.json')

# Fields the app's CardFact contract reads, plus the DepEd provenance worth carrying: it is
# what makes a card's claim checkable later, and it costs a few bytes a row.
CARD_ID = re.compile(r'^(?:ffct|dcard)-\d+$')

KEEP = ('id', 'factId', 'domain', 'topic', 'terms', 'fact', 'slug', 'title', 'cats',
        'grade', 'quarter', 'competency', 'source_module', 'source')
SEP = '\n\n'


def main():
    pool = json.load(open(SRC))
    bundled = set(re.findall(r'"([^"]+)":\s*require', open(IMAGEMAP).read()))
    print(f'  bundled slugs in IMAGE_MAP: {len(bundled):,}')

    # The editorial pass is applied HERE rather than as a later step over the finished file,
    # so that re-running this script cannot silently drop it: emphasis and the poster flag are
    # not in KEEP and would not survive a rebuild otherwise.
    ed = json.load(open(ED)) if os.path.exists(ED) else {}
    print(f'  editorial records: {len(ed):,}')

    # Re-matched illustrations for the ORIGINAL cards. They never went through the two-stage
    # matcher and carried whatever the old token-overlap pass gave them — a fruit DOVE card
    # illustrated with a fruit BAT, a milkfish card with a plate of rellenong bangus. Applied
    # HERE, like the editorial pass, so a rebuild of the pool cannot silently drop it.
    # A null means the model found nothing that shows the card's subject; that card falls
    # back to type, which is a better answer than a picture of the wrong thing.
    art = json.load(open(ART)) if os.path.exists(ART) else {}
    print(f'  re-matched illustrations: {len(art):,}')

    out, stat = [], collections.Counter()
    for c in pool['cards']:
        if c['id'] in art:
            new_ref = art[c['id']]
            if new_ref != c.get('slug'):
                stat['art replaced' if new_ref else 'art dropped'] += 1
            c['slug'] = new_ref or ''
            c.pop('image', None) if not new_ref else None
        e = ed.get(c['id'])
        if e:
            con = e.get('concise')
            # A rewrite must not change a card's SHAPE: a two-part card that came back as one
            # block would silently fuse its question into its answer.
            if con and con.get('tl') and con.get('en') and (SEP in c['fact']['tl']) == (SEP in con['tl']):
                for l in ('tl', 'en', 'bis'):
                    if con.get(l):
                        c['fact'][l] = con[l]
                stat['tightened'] += 1
            # Emphasis spans are exact substrings chosen against the ORIGINAL wording, so a
            # rewritten card can leave one stale. Re-check against the text that ships; a span
            # that no longer appears is dropped rather than fuzzy-matched onto the wrong run.
            emph = {}
            for l in ('tl', 'en', 'bis'):
                keep = [x for x in ((e.get('emphasis') or {}).get(l) or []) if x and x in (c['fact'].get(l) or '')]
                if keep:
                    emph[l] = keep
            if emph:
                c['emphasis'] = emph
                stat['emphasis'] += 1
            if e.get('poster'):
                c['poster'] = True
                stat['poster'] += 1
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
        # An illustration GENERATED for this card is filed under the card's own id, because
        # nothing else names it — it was drawn from the card's own one-sentence description
        # and belongs to it alone. So a card with no slug adopts its own id the moment that
        # file lands in cards-png. This is what makes collecting a batch a two-step job (drop
        # the files in, re-run this) rather than an edit anywhere.
        if not slug and c['id'] in bundled:
            slug = c['id']

        card = {k: c[k] for k in KEEP if k in c}
        for extra in ('emphasis', 'poster'):
            if extra in c:
                card[extra] = c[extra]
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
    print(f'  tightened / emphasis / poster: {stat["tightened"]:,} / {stat["emphasis"]:,} / {stat["poster"]:,}')
    missing = [k for k in ('id', 'factId', 'domain', 'topic', 'fact', 'slug')
               if any(k not in c for c in out)]
    print(f'  contract check: {"MISSING " + str(missing) if missing else "all required fields present"}')
    print(f'  file size: {os.path.getsize(OUT)/1e6:.1f} MB')


if __name__ == '__main__':
    main()
