#!/usr/bin/env python3
"""Wire the art-QA new art into the pool — final step of art remediation.

1. For the 2,853 cards WITH extracted art: card['slug'] = qa-<card_id>.
2. For the 39 cards with NO new art (validation-time declines): REMOVE the art —
   card['slug'] = '' so the card renders as a poster (the deck's designed
   no-picture printing). Their old slugs were judged wrong_image by the audit,
   so keeping them was never an option. Three of those old slugs are shared with
   other cards; only the declined card's assignment is cleared (the other users
   of that slug were not flagged).

  python3 rag/pipeline/art-qa-newart-wire.py
  REPORT_ONLY=1 python3 rag/pipeline/art-qa-newart-wire.py
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
POOL = os.path.join(HERE, 'cardsPool.app.json')
PROMPTS = os.path.join(HERE, 'art-qa', 'newart-prompts.jsonl')
PNG = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'packages/images/cards-png')
REPORT_ONLY = os.environ.get('REPORT_ONLY') == '1'

def main():
    pool = json.load(open(POOL))
    by_id = {c['id']: c for c in pool['cards']}
    rows = [json.loads(l) for l in open(PROMPTS) if l.strip()]

    swapped = cleared = missing_card = 0
    for r in rows:
        c = by_id.get(r['card_id'])
        if not c:
            missing_card += 1
            continue
        if os.path.exists(os.path.join(PNG, f"{r['new_slug']}.png")):
            if c.get('slug') != r['new_slug']:
                if not REPORT_ONLY:
                    c['slug'] = r['new_slug']
                swapped += 1
        else:
            if c.get('slug'):  # clear only if it still points at something
                if not REPORT_ONLY:
                    c['slug'] = ''
                cleared += 1
    print(f"{'WOULD' if REPORT_ONLY else 'DONE'}: swapped {swapped} to qa- slugs, "
          f"cleared art on {cleared} declined cards, {missing_card} missing cards")
    if not REPORT_ONLY:
        json.dump(pool, open(POOL, 'w'), ensure_ascii=False)
        print(f'pool written: {POOL}')

if __name__ == '__main__':
    main()
