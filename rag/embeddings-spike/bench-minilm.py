#!/usr/bin/env python3
"""Benchmark paraphrase-multilingual-MiniLM-L12-v2 (118M, mean-pool/no-dense ->
GGUF is faithful) vs the shippable LaBSE-cls and lexical, on the same 450 queries.
  finetuning/.convert-venv/bin/python rag/embeddings-spike/bench-minilm.py
"""
import json, os, collections
import numpy as np
from sentence_transformers import SentenceTransformer

HERE = os.path.dirname(os.path.abspath(__file__)); C = os.path.join(HERE, "bench-cache")
bench = [json.loads(l) for l in open(os.path.join(HERE, "benchmark.jsonl"))]
rows = [json.loads(l) for l in open(os.path.join(os.path.dirname(os.path.dirname(HERE)), "rag/bank/science-facts.jsonl"))]
ids = [r["id"] for r in rows]
LANGKEY = {"tagalog": "tl", "taglish": "tl", "cebuano": "bis", "english": "en"}

m = SentenceTransformer("sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", device="mps")
def enc(texts): return m.encode(texts, normalize_embeddings=True, batch_size=128, convert_to_numpy=True).astype(np.float32)
mm = {}
for lk, fld in (("tl", "tl"), ("bis", "bis"), ("en", "en")):
    cache = os.path.join(C, f"corpus_minilm_{lk}.npy")
    if os.path.exists(cache): mm[lk] = np.load(cache)
    else:
        print(f"embedding corpus {lk} (minilm)...", flush=True)
        mm[lk] = enc([f"{r['topic']}. {r['fact'][fld]}" for r in rows]); np.save(cache, mm[lk])
qc = os.path.join(C, "queries", "q_minilm.npy")
qv = np.load(qc) if os.path.exists(qc) else enc([b["query"] for b in bench])
if not os.path.exists(qc): np.save(qc, qv)

lexical = json.load(open(os.path.join(C, "lexical.json")))
lcorp = {lk: np.load(os.path.join(C, f"corpus_labsecls_{lk}.npy")) for lk in ("tl", "bis", "en")}
lq = np.load(os.path.join(C, "queries", "q_labsecls.npy"))

def topk(corp, qvec, k=10):
    s = corp @ qvec; t = np.argpartition(-s, k)[:k]; return [ids[i] for i in t[np.argsort(-s[t])]]
def rrf(*ls, k=60):
    sc = {}
    for l in ls:
        for r, f in enumerate(l): sc[f] = sc.get(f, 0) + 1/(k+r+1)
    return [f for f, _ in sorted(sc.items(), key=lambda x:-x[1])]
def rank(l, g): return next((i+1 for i, f in enumerate(l) if f == g), None)

METHODS = ["lexical", "labse-cls", "hyb-labse-cls", "minilm", "hyb-minilm"]
A = {x: [0, 0, 0, 0.0, 0] for x in METHODS}
L = {x: collections.defaultdict(lambda: [0, 0.0]) for x in METHODS}
for qi, b in enumerate(bench):
    if b["fact_id"] == "NONE": continue
    g, lang, lk = b["fact_id"], b["lang"], LANGKEY[b["lang"]]
    lex = lexical.get(b["query"], []); lcl = topk(lcorp[lk], lq[qi]); mnl = topk(mm[lk], qv[qi])
    R = {"lexical": rank(lex, g), "labse-cls": rank(lcl, g), "hyb-labse-cls": rank(rrf(lex, lcl), g),
         "minilm": rank(mnl, g), "hyb-minilm": rank(rrf(lex, mnl), g)}
    for x, r in R.items():
        a = A[x]; a[4] += 1; L[x][lang][1] += 1
        if r:
            a[0] += r <= 1; a[1] += r <= 3; a[2] += r <= 5; a[3] += 1/r
            if r <= 3: L[x][lang][0] += 1
N = A["lexical"][4]
print(f"\n=== {N} queries — MiniLM (mean-pool, GGUF-faithful) vs LaBSE-cls ===\n")
print(f"{'method':16s} {'R@1':>6} {'R@3':>6} {'R@5':>6} {'MRR':>6}")
for x in METHODS: a = A[x]; print(f"{x:16s} {a[0]/N:6.3f} {a[1]/N:6.3f} {a[2]/N:6.3f} {a[3]/N:6.3f}")
print("\n=== Recall@3 by language ===")
langs = sorted({b['lang'] for b in bench if b['fact_id'] != 'NONE'})
print(f"{'method':16s} " + " ".join(f"{l[:7]:>8}" for l in langs))
for x in METHODS:
    print(f"{x:16s} " + " ".join(f"{(L[x][l][0]/L[x][l][1] if L[x][l][1] else 0):8.3f}" for l in langs))
