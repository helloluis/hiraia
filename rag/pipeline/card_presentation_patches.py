"""The existing missing-title/category backfill, shared by both pool entry points.

These are the exact missing-only rules formerly in apply-patches.py. They run
before reviewed language edits: some original titles were added after the merged
pool was created, and language review must see those same titles on regeneration.
"""
import copy
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent


def apply_presentation_patches(cards, *, titles=None, cats=None):
    if titles is None:
        titles = json.loads((HERE / 'card-titles-patch.json').read_text())
    if cats is None:
        cats = json.loads((HERE / 'card-cats-patch.json').read_text())
    result = list(cards)
    by_id = {card['id']: index for index, card in enumerate(cards)}
    if len(by_id) != len(cards):
        raise ValueError('duplicate card ID during presentation backfill')
    counts = {'titles_applied': 0, 'titles_kept': 0, 'cats_applied': 0, 'cats_kept': 0}
    for cid, title in titles.items():
        if cid not in by_id:
            continue
        i = by_id[cid]
        if not (result[i].get('title') or {}).get('tl'):
            result[i] = copy.deepcopy(result[i])
            result[i]['title'] = {lang: title[lang] for lang in ('tl', 'en', 'bis')}
            counts['titles_applied'] += 1
        else:
            counts['titles_kept'] += 1
    for cid, values in cats.items():
        if cid not in by_id:
            continue
        i = by_id[cid]
        if not result[i].get('cats'):
            result[i] = copy.deepcopy(result[i])
            result[i]['cats'] = copy.deepcopy(values)
            counts['cats_applied'] += 1
        else:
            counts['cats_kept'] += 1
    return result, counts
