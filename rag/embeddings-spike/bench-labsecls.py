#!/usr/bin/env python3
"""Re-benchmark with the ACTUAL on-device LaBSE: BERT raw-CLS, NO dense head
(verified parity 0.99999 vs the qvac GGUF). The earlier 'LaBSE' bench used the
full sentence-transformers LaBSE (with dense) — which is NOT what ships.
  finetuning/.convert-venv/bin/python rag/embeddings-spike/bench-labsecls.py
"""
import json, os, collections
import numpy as np, torch, torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel

HERE = os.path.dirname(os.path.abspath(__file__)); C = os.path.join(HERE, "bench-cache")
bench = [json.loads(l) for l in open(os.path.join(HERE, "benchmark.jsonl"))]
rows = [json.loads(l) for l in open(os.path.join(os.path.dirname(os.path.dirname(HERE)), "rag/bank/science-facts.jsonl"))]
ids = [r["id"] for r in rows]
LANGKEY = {"tagalog": "tl", "taglish": "tl", "cebuano": "bis", "english": "en"}
dev = "mps"
tok = AutoTokenizer.from_pretrained("sentence-transformers/LaBSE")
model = AutoModel.from_pretrained("sentence-transformers/LaBSE").to(dev).eval()

def encode(texts, bs=64):
    out = []
    for i in range(0, len(texts), bs):
        enc = tok(texts[i:i+bs], return_tensors="pt", padding=True, truncation=True, max_length=192).to(dev)
        with torch.no_grad():
            cls = model(**enc).last_hidden_state[:, 0]          # raw CLS, NO dense
        out.append(F.normalize(cls, p=2, dim=1).cpu().numpy())
    return np.vstack(out).astype(np.float32)

corpus = {}
for lk, fld in (("tl", "tl"), ("bis", "bis"), ("en", "en")):
    cache = os.path.join(C, f"corpus_labsecls_{lk}.npy")
    if os.path.exists(cache): corpus[lk] = np.load(cache)
    else:
        print(f"embedding corpus {lk} (raw-CLS)...", flush=True)
        corpus[lk] = encode([f"{r['topic']}. {r['fact'][fld]}" for r in rows]); np.save(cache, corpus[lk])
qcache = os.path.join(C, "queries", "q_labsecls.npy")
if os.path.exists(qcache): qv = np.load(qcache)
else: qv = encode([b["query"] for b in bench]); np.save(qcache, qv)

lexical = json.load(open(os.path.join(C, "lexical.json")))
e5corp = {lk: np.load(os.path.join(C, f"corpus_e5_{lk}.npy")) for lk in ("tl", "bis", "en")}
e5q = np.load(os.path.join(C, "queries", "q_e5.npy"))

def topk(corp, qvec, k=10):
    s = corp @ qvec; t = np.argpartition(-s, k)[:k]; return [ids[i] for i in t[np.argsort(-s[t])]]
def rrf(*ls, k=60):
    sc = {}
    for l in ls:
        for r, f in enumerate(l): sc[f] = sc.get(f, 0) + 1/(k+r+1)
    return [f for f, _ in sorted(sc.items(), key=lambda x:-x[1])]
def rank(l, g): return next((i+1 for i, f in enumerate(l) if f == g), None)

METHODS = ["lexical", "e5", "hyb-e5", "labse-cls", "hyb-labse-cls"]
A = {m: [0, 0, 0, 0.0, 0] for m in METHODS}
L = {m: collections.defaultdict(lambda: [0, 0.0]) for m in METHODS}
for qi, b in enumerate(bench):
    if b["fact_id"] == "NONE": continue
    g, lang, lk = b["fact_id"], b["lang"], LANGKEY[b["lang"]]
    lex = lexical.get(b["query"], [])
    e5l = topk(e5corp[lk], e5q[qi]); lcl = topk(corpus[lk], qv[qi])
    R = {"lexical": rank(lex, g), "e5": rank(e5l, g), "hyb-e5": rank(rrf(lex, e5l), g),
         "labse-cls": rank(lcl, g), "hyb-labse-cls": rank(rrf(lex, lcl), g)}
    for m, r in R.items():
        a = A[m]; a[4] += 1; L[m][lang][1] += 1
        if r:
            a[0] += r <= 1; a[1] += r <= 3; a[2] += r <= 5; a[3] += 1/r
            if r <= 3: L[m][lang][0] += 1
N = A["lexical"][4]
print(f"\n=== {N} labeled queries — ON-DEVICE LaBSE (raw-CLS, no dense) ===\n")
print(f"{'method':16s} {'R@1':>6} {'R@3':>6} {'R@5':>6} {'MRR':>6}")
for m in METHODS: a = A[m]; print(f"{m:16s} {a[0]/N:6.3f} {a[1]/N:6.3f} {a[2]/N:6.3f} {a[3]/N:6.3f}")
print("\n=== Recall@3 by language ===")
langs = sorted({b['lang'] for b in bench if b['fact_id'] != 'NONE'})
print(f"{'method':16s} " + " ".join(f"{l[:7]:>8}" for l in langs))
for m in METHODS:
    print(f"{m:16s} " + " ".join(f"{(L[m][l][0]/L[m][l][1] if L[m][l][1] else 0):8.3f}" for l in langs))
