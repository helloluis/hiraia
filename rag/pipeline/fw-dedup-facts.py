#!/usr/bin/env python3
"""Dedup candidate facts against the existing bank (and each other) with LaBSE, so the
expansion adds NEW knowledge. Drops a candidate if its (topic+en) is too similar to any
existing fact (T_EXIST) or to an already-kept candidate (T_CAND). Local, no API.

  finetuning/.convert-venv/bin/python rag/pipeline/fw-dedup-facts.py [T_EXIST] [T_CAND]
"""
import os, json, glob, sys
import numpy as np, torch, torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel

HERE = os.path.dirname(os.path.abspath(__file__))
T_EXIST = float(sys.argv[1]) if len(sys.argv) > 1 else 0.86
T_CAND = float(sys.argv[2]) if len(sys.argv) > 2 else 0.90
dev = 'mps' if torch.backends.mps.is_available() else 'cpu'

existing = [json.loads(l) for l in open(os.path.join(HERE, '..', 'bank', 'science-facts.jsonl'))]
ex_text = [f"{e.get('topic','')}. {e['fact']['en']}" for e in existing]

cands = []
for fn in sorted(glob.glob(os.path.join(HERE, 'fact-candidates', 'cand-*.jsonl'))):
    for l in open(fn):
        if l.strip():
            cands.append(json.loads(l))
# drop exact-text dups among candidates up front
seen = set(); cands = [c for c in cands if not (c['en'].lower().strip() in seen or seen.add(c['en'].lower().strip()))]
print(f'existing {len(existing)} | candidates (exact-deduped) {len(cands)} | T_EXIST={T_EXIST} T_CAND={T_CAND}', flush=True)

tok = AutoTokenizer.from_pretrained('sentence-transformers/LaBSE')
model = AutoModel.from_pretrained('sentence-transformers/LaBSE').to(dev).eval()

def encode(texts, bs=192):
    out = []
    for i in range(0, len(texts), bs):
        enc = tok(texts[i:i+bs], return_tensors='pt', padding=True, truncation=True, max_length=96).to(dev)
        with torch.no_grad():
            cls = model(**enc).last_hidden_state[:, 0]
        out.append(F.normalize(cls, p=2, dim=1).cpu().numpy())
        if (i // bs) % 40 == 0: print(f'  embed {min(i+bs,len(texts))}/{len(texts)}', flush=True)
    return np.vstack(out).astype(np.float32)

print('embedding existing ...', flush=True); EX = encode(ex_text)
print('embedding candidates ...', flush=True); CA = encode([f"{c['topic']}. {c['en']}" for c in cands])

# 1. drop candidates too close to ANY existing fact (vectorized in blocks)
maxcos = np.zeros(len(cands), dtype=np.float32)
for i in range(0, len(CA), 400):
    maxcos[i:i+400] = (CA[i:i+400] @ EX.T).max(axis=1)
novel = [i for i in range(len(cands)) if maxcos[i] < T_EXIST]
print(f'novel vs existing: {len(novel)}/{len(cands)} ({len(novel)/max(1,len(cands)):.0%})', flush=True)

# 2. greedy within-candidate dedup
kept_idx = []
kv = np.empty((len(novel), CA.shape[1]), dtype=np.float32); k = 0
for i in novel:
    v = CA[i]
    if k and float((kv[:k] @ v).max()) >= T_CAND:
        continue
    kv[k] = v; k += 1; kept_idx.append(i)
print(f'after within-candidate dedup: {len(kept_idx)} distinct new facts', flush=True)

out = os.path.join(HERE, 'fact-candidates-distinct.jsonl')
from collections import Counter
with open(out, 'w') as f:
    for i in kept_idx:
        f.write(json.dumps(cands[i], ensure_ascii=False) + '\n')
print('by domain:', dict(Counter(cands[i]['domain'] for i in kept_idx)))
print(f'wrote {out}')
