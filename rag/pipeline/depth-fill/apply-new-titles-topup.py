#!/opt/homebrew/bin/python3
"""Fold generated titles + cats into the pool for the DEPTH-FILL cards ONLY (BRIEF §8.5).

  /opt/homebrew/bin/python3 rag/pipeline/depth-fill/apply-new-titles.py --dry-run
  /opt/homebrew/bin/python3 rag/pipeline/depth-fill/apply-new-titles.py

Why not assemble-card-titles.py: it applies EVERY shard row it finds. The FW_MISSING gap run in this worktree saw only
part of the historical shard set (the primary checkout's card-titles/ is untracked and incomplete), so it re-titled
~26.6k cards that already carry polished titles and backfilled cats; folding those rows in would overwrite them.
This script restricts the fold to the ids in out/wire-ids.txt + the poster ids in out/wire-report.json, applies the
same per-language fallback and ladder-cat validation as assemble-card-titles.py, verifies every other card is
unchanged, and prints the §8.5 validation (non-empty tl/en/bis, 1–2 ladder cats, ≤32 chars, title != topic).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = HERE / 'out-topup'
POOL = ROOT / 'rag/pipeline/cardsPool.app.json'
MERGED = ROOT / 'rag/pipeline/cardsPool.merged.json'
# Accumulated rows for the NEW cards only (out/new-titles.jsonl, written by collect-new-titles below) plus the targeted
# run's own shards. The global card-titles/titles-gap*.jsonl namespace is NOT read: every FW_MISSING run rewrites gap0..N,
# so rows from an earlier run are clobbered by the next one — reading it directly lost 159 new-card rows on 2026-09-08.
SHARDS = [str(OUT / 'new-titles.jsonl'), str(OUT / 'new-title-shards' / 'titles-*.jsonl')]
TAX = ROOT / 'rag/pipeline/card-taxonomy.json'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    new_ids = {l.strip() for l in (OUT / 'wire-ids.txt').read_text().splitlines() if l.strip()}
    new_ids |= set(json.loads((OUT / 'wire-report.json').read_text()).get('posters', []))
    valid_cats = {o['id'] for o in json.loads(TAX.read_text())['leaves']}

    rows, dupes, total = {}, 0, 0
    for f in sorted(p for pat in SHARDS for p in glob.glob(pat)):
        for line in open(f):
            if not line.strip():
                continue
            r = json.loads(line)
            total += 1
            if r['id'] not in new_ids:
                continue
            if r['id'] in rows:
                dupes += 1
            rows[r['id']] = r
    print(f'gap shard rows {total} → for new cards {len(rows)} (dupes {dupes}); new cards {len(new_ids)}')

    pool = json.loads(POOL.read_text())
    cards = pool['cards']
    before = {c['id']: json.dumps(c, sort_keys=True, ensure_ascii=False) for c in cards if c['id'] not in new_ids}

    applied, no_title, bad_cat, uncategorised, over32, eq_topic, missing_row = 0, 0, 0, 0, [], [], []
    for c in cards:
        if c['id'] not in new_ids:
            continue
        r = rows.get(c['id'])
        if not r:
            missing_row.append(c['id'])
            continue
        en = (r.get('title_en') or '').strip()
        if not en:
            no_title += 1
            continue
        title = {
            'en': en,
            'tl': (r.get('title_tl') or en).strip(),
            'bis': (r.get('title_bis') or r.get('title_tl') or en).strip(),
        }
        cats = [x for x in (r.get('cats') or []) if x in valid_cats][:2]
        bad_cat += len([x for x in (r.get('cats') or []) if x not in valid_cats])
        if not cats:
            uncategorised += 1
        if max(len(v) for v in title.values()) > 32:
            over32.append(c['id'])
        if en.strip().lower() == (c.get('topic') or '').strip().lower():
            eq_topic.append(c['id'])
        if not a.dry_run:
            c['title'] = title
            if cats:
                c['cats'] = cats
        applied += 1

    print(f'applied {applied} | no title {no_title} | missing shard row {len(missing_row)} | invalid cats dropped {bad_cat} | '
          f'uncategorised {uncategorised} | >32 chars {len(over32)} | title == topic {len(eq_topic)}')
    if over32[:8]:
        print('  >32:', over32[:8])
    if missing_row[:8]:
        print('  missing:', missing_row[:8])
    if a.dry_run:
        return
    after = {c['id']: json.dumps(c, sort_keys=True, ensure_ascii=False) for c in cards if c['id'] not in new_ids}
    assert after == before, 'a pre-existing card changed — aborting'
    tmp = POOL.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(pool, ensure_ascii=False))
    os.replace(tmp, POOL)
    # merged pool carries no title/cats (8-key shape) — nothing to fold there.
    have = sum(1 for c in cards if c['id'] in new_ids and c.get('title') and c.get('cats'))
    print(f'pool written; new cards with title AND cats: {have}/{len(new_ids)}; pre-existing cards verified unchanged')


if __name__ == '__main__':
    main()
