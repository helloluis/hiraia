#!/usr/bin/env python3
"""Benchmark: lexical vs e5 vs LaBSE vs hybrid on the labeled query set.
Reports Recall@1/3/5 + MRR per method, broken down by language and style, plus
abstain-floor separation from the negatives.
  finetuning/.convert-venv/bin/python rag/embeddings-spike/bench-run.py
"""
import json, os, collections
import numpy as np
from sentence_transformers import SentenceTransformer

HERE = os.path.dirname(os.path.abspath(__file__))
C = os.path.join(HERE, "bench-cache")
bench = [json.loads(l) for l in open(os.path.join(HERE, "benchmark.jsonl"))]
ids = json.load(open(os.path.join(C, "ids.json")))["ids"]
idpos = {fid: i for i, fid in enumerate(ids)}
LANGKEY = {"tagalog": "tl", "taglish": "tl", "cebuano": "bis", "english": "en"}
corpus = {m: {lk: np.load(os.path.join(C, f"corpus_{m}_{lk}.npy")) for lk in ("tl", "bis", "en")} for m in ("e5", "labse")}
lexical = json.load(open(os.path.join(C, "lexical.json")))

# embed queries with both models (cache)
QC = os.path.join(C, "queries")
os.makedirs(QC, exist_ok=True)
def embed_queries():
    out = {}
    specs = {"e5": ("intfloat/multilingual-e5-small", lambda q: f"query: {q}"),
             "labse": ("sentence-transformers/LaBSE", lambda q: q)}
    for m, (mn, tmpl) in specs.items():
        cache = os.path.join(QC, f"q_{m}.npy")
        if os.path.exists(cache):
            out[m] = np.load(cache); continue
        model = SentenceTransformer(mn, device="mps")
        v = model.encode([tmpl(b["query"]) for b in bench], normalize_embeddings=True,
                         batch_size=64, convert_to_numpy=True).astype(np.float32)
        np.save(cache, v); out[m] = v
        print(f"embedded queries with {m}: {v.shape}")
    return out
qemb = embed_queries()

def sem_topk(m, qi, lang, k=10):
    lk = LANGKEY[lang]
    sims = corpus[m][lk] @ qemb[m][qi]
    top = np.argpartition(-sims, k)[:k]
    top = top[np.argsort(-sims[top])]
    return [ids[i] for i in top], float(sims[top[0]])

def rrf(*lists, k=60):
    score = {}
    for lst in lists:
        for r, fid in enumerate(lst):
            score[fid] = score.get(fid, 0) + 1.0 / (k + r + 1)
    return [f for f, _ in sorted(score.items(), key=lambda x: -x[1])]

def rank_of(lst, gold):
    return next((i + 1 for i, f in enumerate(lst) if f == gold), None)

METHODS = ["lexical", "e5", "labse", "hyb-e5", "hyb-labse"]
agg = {m: collections.defaultdict(lambda: [0, 0, 0, 0.0, 0]) for m in METHODS}  # r@1,r@3,r@5,mrr,n
by_lang = {m: collections.defaultdict(lambda: [0, 0.0]) for m in METHODS}  # r@3, n
by_style = {m: collections.defaultdict(lambda: [0, 0.0]) for m in METHODS}
pos_floor, neg_floor = [], []  # semantic(e5) top-1 cosine for positives/negatives

for qi, b in enumerate(bench):
    q, gold, lang, style = b["query"], b["fact_id"], b["lang"], b["style"]
    lex = lexical.get(q, [])
    e5l, e5top = sem_topk("e5", qi, lang)
    lbl, lbtop = sem_topk("labse", qi, lang)
    ranks = {"lexical": rank_of(lex, gold), "e5": rank_of(e5l, gold), "labse": rank_of(lbl, gold),
             "hyb-e5": rank_of(rrf(lex, e5l), gold), "hyb-labse": rank_of(rrf(lex, lbl), gold)}
    if gold == "NONE":
        neg_floor.append(e5top); continue
    pos_floor.append(e5top)
    for m, r in ranks.items():
        a = agg[m]["all"]
        a[4] += 1; by_lang[m][lang][1] += 1; by_style[m][style][1] += 1
        if r:
            if r <= 1: a[0] += 1
            if r <= 3: a[1] += 1; by_lang[m][lang][0] += 1; by_style[m][style][0] += 1
            if r <= 5: a[2] += 1
            a[3] += 1.0 / r

N = agg["lexical"]["all"][4]
print(f"=== {N} labeled queries (+{len(neg_floor)} negatives) ===\n")
print(f"{'method':10s} {'R@1':>6} {'R@3':>6} {'R@5':>6} {'MRR':>6}")
for m in METHODS:
    a = agg[m]["all"]
    print(f"{m:10s} {a[0]/N:6.3f} {a[1]/N:6.3f} {a[2]/N:6.3f} {a[3]/N:6.3f}")

print("\n=== Recall@3 by language ===")
langs = sorted({b['lang'] for b in bench if b['fact_id'] != 'NONE'})
print(f"{'method':10s} " + " ".join(f"{l[:7]:>8}" for l in langs))
for m in METHODS:
    print(f"{m:10s} " + " ".join(f"{(by_lang[m][l][0]/by_lang[m][l][1] if by_lang[m][l][1] else 0):8.3f}" for l in langs))

print("\n=== Recall@3 by style ===")
styles = sorted({b['style'] for b in bench if b['fact_id'] != 'NONE'})
print(f"{'method':10s} " + " ".join(f"{s[:8]:>9}" for s in styles))
for m in METHODS:
    print(f"{m:10s} " + " ".join(f"{(by_style[m][s][0]/by_style[m][s][1] if by_style[m][s][1] else 0):9.3f}" for s in styles))

print("\n=== abstain floor (e5 top-1 cosine) ===")
if pos_floor and neg_floor:
    pa = np.array(pos_floor); na = np.array(neg_floor)
    print(f"  positives: mean {pa.mean():.3f}  p10 {np.percentile(pa,10):.3f}")
    print(f"  negatives: mean {na.mean():.3f}  p90 {np.percentile(na,90):.3f}")
    # best floor: maximize correct keep(pos) + reject(neg)
    best = max(np.arange(0.70, 0.95, 0.01), key=lambda t: (pa >= t).mean() + (na < t).mean())
    print(f"  best floor ~{best:.2f}: keeps {(pa>=best).mean()*100:.0f}% positives, rejects {(na<best).mean()*100:.0f}% negatives")
