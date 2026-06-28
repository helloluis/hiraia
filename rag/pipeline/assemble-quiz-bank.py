#!/usr/bin/env python3
"""Assemble the expanded trilingual quiz bank: join EN (gen+verify) + tl/bis (Fireworks
translation) into full records, assign IDs, and merge into rag/bank/quiz-bank.jsonl.

Backs up the existing bank first. Concept clustering is a SEPARATE step afterward
(cluster-quiz-concepts.py, local LaBSE).

  python3 rag/pipeline/assemble-quiz-bank.py
"""
import json, glob, os, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.join(HERE, '..', 'bank', 'quiz-bank.jsonl')
FACTS = os.path.join(HERE, '..', 'bank', 'science-facts.jsonl')

# 1. EN questions by factId (A+BCD and batch E)
en = {}
for fn in ['quiz-new-kept.jsonl', 'quiz-batchE-kept.jsonl']:
    for l in open(os.path.join(HERE, fn)):
        if l.strip():
            q = json.loads(l); en[q['factId']] = q

# 2. translate index i -> factId
i2fid = {}
for fn in ['quiz-translate-input.jsonl', 'quiz-batchE-translate-input.jsonl']:
    for l in open(os.path.join(HERE, fn)):
        if l.strip():
            r = json.loads(l); i2fid[r['i']] = r['factId']

# 3. translations by i
tr = {}
for fn in glob.glob(os.path.join(HERE, 'quiz-xlate', 'tl-*.jsonl')) + glob.glob(os.path.join(HERE, 'quiz-xlate', 'fw-*.jsonl')):
    for l in open(fn):
        if l.strip():
            t = json.loads(l)
            if isinstance(t.get('opt_tl'), list) and len(t['opt_tl']) == 4 and len(t.get('opt_bis', [])) == 4:
                tr[t['i']] = t

# 4. fact metadata (grades, topic)
fmeta = {}
for l in open(FACTS):
    f = json.loads(l); fmeta[f['id']] = (f.get('grades', [5]), f.get('topic', ''))

# 5. build trilingual records (one per translated question), dedup by factId
orig = [json.loads(l) for l in open(BANK)]
orig_fids = set(q.get('factId') for q in orig)
maxid = max(int(q['id'].split('-')[1]) for q in orig)

new = {}
for i, t in tr.items():
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
shutil.copy(BANK, BANK + '.pre-expansion.bak')
allq = orig + newq
with open(BANK, 'w') as f:
    for q in allq:
        f.write(json.dumps(q, ensure_ascii=False) + '\n')

print(f'EN questions: {en_total} | translated: {len(translated_fids)} | EN without translation (excluded): {no_tr}')
print(f'merged: {len(orig)} original + {len(newq)} new = {len(allq)} questions')
print(f'backed up old bank -> {os.path.basename(BANK)}.pre-expansion.bak')
print('NEXT: concept-cluster the merged bank ->  finetuning/.convert-venv/bin/python rag/scripts/cluster-quiz-concepts.py 0.82')
