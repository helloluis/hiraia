#!/opt/homebrew/bin/python3
"""Wire the depth-fill factoids into the shipping card pool — APPEND ONLY (BRIEF §8.1–8.3).

  /opt/homebrew/bin/python3 rag/pipeline/depth-fill/wire-pool.py --dry-run
  /opt/homebrew/bin/python3 rag/pipeline/depth-fill/wire-pool.py

Why a dedicated script: `gen-cards-pool.py` rebuilds the pool from scratch and drops the 9,889 dcards; `wire-app-pool.py`
rebuilds cardsPool.app.json from cardsPool.merged.json and would erase the 2,853 art-QA `qa-<id>` slugs that live ONLY in
the app pool (b90d8e739). So this appends the new cards to BOTH pools in each pool's own shape and touches nothing else.

For every depth-fill factoid id (out/image-batches.json) whose engraving was fetched to rag/pipeline/imagegen/webp/<id>.webp:
  1. copy the webp → packages/images/factoid-webp/<id>.webp (skip if present)
  2. build the card record exactly like gen-cards-pool.py: display text = Q hook + body per language (format 'qa'),
     terms from the bank row (science-facts.jsonl by factId), slug = own id, source 'original'; skip retired rows and
     any page over BUDGET displayed words (listed, never shipped)
  3. append to rag/pipeline/cardsPool.app.json (app shape: + source; title/cats arrive from assemble-card-titles.py)
     and rag/pipeline/cardsPool.merged.json (8-key shape); refuse id collisions; verify every pre-existing card object
     is unchanged after the write
  4. write out/wire-report.json and out/wire-ids.txt (one id per line, for to-card-png.mjs --only)
Then (caller): to-card-png.mjs --in factoid-webp --only out/wire-ids.txt → gen-image-map.mjs → gen-curriculum-tags.mjs.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = HERE / 'out-topup'
BATCHES = OUT / 'image-batches.json'
FACTOIDS = ROOT / 'rag/bank/factoids.jsonl'
FACTS = ROOT / 'rag/bank/science-facts.jsonl'
WEBP_STAGED = ROOT / 'rag/pipeline/imagegen/webp'
WEBP_BUNDLE = ROOT / 'packages/images/factoid-webp'
APP = ROOT / 'rag/pipeline/cardsPool.app.json'
MERGED = ROOT / 'rag/pipeline/cardsPool.merged.json'
BUDGET = 48                       # gen-cards-pool.py: displayed words per language (Q hook + body)


def display(fo, lang):
    body = (fo['text'].get(lang) or '').strip()
    q = (fo.get('q') or {}).get(lang, '') if fo.get('format') == 'qa' else ''
    q = (q or '').strip()
    return f'{q}\n\n{body}' if q and body else body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    new_ids = [i for b in json.loads(BATCHES.read_text())['batches'] for i in b['ids']]
    new_set = set(new_ids)
    terms_by_fact = {}
    for line in FACTS.read_text().splitlines():
        if line.strip():
            r = json.loads(line)
            terms_by_fact[r['id']] = [t.lower() for t in r.get('terms', [])]
    rows = {}
    for line in FACTOIDS.read_text().splitlines():
        if line.strip():
            fo = json.loads(line)
            if fo['id'] in new_set:
                rows[fo['id']] = fo
    missing_row = [i for i in new_ids if i not in rows]

    # Declined by image moderation (out/image-declined.jsonl): ship as a POSTER card (slug '') — the deck's designed
    # no-picture printing, the same convention art-qa-newart-wire.py used for its 39 declines — rather than lose the fact.
    declined_path = OUT / 'image-declined.jsonl'
    declined = {json.loads(l)['id'] for l in declined_path.read_text().splitlines() if l.strip()} if declined_path.exists() else set()

    cards, no_webp, over, retired, posters = [], [], [], [], []
    for i in new_ids:
        fo = rows.get(i)
        if not fo:
            continue
        if fo.get('retired'):
            retired.append(i)
            continue
        src = WEBP_STAGED / f'{i}.webp'
        slug = i
        if not src.exists():
            if i in declined:
                slug = ''
                posters.append(i)
            else:
                no_webp.append(i)
                continue
        fact = {lang: display(fo, lang) for lang in ('en', 'tl', 'bis')}
        if not (fact['tl'] or fact['en']):
            no_webp.append(i)
            continue
        if max(len(t.split()) for t in fact.values()) > BUDGET:
            over.append(i)
            continue
        cards.append({
            'id': i,
            'factId': fo['factId'],
            'domain': fo.get('domain') or '',
            'topic': fo.get('topic', ''),
            'terms': terms_by_fact.get(fo['factId'], []),
            'fact': fact,
            'slug': slug,
            'source': 'original',
        })

    print(f'depth-fill ids {len(new_ids)} | factoid rows {len(rows)} (missing {len(missing_row)}) | cards {len(cards)} '
          f'(illustrated {len(cards) - len(posters)}, poster/declined {len(posters)}) | not fetched {len(no_webp)} | '
          f'over budget {len(over)} | retired {len(retired)}')
    if over:
        print('  over budget (not shipped):', ' '.join(over[:20]), '…' if len(over) > 20 else '')

    app = json.loads(APP.read_text())
    merged = json.loads(MERGED.read_text())
    app_ids = {c['id'] for c in app['cards']}
    merged_ids = {c['id'] for c in merged['cards']}
    collide = [c['id'] for c in cards if c['id'] in app_ids or c['id'] in merged_ids]
    if collide:
        raise SystemExit(f'refusing: {len(collide)} ids already in a pool (e.g. {collide[:5]}) — append-only')
    if a.dry_run:
        print(f'dry run: would append {len(cards)} cards to app ({len(app["cards"])}) and merged ({len(merged["cards"])})')
        return

    copied = 0
    WEBP_BUNDLE.mkdir(exist_ok=True)
    for c in cards:
        if not c['slug']:
            continue                                   # poster card: no engraving to copy
        dst = WEBP_BUNDLE / f'{c["id"]}.webp'
        if not dst.exists():
            shutil.copy2(WEBP_STAGED / f'{c["id"]}.webp', dst)
            copied += 1

    before_app = [json.dumps(c, sort_keys=True, ensure_ascii=False) for c in app['cards']]
    before_merged = [json.dumps(c, sort_keys=True, ensure_ascii=False) for c in merged['cards']]
    app['cards'].extend(cards)
    merged['cards'].extend({k: c[k] for k in ('id', 'factId', 'domain', 'topic', 'terms', 'fact', 'slug', 'source')} for c in cards)
    for path, pool, before in ((APP, app, before_app), (MERGED, merged, before_merged)):
        tmp = path.with_suffix('.json.tmp')
        tmp.write_text(json.dumps(pool, ensure_ascii=False))
        check = json.loads(tmp.read_text())
        after = [json.dumps(c, sort_keys=True, ensure_ascii=False) for c in check['cards'][:len(before)]]
        assert after == before, f'{path.name}: a pre-existing card changed — aborting before replace'
        assert len(check['cards']) == len(before) + len(cards)
        os.replace(tmp, path)
    (OUT / 'wire-ids.txt').write_text(''.join(c['id'] + '\n' for c in cards if c['slug']))   # illustrated only (to-card-png)
    report = dict(appended=len(cards), illustrated=len(cards) - len(posters), posters=posters, webp_copied=copied,
                  no_webp=no_webp, over_budget=over, retired=retired,
                  missing_factoid_row=missing_row, app_cards=len(app['cards']), merged_cards=len(merged['cards']),
                  first_id=cards[0]['id'] if cards else None, last_id=cards[-1]['id'] if cards else None)
    (OUT / 'wire-report.json').write_text(json.dumps(report, indent=1))
    print(f'appended {len(cards)} cards → app {len(app["cards"])}, merged {len(merged["cards"])}; webp copied {copied}; '
          f'pre-existing cards verified unchanged; ids → out/wire-ids.txt; report → out/wire-report.json')


if __name__ == '__main__':
    main()
