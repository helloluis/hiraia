#!/usr/bin/env python3
"""Stage the card-titles job (CARD-TITLES-SPEC.md): emit per-batch shards of the untitled cards,
resume-aware. The untitled worklist is fixed (cards lacking title.tl); shards are the payload the
title writer consumes — id, topic, fact.tl, fact.en. Nothing else ships to the writer.

  python3 rag/pipeline/card-titles-prep.py            # write shards for all remaining cards
  TITLES_BATCH=20 python3 rag/pipeline/card-titles-prep.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
POOL = os.path.join(HERE, 'cardsPool.app.json')
OUT_DIR = os.path.join(HERE, 'card-titles-shards')
BATCH = int(os.environ.get('TITLES_BATCH', '20'))
PATCH = os.path.join(HERE, 'card-titles-patch.json')


def main():
    pool = json.load(open(POOL))
    cards = pool['cards']
    patch = json.load(open(PATCH)) if os.path.exists(PATCH) else {}
    todo = [c for c in cards if not (c.get('title') or {}).get('tl') and c['id'] not in patch]
    print(f"cards {len(cards)} | patch {len(patch)} | remaining {len(todo)}", file=sys.stderr)

    os.makedirs(OUT_DIR, exist_ok=True)
    n = 0
    for i in range(0, len(todo), BATCH):
        shard = todo[i:i + BATCH]
        first, last = shard[0]['id'], shard[-1]['id']
        path = os.path.join(OUT_DIR, f'shard-{i//BATCH:04d}.json')
        if os.path.exists(path):
            continue
        payload = [{'id': c['id'], 'topic': c.get('topic') or '',
                    'fact_tl': c['fact']['tl'], 'fact_en': c['fact']['en']} for c in shard]
        json.dump(payload, open(path, 'w'), ensure_ascii=False, indent=1)
        n += 1
    print(f"wrote {n} shards of {BATCH} to {OUT_DIR}", file=sys.stderr)


if __name__ == '__main__':
    main()
