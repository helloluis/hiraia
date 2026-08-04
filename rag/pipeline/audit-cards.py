#!/usr/bin/env python3
"""Full-coverage audit of the card-feed artifacts (not a sampled walk like the harness —
every card, every MCQ). Reports:

  FACTOIDS  — displayed text (Q hook + body, as rendered) over the word budget, per language
  MCQS      — structural errors in cards-questions.json: wrong option count, answer index
              out of range, empty options, duplicate options, missing trilingual q/e,
              degenerate answer==question, and a content flag when the correct option has
              ~zero content-word overlap with the underlying fact + explanation (suspect
              grounding — review by hand, not auto-fixable)

Cross-references rag/bank/quiz-bank.jsonl and rag/bank/factoids.jsonl so every flagged item
carries its SOURCE id for fixing at the bank layer (never edit the generated JSON directly).

  python3 rag/pipeline/audit-cards.py
"""
import json, re, sys
from collections import Counter

POOL = 'packages/mobile/src/generated/cardsPool.generated.json'
QUESTIONS = 'packages/mobile/src/data/cards-questions.json'
QUIZBANK = 'rag/bank/quiz-bank.jsonl'
FACTOIDS = 'rag/bank/factoids.jsonl'
REPORT = 'rag/pipeline/audit-cards-report.txt'

WORD_BUDGET = 48  # matches the harness long-factoid threshold

words = lambda s: len(s.split())

def _norm(s):
    # keep decimal points, signs, and math operators — "1.5" ≠ "15", "-10°C" ≠ "10°C",
    # "V = I + R" ≠ "V = I × R" — or numeric/formula options false-positive as duplicates
    s = (s or '').lower().replace('−', '-').replace('–', '-').replace('—', '-')
    return re.sub(r'[^a-z0-9.\-+×÷= ]', '', s).strip()
STOP = set('''the a an and or of to in is are was were ang ng mga sa na ay at para with for
it its this that these those by on as from'''.split())
content_words = lambda s: {w for w in _norm(s).split() if len(w) > 3 and w not in STOP}

pool = json.load(open(POOL))['cards']
questions = json.load(open(QUESTIONS))['questions']
quizbank = {}
for i, l in enumerate(open(QUIZBANK)):
    l = l.strip()
    if l:
        r = json.loads(l)
        quizbank[r['factId']] = (i + 1, r)  # 1-based line no → source row

# ---------------- FACTOIDS ----------------
long_facts, missing_text = [], []
for c in pool:
    for lang in ('tl', 'en', 'bis'):
        t = (c['fact'].get(lang) or '').strip()
        if not t:
            missing_text.append((c['id'], c['factId'], lang))
        elif words(t) > WORD_BUDGET:
            long_facts.append((c['id'], c['factId'], lang, words(t), t[:90]))

# ---------------- MCQS ----------------
errs = []  # (kind, factId, quizbank_line, detail)
content_flags = []
pool_by_fid = {}
for c in pool:
    pool_by_fid.setdefault(c['factId'], c)

for q in questions:
    fid = q['f']
    line = quizbank.get(fid, ('?', None))[0]
    opts = q.get('o') or []
    a = q.get('a')
    if len(opts) != 4:
        errs.append(('option-count', fid, line, f'{len(opts)} options'))
    if not isinstance(a, int) or not (0 <= a < len(opts)):
        errs.append(('answer-index', fid, line, f'a={a} opts={len(opts)}'))
        continue  # further checks assume a valid answer slot
    for lang in ('tl', 'en', 'bis'):
        if not (q['q'].get(lang) or '').strip():
            errs.append(('missing-question', fid, line, lang))
        if not (q['e'].get(lang) or '').strip():
            errs.append(('missing-explanation', fid, line, lang))
        texts = [(o.get(lang) or '').strip() for o in opts]
        for j, t in enumerate(texts):
            if not t:
                errs.append(('empty-option', fid, line, f'{lang} opt{j}'))
        seen = {}
        for j, t in enumerate(texts):
            n = _norm(t)
            if not n:
                continue
            if n in seen:
                errs.append(('duplicate-option', fid, line, f'{lang}: opts {seen[n]}&{j} = "{t[:60]}"'))
            else:
                seen[n] = j
    # degenerate: answer restates the question
    for lang in ('tl', 'en', 'bis'):
        if _norm(opts[a].get(lang)) and _norm(opts[a].get(lang)) == _norm(q['q'].get(lang)):
            errs.append(('answer-equals-question', fid, line, lang))
    # content flag: correct option unsupported by fact + explanation (english signal)
    card = pool_by_fid.get(fid)
    if card:
        ground = ' '.join([
            card['fact'].get('en') or '', card['fact'].get('tl') or '',
            q['e'].get('en') or '', q['e'].get('tl') or '',
        ])
        gw = content_words(ground)
        aw = content_words(opts[a].get('en') or '')
        if aw and gw and not (aw & gw):
            content_flags.append((fid, line, opts[a].get('en')[:70], (card['fact'].get('en') or '')[:70]))

# ---------------- report ----------------
L = []
L.append('=================== CARD-FEED FULL AUDIT ===================')
L.append(f'pool cards: {len(pool)} | interject MCQs: {len(questions)}')
L.append('')
L.append(f'FACTOIDS over {WORD_BUDGET} words: {len(long_facts)}')
for fid, sfid, lang, n, snip in long_facts:
    L.append(f'  {fid} ({sfid}) [{lang}] {n}w: {snip}…')
L.append(f'missing text: {len(missing_text)}')
for fid, sfid, lang in missing_text:
    L.append(f'  {fid} ({sfid}) missing {lang}')
L.append('')
by_kind = Counter(k for k, *_ in errs)
L.append(f'MCQ structural errors: {len(errs)}  {dict(by_kind)}')
for kind, fid, line, detail in errs:
    L.append(f'  [{kind}] {fid} (quiz-bank.jsonl:{line}) {detail}')
L.append('')
L.append(f'MCQ content flags (correct option not grounded in fact/explanation — REVIEW): {len(content_flags)}')
for fid, line, ans, fact in content_flags:
    L.append(f'  {fid} (quiz-bank.jsonl:{line})')
    L.append(f'    answer: {ans}')
    L.append(f'    fact:   {fact}')

report = '\n'.join(L)
open(REPORT, 'w').write(report + '\n')
print('\n'.join(L[:12]))
print(f'...')
print(f'MCQ structural errors: {len(errs)}  {dict(by_kind)}')
print(f'MCQ content flags: {len(content_flags)}')
print(f'full report -> {REPORT}')
