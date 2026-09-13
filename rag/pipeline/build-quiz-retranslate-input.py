#!/usr/bin/env python3
"""Build fw-translate.py input for quiz rows whose sentence-length options are still English.

Reads the union id list from check-quiz-translation.py (default /tmp/quiz-untranslated-ids.txt)
and emits {i, quizId, factId, q, options, explanation, fact_tl, fact_bis}. i starts at
QZ_I_OFFSET (default 800000) so this lane cannot collide with earlier xlate dirs.

  python3 rag/pipeline/check-quiz-translation.py          # writes the id list (exits 1)
  python3 rag/pipeline/build-quiz-retranslate-input.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BANK = os.path.join(ROOT, 'rag', 'bank', 'quiz-bank.jsonl')
FACTS = os.path.join(ROOT, 'rag', 'bank', 'science-facts.jsonl')
IDS = os.environ.get('QZ_IDS', '/tmp/quiz-untranslated-ids.txt')
OUT_DIR = os.path.join(HERE, os.environ.get('QZ_OUT', 'quiz-retranslate'))
OFFSET = int(os.environ.get('QZ_I_OFFSET', '800000'))

os.makedirs(OUT_DIR, exist_ok=True)
want = {l.strip() for l in open(IDS) if l.strip()}
if not want:
    print(f'no ids in {IDS}', file=sys.stderr)
    sys.exit(1)

facts = {}
for line in open(FACTS, encoding='utf-8'):
    if not line.strip():
        continue
    f = json.loads(line)
    facts[f['id']] = f.get('fact') or {}

rows = []
for line in open(BANK, encoding='utf-8'):
    if not line.strip():
        continue
    r = json.loads(line)
    if r.get('id') not in want:
        continue
    ft = facts.get(r.get('factId'), {})
    rows.append({
        'quizId': r['id'],
        'factId': r.get('factId'),
        'q': (r.get('q') or {}).get('en') or '',
        'options': [o.get('en') or '' for o in (r.get('options') or [])],
        'explanation': (r.get('explanation') or {}).get('en') or '',
        'answer': r.get('answer'),
        'fact_tl': ft.get('tl') or '',
        'fact_bis': ft.get('bis') or '',
    })

missing = want - {r['quizId'] for r in rows}
if missing:
    print(f'WARN: {len(missing)} ids not in the bank (first {sorted(missing)[:5]})', file=sys.stderr)

no_anchor = 0
out_path = os.path.join(OUT_DIR, 'translate-input.jsonl')
with open(out_path, 'w', encoding='utf-8') as f:
    for n, r in enumerate(rows):
        r['i'] = OFFSET + n
        if not r['fact_tl'] or not r['fact_bis']:
            no_anchor += 1
        f.write(json.dumps(r, ensure_ascii=False) + '\n')

print(f'ids {len(want)} | rows {len(rows)} | missing-from-bank {len(missing)} | missing tl/bis anchor {no_anchor}')
if rows:
    print(f'translate index range: {rows[0]["i"]}..{rows[-1]["i"]}')
print(f'wrote {out_path}')
