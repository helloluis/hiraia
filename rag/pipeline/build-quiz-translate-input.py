#!/usr/bin/env python3
"""Turn a gen dir of kept-*.jsonl (fw-genverify.py output) into the two files the rest of
the quiz pipeline expects — the step that was done ad hoc for the June batches:

  <lane>/kept.jsonl             one EN MCQ per factId (concat + dedup, +_i translate index)
  <lane>/translate-input.jsonl  fw-translate.py input: {i, factId, q, options, explanation,
                                fact_tl, fact_bis} with the fact's verified tl/bis text as
                                the terminology anchor (science-facts.jsonl)

Skips factIds that already have a question in rag/bank/quiz-bank.jsonl. Translate indices
start at QZ_I_OFFSET (default 300000; June used 0.. and 200000..) so the lane can never
collide with another xlate dir if they are ever merged. With QZ_FACTS (the lane's fact
list, .json array or .jsonl) i = OFFSET + the fact's position in that list, so the
i -> factId mapping is STABLE across rebuilds (safe to rebuild while gen is still running
and re-run the resumable translator).

  QZ_FACTS=rag/pipeline/quiz-lane-facts.json \
      python3 rag/pipeline/build-quiz-translate-input.py rag/pipeline/quiz-lane/gen rag/pipeline/quiz-lane
"""
import glob, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN_DIR = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, 'quiz-lane', 'gen')
LANE_DIR = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(HERE, 'quiz-lane')
OFFSET = int(os.environ.get('QZ_I_OFFSET', '300000'))
FACTS_ORDER = os.environ.get('QZ_FACTS')  # optional: lane fact list defining stable positions
BANK = os.path.join(HERE, '..', 'bank', 'quiz-bank.jsonl')
FACTS = os.path.join(HERE, '..', 'bank', 'science-facts.jsonl')

in_bank = {json.loads(l)['factId'] for l in open(BANK) if l.strip()}
kept, dup, skipped, partial = {}, 0, 0, 0
for fn in sorted(glob.glob(os.path.join(GEN_DIR, 'kept-*.jsonl'))):
    for l in open(fn):
        if not l.strip():
            continue
        try:
            q = json.loads(l)
        except ValueError:  # a line still being appended by a running fw-genverify.py; next rebuild picks it up
            partial += 1; continue
        if q['factId'] in kept:
            dup += 1; continue
        if q['factId'] in in_bank:
            skipped += 1; continue
        kept[q['factId']] = q

facts = {}
for l in open(FACTS):
    if l.strip():
        f = json.loads(l)
        if f['id'] in kept:
            facts[f['id']] = f.get('fact', {})

rows = list(kept.values())
if FACTS_ORDER:
    with open(FACTS_ORDER) as f:
        order = json.load(f) if FACTS_ORDER.endswith('.json') else [json.loads(l) for l in f if l.strip()]
    pos = {o['id']: n for n, o in enumerate(order)}
    # the generator copies factId from the fact; a mangled/hallucinated id has no fact behind it -> drop
    # (fw-genverify.py records the real fact as not-generated, so it is retried on the next resume)
    unknown = [fid for fid in kept if fid not in pos]
    if unknown:
        print(f'dropping {len(unknown)} kept rows whose factId is not in the lane fact list')
        rows = [q for q in rows if q['factId'] in pos]
    rows.sort(key=lambda q: pos[q['factId']])
    for q in rows:
        q['_i'] = OFFSET + pos[q['factId']]
else:
    for n, q in enumerate(rows):
        q['_i'] = OFFSET + n
with open(os.path.join(LANE_DIR, 'kept.jsonl'), 'w') as f:
    for q in rows:
        f.write(json.dumps(q, ensure_ascii=False) + '\n')
no_anchor = 0
with open(os.path.join(LANE_DIR, 'translate-input.jsonl'), 'w') as f:
    for q in rows:
        ft = facts.get(q['factId'], {})
        if not ft.get('tl') or not ft.get('bis'): no_anchor += 1
        f.write(json.dumps({'i': q['_i'], 'factId': q['factId'], 'q': q['q'], 'options': q['options'],
                            'explanation': q['explanation'], 'fact_tl': ft.get('tl', ''), 'fact_bis': ft.get('bis', '')},
                           ensure_ascii=False) + '\n')
print(f'kept files: {len(glob.glob(os.path.join(GEN_DIR, "kept-*.jsonl")))} | MCQs: {len(rows)} '
      f'(dup factIds dropped {dup}, already-in-bank skipped {skipped}, missing tl/bis anchor {no_anchor}, partial lines skipped {partial})')
print(f'translate index range: {rows[0]["_i"]}..{rows[-1]["_i"]}' + (' (stable, position-based)' if FACTS_ORDER else ' (enumerated)') if rows else 'no rows')
print(f'wrote {os.path.join(LANE_DIR, "kept.jsonl")} and {os.path.join(LANE_DIR, "translate-input.jsonl")}')
