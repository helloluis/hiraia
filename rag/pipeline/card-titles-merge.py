#!/usr/bin/env python3
"""Validate and merge batch title outputs into rag/pipeline/card-titles-patch.json.

Accepts shard answer files in rag/pipeline/card-titles-out/shard-NNNN.json — a JSON object
{card_id: {"tl": ..., "en": ..., "bis": ...}} — runs the SPEC's validation (trimmed, <=32 chars,
Title Case, no trailing punctuation/emoji, not a topic copy, identical-across-3 ratio) and merges
valid rows into the patch. Invalid rows are reported and left out.

  python3 rag/pipeline/card-titles-merge.py            # validate + merge, print report
  STRICT=1 ...                                        # exit 1 if anything failed
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, 'card-titles-out')
PATCH = os.path.join(HERE, 'card-titles-patch.json')
POOL = os.path.join(HERE, 'cardsPool.app.json')
STRICT = os.environ.get('STRICT') == '1'

EMOJI = re.compile(r'[\U0001F300-\U0001FAFF]')


def load_pool_index():
    pool = json.load(open(POOL))
    return {c['id']: c for c in pool['cards']}, pool


def validate(cid, t, pool):
    """Spec section 5 checks. Returns list of problems (empty = ok)."""
    problems = []
    if cid not in pool:
        return [f'unknown id {cid}']
    if (pool[cid].get('title') or {}).get('tl'):
        return [f'{cid} already titled']
    for k in ('tl', 'en', 'bis'):
        v = (t.get(k) or '').strip()
        if not v:
            problems.append(f'{k} empty')
        elif len(v) > 32:
            problems.append(f'{k} {len(v)} chars > 32')
        elif v != t[k]:
            problems.append(f'{k} untrimmed')
        elif v.endswith(('.', '?', '!')):
            problems.append(f'{k} ends in punctuation')
        elif v[0].islower():
            problems.append(f'{k} not Title Case')
        elif v.isupper() and len(v) > 5:
            problems.append(f'{k} all caps')
        elif EMOJI.search(v):
            problems.append(f'{k} emoji')
    if t.get('tl') == pool[cid]['topic']:
        problems.append('tl copied the topic')
    return problems


def main():
    pool, _ = load_pool_index()
    patch = json.load(open(PATCH)) if os.path.exists(PATCH) else {}

    files = sorted(f for f in os.listdir(OUT_DIR) if f.startswith('shard-') and f.endswith('.json')) \
        if os.path.isdir(OUT_DIR) else []
    n_ok, n_bad, bad_rows = 0, 0, []
    for fn in files:
        shard = json.load(open(os.path.join(OUT_DIR, fn)))
        for cid, t in shard.items():
            problems = validate(cid, t, pool)
            if problems:
                n_bad += 1
                bad_rows.append((cid, problems, t))
            else:
                if cid not in patch:
                    n_ok += 1
                patch[cid] = t

    total = len(patch)
    same3 = sum(1 for t in patch.values() if t.get('tl') == t.get('en') == t.get('bis'))
    print(f"merged {n_ok} new | {n_bad} invalid | patch total {total} / 19566 "
          f"| identical-across-3 {same3} ({100*same3/max(total,1):.0f}%)")
    for cid, probs, t in bad_rows[:40]:
        print('  ', cid, probs, t)

    if n_ok or n_bad:
        json.dump(patch, open(PATCH, 'w'), ensure_ascii=False, indent=1)
        print(f"wrote {PATCH}")
    if STRICT and (n_bad or total != 19566):
        sys.exit(1)


if __name__ == '__main__':
    main()
