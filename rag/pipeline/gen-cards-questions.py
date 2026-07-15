#!/usr/bin/env python3
"""Build the card-feed interject-MCQ set from the trilingual quiz bank, keyed to the card
pool's source-fact ids (one MCQ per factId). Output → packages/mobile/src/data/cards-questions.json
in the CardQuestion shape {f, q, o, a, e, d}.

  python3 rag/pipeline/gen-cards-questions.py
"""
import json

POOL = 'packages/mobile/src/generated/cardsPool.generated.json'
QUIZ = 'rag/bank/quiz-bank.jsonl'
OUT = 'packages/mobile/src/data/cards-questions.json'

pool_fids = set(c['factId'] for c in json.load(open(POOL))['cards'])

seen = set()
questions = []
for l in open(QUIZ):
    l = l.strip()
    if not l:
        continue
    r = json.loads(l)
    fid = r.get('factId')
    if fid not in pool_fids or fid in seen:
        continue
    opts = r.get('options') or []
    ans = r.get('answer')
    if len(opts) < 2 or not isinstance(ans, int) or not (0 <= ans < len(opts)):
        continue
    seen.add(fid)
    questions.append({
        'f': fid,
        'q': r.get('q', {}),
        'o': opts,
        'a': ans,
        'e': r.get('explanation', {}),
        'd': r.get('difficulty', 1),
    })

with open(OUT, 'w') as f:
    json.dump({'questions': questions}, f, ensure_ascii=False)

import os
print(f'wrote {len(questions)} interject MCQs -> {OUT}  ({os.path.getsize(OUT)/1e6:.1f} MB)')
print(f'pool cards with an MCQ: {len(questions)} / {len(pool_fids)} factIds ({100*len(questions)//len(pool_fids)}%)')
