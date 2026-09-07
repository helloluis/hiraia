#!/usr/bin/env python3
"""Re-apply the titles patches (card-titles-patch.json + card-cats-patch.json) to the pool.

wire-app-pool.py regenerates the pool from cardsPool.merged.json, which predates
both patches — a regen silently loses all titles and cats unless this runs after.
This is the documented durability hazard (CARD-CATS-BACKFILL-SPEC §4.3); it
should eventually be a hook inside wire-app-pool itself.

  python3 rag/pipeline/apply-patches.py            # titles + cats
  REPORT_ONLY=1 python3 rag/pipeline/apply-patches.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
POOL = os.path.join(HERE, 'cardsPool.app.json')
TITLES = os.path.join(HERE, 'card-titles-patch.json')
CATS = os.path.join(HERE, 'card-cats-patch.json')
REPORT_ONLY = os.environ.get('REPORT_ONLY') == '1'

def main():
    pool = json.load(open(POOL))
    by_id = {c['id']: c for c in pool['cards']}

    titles = json.load(open(TITLES))
    t_applied = t_kept = 0
    for cid, t in titles.items():
        c = by_id.get(cid)
        if not c:
            continue
        if not (c.get('title') or {}).get('tl'):
            if not REPORT_ONLY:
                c['title'] = {'tl': t['tl'], 'en': t['en'], 'bis': t['bis']}
            t_applied += 1
        else:
            t_kept += 1

    cats = json.load(open(CATS))
    c_applied = c_kept = 0
    for cid, v in cats.items():
        c = by_id.get(cid)
        if not c:
            continue
        if not c.get('cats'):
            if not REPORT_ONLY:
                c['cats'] = v
            c_applied += 1
        else:
            c_kept += 1

    print(f"{'WOULD' if REPORT_ONLY else 'DONE'}: titles +{t_applied} (kept existing {t_kept}) "
          f"| cats +{c_applied} (kept {c_kept})")
    if not REPORT_ONLY:
        json.dump(pool, open(POOL, 'w'), ensure_ascii=False)
        print(f'pool written: {POOL}')

if __name__ == '__main__':
    main()
