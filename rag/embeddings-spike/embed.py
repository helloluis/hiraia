#!/usr/bin/env python3
"""Embeddings spike: embed the fact bank + the hard-case queries with
multilingual-e5-small and write semantic top-k. Validates whether semantic
retrieval fixes our lexical residuals (utak/baga/puso homonyms + morphology)
before we commit to building the on-device hybrid.

  finetuning/.convert-venv/bin/python rag/embeddings-spike/embed.py
"""
import json, os, hashlib, sys
import numpy as np
import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BANK = os.path.join(ROOT, "rag/bank/science-facts.jsonl")
MODEL = "intfloat/multilingual-e5-small"
CACHE = os.path.join(HERE, ".emb-cache.npy")
IDS = os.path.join(HERE, ".emb-ids.json")
dev = "mps" if torch.backends.mps.is_available() else "cpu"

rows = [json.loads(l) for l in open(BANK, encoding="utf-8")]
# Tagalog-scoped passage: concept (topic) + the TL body — mirrors what we'd ship
# for TL queries. e5 wants the "passage:" / "query:" prefixes.
def passage(r):
    return f"passage: {r['topic']}. {r['fact']['tl']}"

print(f"device={dev} | {len(rows)} facts | model={MODEL}")
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModel.from_pretrained(MODEL).to(dev).eval()

def embed(texts, bs=64):
    out = []
    for i in range(0, len(texts), bs):
        b = texts[i:i + bs]
        enc = tok(b, max_length=192, padding=True, truncation=True, return_tensors="pt").to(dev)
        with torch.no_grad():
            h = model(**enc).last_hidden_state
        m = enc["attention_mask"].unsqueeze(-1).float()
        v = (h * m).sum(1) / m.sum(1).clamp(min=1e-9)
        v = F.normalize(v, p=2, dim=1)
        out.append(v.cpu().numpy())
        if (i // bs) % 50 == 0:
            print(f"  embedded {i+len(b)}/{len(texts)}", flush=True)
    return np.vstack(out).astype(np.float32)

# corpus embeddings (cache keyed by bank content hash)
h = hashlib.md5(open(BANK, "rb").read()).hexdigest()[:8]
ids = [r["id"] for r in rows]
if os.path.exists(CACHE) and os.path.exists(IDS) and json.load(open(IDS)).get("hash") == h:
    print("loading cached corpus embeddings")
    corpus = np.load(CACHE)
else:
    print("embedding corpus (one-time)...")
    corpus = embed([passage(r) for r in rows])
    np.save(CACHE, corpus)
    json.dump({"hash": h, "ids": ids}, open(IDS, "w"))
print("corpus embeddings:", corpus.shape, f"({corpus.nbytes/1e6:.1f} MB float32; ~{corpus.nbytes/4e6:.1f} MB int8)")

cases = json.load(open(os.path.join(HERE, "cases.json")))
qvecs = embed([f"query: {c['q']}" for c in cases])
sims = qvecs @ corpus.T  # cosine (both normalized)
results = {}
for ci, c in enumerate(cases):
    top = np.argsort(-sims[ci])[:8]
    results[c["q"]] = [{"id": ids[i], "score": float(sims[ci][i])} for i in top]
json.dump(results, open(os.path.join(HERE, "semantic_results.json"), "w"), ensure_ascii=False, indent=1)
print("wrote semantic_results.json")
