#!/usr/bin/env python3
"""Build per-competency grounding statements for Tala teaching packs (read-only on the reference checkout).

For each Tala Science competency, collect the statements Hiraia already teaches for it, through the same links the
art catalog uses (Hiraia code -> curated lesson units and curriculum tags -> cards):

  * `deped-module` statements: cards written from DepEd self-learning modules (card.source == 'deped'), with the
    module's Drive id. Official DepEd material, paraphrased into a Hiraia card.
  * `fact-bank` statements: Hiraia fact-bank items with their source labels (NRC/AAAS codes, PAGASA, PHIVOLCS, ...).

These are context for the generator and the critic. They are model-written and model-reviewed Hiraia content, not
primary sources; the pack cites primary sources from data/references.json.
"""
from __future__ import annotations

import argparse
import collections
import json
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG = HERE.parent
CATALOG = PKG / 'data/art/competency-candidates.json'
OUT = PKG / 'data/grounding/competency-statements.json'


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--reference-root', default='/home/b11/code/hiraia')
    ap.add_argument('--per-competency', type=int, default=18)
    ap.add_argument('--out', default=str(OUT))
    args = ap.parse_args()
    ref = Path(args.reference_root)
    catalog = json.loads(CATALOG.read_text())
    cards = {c['id']: c for c in json.loads((ref / 'rag/pipeline/cardsPool.app.json').read_text())['cards']}
    tags = json.loads((ref / 'packages/mobile/src/generated/curriculumTags.generated.json').read_text())
    by_code = collections.defaultdict(list)
    for cid, row in tags.items():
        primary, _g, _q, conf, _cells, codes = row
        for code in set(codes) | {primary}:
            by_code[code].append((cid, (1.5 if code == primary else 1.0) + float(conf or 0)))
    curated = collections.defaultdict(dict)
    for lf in sorted((ref / 'packages/mobile/src/generated').glob('grade*Lessons.generated.json')):
        for lesson in json.loads(lf.read_text())['lessons']:
            core = set(lesson.get('coreCardIds') or [])
            for unit in lesson.get('units') or []:
                for cid in unit.get('cardIds') or []:
                    curated[unit['competency']][cid] = 3.0 if cid in core else 2.0
    db = sqlite3.connect(f'file:{ref}/packages/mobile/assets/data/cards.db?mode=ro', uri=True)
    facts = {
        r[0]: {'text': r[1], 'source': r[2], 'reviewed': bool(r[3]), 'grades': r[4]}
        for r in db.execute('select id, en, source, reviewed, grades from fact')
    }
    out = {}
    for comp_id, entry in catalog['competencies'].items():
        code = entry['hiraiaCode']
        scored = collections.defaultdict(float)
        for cid, w in curated.get(code, {}).items():
            scored[cid] += w
        for cid, w in by_code.get(code, []):
            scored[cid] += w
        seen_text = set()
        statements = []
        for cid, s in sorted(scored.items(), key=lambda kv: (-kv[1], kv[0])):
            card = cards.get(cid)
            if not card:
                continue
            text = ((card.get('fact') or {}).get('en') or '').strip()
            tl = ((card.get('fact') or {}).get('tl') or '').strip()
            if not text or text.lower() in seen_text:
                continue
            seen_text.add(text.lower())
            if card.get('source') == 'deped':
                statements.append(
                    {
                        'id': cid,
                        'kind': 'deped-module',
                        'text': text[:600],
                        'tl': tl[:600] or None,
                        'source': f"DepEd self-learning module (Drive id {card.get('source_module') or card.get('drive_id') or 'unrecorded'}), paraphrased in a Hiraia card",
                    }
                )
            else:
                f = facts.get(card.get('factId') or '')
                statements.append(
                    {
                        'id': card.get('factId') or cid,
                        'kind': 'fact-bank',
                        'text': text[:600],
                        'tl': tl[:600] or None,
                        'source': (f or {}).get('source') or 'Hiraia fact bank',
                        'humanReviewed': bool((f or {}).get('reviewed')),
                    }
                )
            if len(statements) >= args.per_competency:
                break
        out[comp_id] = {'hiraiaCode': code, 'statements': statements}
    doc = {
        'version': 1,
        'note': 'Statements Hiraia already teaches per competency (model-written, model-reviewed). Context only; '
        'packs cite primary sources from data/references.json.',
        'referenceCommit': catalog['referenceCommit'],
        'competencies': out,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
    sizes = collections.Counter(min(len(v['statements']), 18) // 6 for v in out.values())
    empty = [k for k, v in out.items() if not v['statements']]
    print(f'wrote {args.out}: {len(out)} competencies; size buckets {dict(sizes)}; empty {len(empty)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
