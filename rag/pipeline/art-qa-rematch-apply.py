#!/usr/bin/env python3
"""Apply the art-QA rematch swaps to the pool — slug swaps only, nothing else.

Reads art-qa/rematch.jsonl (from art-qa-rematch.py), applies every row with
changed=true: cardsPool.app.json card['slug'] = new_slug. Idempotent: rows whose
old_slug no longer matches the pool (already applied) are skipped and counted.

  python3 rag/pipeline/art-qa-rematch-apply.py          # apply
  REPORT_ONLY=1 python3 rag/pipeline/art-qa-rematch-apply.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
POOL = os.path.join(HERE, 'cardsPool.app.json')
REMATCH = os.path.join(HERE, 'art-qa', 'rematch.jsonl')
REPORT_ONLY = os.environ.get('REPORT_ONLY') == '1'

def main():
    pool = json.load(open(POOL))
    by_id = {c['id']: c for c in pool['cards']}
    applied = skipped = missing = 0
    for l in open(REMATCH):
        if not l.strip():
            continue
        r = json.loads(l)
        if not r['changed']:
            continue
        c = by_id.get(r['card_id'])
        if not c:
            missing += 1
            continue
        if c.get('slug') != r['old_slug']:
            skipped += 1  # already applied or pool moved on
            continue
        if not REPORT_ONLY:
            c['slug'] = r['new_slug']
        applied += 1
    print(f"{'WOULD apply' if REPORT_ONLY else 'applied'} {applied} swaps "
          f"(skipped {skipped} already-applied, {missing} missing cards)")
    if not REPORT_ONLY:
        json.dump(pool, open(POOL, 'w'), ensure_ascii=False)
        print(f"pool written: {POOL}")

if __name__ == '__main__':
    main()
