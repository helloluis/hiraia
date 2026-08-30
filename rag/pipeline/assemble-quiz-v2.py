#!/usr/bin/env python3
"""Assemble the v2 quiz: fold fw-quiz-v2.py's shards into a bank and the app's question file.

  v2 records win wherever they exist. Where they do not, the LEGACY 4-option question is
  kept rather than dropped — a fact with a wordy question still teaches something, whereas a
  fact with no question just makes the feed recycle its neighbours, which is the complaint
  that started this work. Every record carries `v` (2 or 1) so a later sweep can find the
  leftovers without re-deriving which is which.

Writes:
  rag/bank/quiz-bank-v2.jsonl                        the merged bank (all facts)
  packages/mobile/src/data/cards-questions.json      the app's {f,q,o,a,e,d}, pool facts only

`o` is a Tri[] of any length in the app's CardQuestion type and QuestionPage shuffles
`question.o.length`, so 3- and 4-option items coexist without a code change.

  python3 rag/pipeline/assemble-quiz-v2.py
"""
import json, os, glob, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SHARDS = os.path.join(HERE, 'quiz-v2')
LEGACY = os.path.join(ROOT, 'rag/bank/quiz-bank.jsonl')
FACTS = os.path.join(ROOT, 'rag/bank/science-facts.jsonl')
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
BANK_OUT = os.path.join(ROOT, 'rag/bank/quiz-bank-v2.jsonl')
APP_OUT = os.path.join(ROOT, 'packages/mobile/src/data/cards-questions.json')


def tri(d):
    return {k: (d or {}).get(k, '') for k in ('en', 'tl', 'bis')}


def main():
    # ---- v2 output, deduped. Shards are content-addressed, so a re-run or a coverage sweep
    # can legitimately produce a second record for the same fact; first one wins.
    v2, torn = {}, 0
    for fn in sorted(glob.glob(os.path.join(SHARDS, 'batch-*.jsonl'))):
        for l in open(fn):
            l = l.strip()
            if not l:
                continue
            try:
                r = json.loads(l)
            except json.JSONDecodeError:
                # A shard half-written when the machine died looks complete (non-zero size)
                # but its last line is truncated. Skip the torn record rather than aborting
                # the whole assembly — the fact simply falls to the coverage sweep.
                torn += 1
                continue
            if r.get('factId') and r['factId'] not in v2:
                v2[r['factId']] = r
    print(f'v2 questions: {len(v2):,}' + (f'  ({torn} torn records skipped)' if torn else ''))

    legacy = {}
    for l in open(LEGACY):
        l = l.strip()
        if l:
            r = json.loads(l)
            if r.get('factId'):
                legacy.setdefault(r['factId'], r)
    print(f'legacy questions: {len(legacy):,}')

    meta = {}
    for l in open(FACTS):
        l = l.strip()
        if l:
            r = json.loads(l)
            meta[r['id']] = r

    # ---- merged bank
    bank, counts = [], collections.Counter()
    for fid in sorted(set(v2) | set(legacy)):
        m = meta.get(fid, {})
        if fid in v2:
            r = v2[fid]
            counts['v2'] += 1
            bank.append({
                'factId': fid, 'v': 2, 'type': r.get('type_used'),
                'domain': m.get('domain') or legacy.get(fid, {}).get('domain'),
                'topic': m.get('topic') or legacy.get(fid, {}).get('topic'),
                'grades': m.get('grades') or legacy.get(fid, {}).get('grades'),
                'quizTopic': legacy.get(fid, {}).get('quizTopic'),
                'q': tri(r.get('q')), 'options': [tri(o) for o in r.get('options', [])],
                'answer': r.get('answer', 0), 'explanation': tri(r.get('explanation')),
                'difficulty': r.get('difficulty', 1),
            })
        else:
            r = legacy[fid]
            counts['legacy'] += 1
            bank.append({**r, 'v': 1})

    with open(BANK_OUT, 'w') as fh:
        for r in bank:
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    print(f'\nwrote {BANK_OUT.split("/")[-1]}: {len(bank):,} '
          f'(v2 {counts["v2"]:,} / legacy {counts["legacy"]:,})')

    # ---- the app's file: pool facts only, one question each
    pool_f = {c['factId'] for c in json.load(open(POOL))['cards']}
    by = {r['factId']: r for r in bank}
    out, opt_hist, ver = [], collections.Counter(), collections.Counter()
    for fid in sorted(pool_f):
        r = by.get(fid)
        if not r or not r.get('options'):
            continue
        out.append({'f': fid, 'q': tri(r['q']), 'o': [tri(o) for o in r['options']],
                    'a': r.get('answer', 0), 'e': tri(r.get('explanation')),
                    'd': r.get('difficulty', 1)})
        opt_hist[len(r['options'])] += 1
        ver[r.get('v', 1)] += 1

    with open(APP_OUT, 'w') as fh:
        json.dump({'questions': out}, fh, ensure_ascii=False)
    size = os.path.getsize(APP_OUT) / 1e6
    print(f'wrote cards-questions.json: {len(out):,} questions, {size:.1f} MB')
    print(f'  pool coverage {len(out) / len(pool_f) * 100:.1f}% of {len(pool_f):,} facts')
    print(f'  options per question: {dict(sorted(opt_hist.items()))}')
    print(f'  v2 {ver[2]:,} / legacy {ver[1]:,}')

    # ---- the two things this rewrite existed to fix, measured on what actually ships
    for lang in ('en', 'tl', 'bis'):
        lens = [len(o[lang]) for r in out for o in r['o'] if o.get(lang)]
        strict = expl = 0
        for r in out:
            L = [len(o.get(lang) or '') for o in r['o']]
            if not L:
                continue
            c, others = L[r['a']], [x for i, x in enumerate(L) if i != r['a']]
            if others and c > max(others):
                strict += 1
            if others and c - max(others) >= 3:
                expl += 1
        lens.sort()
        print(f'  {lang}: option len p50 {lens[len(lens)//2]} p95 {lens[int(len(lens)*.95)]} '
              f'max {lens[-1]} | correct strictly longest {strict/len(out)*100:.1f}% '
              f'| exploitable {expl/len(out)*100:.1f}%')

    print('\nNEXT: python3 rag/pipeline/build-cards-db.py   (the APK build refuses a stale one)')


if __name__ == '__main__':
    main()
