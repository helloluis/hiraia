#!/usr/bin/env python3
"""Round-2 gap-fill stager: rebuild shards for cards whose titles are missing or invalid.

Round 1 produced 979 shard outputs covering 19,543/19,566 todo cards, but ~7,037 present
entries failed validation (mostly the 32-char cap) and 23 cards were dropped entirely.
This script moves round-1 outputs to card-titles-checkpoint-1/, then re-stages shards
containing ONLY the failing/missing cards, with per-card counts of how many attempts
each has had (the shard name carries the round).

  python3 rag/pipeline/card-titles-round2.py
"""
import json, os, re, glob, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
POOL = os.path.join(HERE, 'cardsPool.app.json')
SHARDS = os.path.join(HERE, 'card-titles-shards')
OUT = os.path.join(HERE, 'card-titles-out')
CKPT = os.path.join(HERE, 'card-titles-checkpoint-1')
BATCH = 20
EMOJI = re.compile(r'[\U0001F300-\U0001FAFF]')


def valid(t):
    for k in ('tl', 'en', 'bis'):
        v = (t.get(k) or '').strip()
        if not v or len(v) > 32 or v != t[k] or v.endswith(('.', '?', '!')) \
           or v[0].islower() or EMOJI.search(v):
            return False
    return True


def main():
    pool = json.load(open(POOL))
    cards = pool['cards']
    todo = [c for c in cards if not (c.get('title') or {}).get('tl')]
    ok_ids = set()
    for f in glob.glob(os.path.join(CKPT, 'shard-*.json')):
        for cid, t in json.load(open(f)).items():
            if valid(t):
                ok_ids.add(cid)
    need = [c for c in todo if c['id'] not in ok_ids]
    print(f"todo {len(todo)} | valid from round 1 {len(ok_ids)} | to regenerate {len(need)}")

    os.makedirs(SHARDS, exist_ok=True); os.makedirs(OUT, exist_ok=True)
    n = 0
    for i in range(0, len(need), BATCH):
        shard = need[i:i + BATCH]
        name = f'r2-{i//BATCH:04d}'
        path = os.path.join(SHARDS, f'{name}.json')
        if os.path.exists(path):
            continue
        payload = [{'id': c['id'], 'fact_tl': c['fact']['tl'], 'fact_en': c['fact']['en']}
                   for c in shard]
        json.dump(payload, open(path, 'w'), ensure_ascii=False, indent=1)
        n += 1
    print(f"wrote {n} round-2 shards of {BATCH} -> {SHARDS}")


if __name__ == '__main__':
    main()
