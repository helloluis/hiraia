#!/usr/bin/env python3
"""Re-apply the titles patches (card-titles-patch.json + card-cats-patch.json) to the pool.

wire-app-pool.py now runs this same missing-only backfill before reviewed language
edits. This command remains available for older pools; both entry points preserve
existing titles/categories and reapply the verified language overlay.

  python3 rag/pipeline/apply-patches.py            # titles + cats
  REPORT_ONLY=1 python3 rag/pipeline/apply-patches.py
"""
import json, os
from card_presentation_patches import apply_presentation_patches
from card_retirement import exclude_retired_cards
from content_corrections import correct_cards
from card_language_patches import apply_patches as apply_language_patches

HERE = os.path.dirname(os.path.abspath(__file__))
POOL = os.path.join(HERE, 'cardsPool.app.json')
TITLES = os.path.join(HERE, 'card-titles-patch.json')
CATS = os.path.join(HERE, 'card-cats-patch.json')
REPORT_ONLY = os.environ.get('REPORT_ONLY') == '1'

def main():
    pool = json.load(open(POOL))
    active = exclude_retired_cards(pool['cards'])
    correct_cards(active)
    cards, counts = apply_presentation_patches(active,
        titles=json.load(open(TITLES)), cats=json.load(open(CATS)))
    cards = apply_language_patches(cards)
    print(f"{'WOULD' if REPORT_ONLY else 'DONE'}: titles +{counts['titles_applied']} "
          f"(kept existing {counts['titles_kept']}) | cats +{counts['cats_applied']} "
          f"(kept {counts['cats_kept']})")
    if not REPORT_ONLY:
        pool['cards'] = cards
        json.dump(pool, open(POOL, 'w'), ensure_ascii=False)
        print(f'pool written: {POOL}')

if __name__ == '__main__':
    main()
