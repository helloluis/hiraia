#!/usr/bin/env python3
"""Assemble the expanded trilingual quiz bank: join EN (gen+verify) + tl/bis (Fireworks
translation) into full records, assign IDs, and merge into rag/bank/quiz-bank.jsonl.

Backs up the existing bank first. Concept clustering is a SEPARATE step afterward
(cluster-quiz-concepts.py, local LaBSE).

New ids always continue from the current max id in the bank (never re-minted); a factId
that already has a question in the bank is skipped. Inputs are overridable per lane
(paths relative to rag/pipeline/, comma-separated where a list):

  python3 rag/pipeline/assemble-quiz-bank.py                       # June batches (defaults)
  QZ_KEPT=quiz-lane/kept.jsonl QZ_TRANSLATE_INPUT=quiz-lane/translate-input.jsonl \
  QZ_XLATE_DIR=quiz-lane/xlate QZ_BACKUP_SUFFIX=.pre-quiz-lane.bak \
      python3 rag/pipeline/assemble-quiz-bank.py
"""
import json, glob, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from quiz_xlate_rules import translation_ok
BANK = os.path.join(HERE, '..', 'bank', 'quiz-bank.jsonl')
FACTS = os.path.join(HERE, '..', 'bank', 'science-facts.jsonl')
KEPT = os.environ.get('QZ_KEPT', 'quiz-new-kept.jsonl,quiz-batchE-kept.jsonl').split(',')
TRANSLATE_INPUT = os.environ.get('QZ_TRANSLATE_INPUT', 'quiz-translate-input.jsonl,quiz-batchE-translate-input.jsonl').split(',')
XLATE_DIR = os.path.join(HERE, os.environ.get('QZ_XLATE_DIR', 'quiz-xlate'))
BACKUP_SUFFIX = os.environ.get('QZ_BACKUP_SUFFIX', '.pre-expansion.bak')

# 1. EN questions by factId
en = {}
for fn in KEPT:
    for l in open(os.path.join(HERE, fn)):
        if l.strip():
            q = json.loads(l); en[q['factId']] = q

# 2. translate index i -> factId (+ the EN options the translation must be checked against)
i2fid, i2opts = {}, {}
for fn in TRANSLATE_INPUT:
    for l in open(os.path.join(HERE, fn)):
        if l.strip():
            r = json.loads(l); i2fid[r['i']] = r['factId']; i2opts[r['i']] = r['options']

# 3. translations by i — same acceptance rule as fw-translate.py (distinct options, sentence-length
#    options really translated); a row that fails stays out of the bank and is redone by the translator
tr, refused = {}, 0
for fn in sorted(glob.glob(os.path.join(XLATE_DIR, 'tl-*.jsonl')) + glob.glob(os.path.join(XLATE_DIR, 'fw-*.jsonl'))):
    for l in open(fn):
        if l.strip():
            t = json.loads(l)
            if t['i'] in i2opts and translation_ok(i2opts[t['i']], t):
                tr[t['i']] = t
            else:
                refused += 1

# 4. fact metadata (grades, topic)
fmeta = {}
for l in open(FACTS):
    f = json.loads(l); fmeta[f['id']] = (f.get('grades', [5]), f.get('topic', ''))

# 5. build trilingual records (one per translated question), dedup by factId
orig = [json.loads(l) for l in open(BANK)]
orig_fids = set(q.get('factId') for q in orig)
maxid = max(int(q['id'].split('-')[1]) for q in orig)

new = {}
for i, t in sorted(tr.items()):  # deterministic id assignment (translate-index order)
    fid = i2fid.get(i)
    if not fid or fid not in en or fid in orig_fids or fid in new:
        continue
    e = en[fid]
    grades, topic = fmeta.get(fid, ([5], ''))
    new[fid] = {
        'factId': fid, 'domain': e['domain'], 'topic': topic, 'grades': grades,
        'q': {'en': e['q'], 'tl': t['q_tl'], 'bis': t['q_bis']},
        'options': [{'en': e['options'][k], 'tl': t['opt_tl'][k], 'bis': t['opt_bis'][k]} for k in range(4)],
        'answer': e['answer'],
        'explanation': {'en': e['explanation'], 'tl': t['expl_tl'], 'bis': t['expl_bis']},
        'difficulty': e['difficulty'], 'reviewed': False, 'quizTopic': e['quizTopic'], 'concept': -1,
    }

newq = list(new.values())
for n, rec in enumerate(newq):
    rec['id'] = f'quiz-{maxid + 1 + n:05d}'
# canonical key order to match existing records
order = ['id', 'factId', 'domain', 'topic', 'grades', 'q', 'options', 'answer', 'explanation', 'difficulty', 'reviewed', 'quizTopic', 'concept']
newq = [{k: r[k] for k in order} for r in newq]

# coverage report
en_total = len(en)
translated_fids = {i2fid[i] for i in tr if i in i2fid}
no_tr = len([f for f in en if f not in translated_fids and f not in orig_fids])

# 6. back up + merge + write
shutil.copy(BANK, BANK + BACKUP_SUFFIX)
allq = orig + newq
with open(BANK, 'w') as f:
    for q in allq:
        f.write(json.dumps(q, ensure_ascii=False) + '\n')

print(f'EN questions: {en_total} | translated: {len(translated_fids)} | EN without translation (excluded): {no_tr} | '
      f'stored translations refused (untranslated/duplicate options, re-queued for the translator): {refused}')
print(f'merged: {len(orig)} original + {len(newq)} new = {len(allq)} questions')
if newq: print(f'new ids: {newq[0]["id"]} .. {newq[-1]["id"]} (previous max quiz-{maxid:05d})')
print(f'backed up old bank -> {os.path.basename(BANK)}{BACKUP_SUFFIX}')
print('NEXT: concept-cluster the merged bank ->  finetuning/.convert-venv/bin/python rag/scripts/cluster-quiz-concepts.py 0.82')
