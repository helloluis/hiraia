#!/usr/bin/env python3
"""Embed the fact bank with e5-small AND LaBSE, per language body (tl/bis/en),
to mirror production language-scoping. Cached .npy per (model, lang).
  finetuning/.convert-venv/bin/python rag/embeddings-spike/bench-embed-corpus.py
"""
import json, os, hashlib
import numpy as np
from sentence_transformers import SentenceTransformer

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BANK = os.path.join(ROOT, "rag/bank/science-facts.jsonl")
OUT = os.path.join(HERE, "bench-cache")
os.makedirs(OUT, exist_ok=True)
rows = [json.loads(l) for l in open(BANK, encoding="utf-8")]
ids = [r["id"] for r in rows]
H = hashlib.md5(open(BANK, "rb").read()).hexdigest()[:8]
json.dump({"hash": H, "ids": ids}, open(os.path.join(OUT, "ids.json"), "w"))

# e5 wants a "passage: " prefix; LaBSE takes raw text. Topic (concept) anchors
# the body cross-lingually.
MODELS = {
    "e5": ("intfloat/multilingual-e5-small", lambda topic, body: f"passage: {topic}. {body}"),
    "labse": ("sentence-transformers/LaBSE", lambda topic, body: f"{topic}. {body}"),
}
LANGS = {"tl": "tl", "bis": "bis", "en": "en"}

for mkey, (mname, tmpl) in MODELS.items():
    print(f"\n=== {mkey} ({mname}) ===", flush=True)
    model = SentenceTransformer(mname, device="mps")
    for lkey, fld in LANGS.items():
        cache = os.path.join(OUT, f"corpus_{mkey}_{lkey}.npy")
        if os.path.exists(cache) and json.load(open(os.path.join(OUT, "ids.json")))["hash"] == H:
            print(f"  {lkey}: cached"); continue
        texts = [tmpl(r["topic"], r["fact"][fld]) for r in rows]
        emb = model.encode(texts, normalize_embeddings=True, batch_size=64,
                           show_progress_bar=False, convert_to_numpy=True).astype(np.float32)
        np.save(cache, emb)
        print(f"  {lkey}: {emb.shape}  ({emb.nbytes/1e6:.0f}MB)", flush=True)
print("\ncorpus embedding done")
