#!/usr/bin/env python3
"""Build the bundled semantic vectors blob: embed every fact body (tl/bis/en)
with LaBSE raw-CLS (the EXACT on-device embedder — BERT CLS, no dense head,
parity 0.99999 vs the qvac GGMLBert GGUF), quantize to int8, and pack.

Output (rag/bank/, gitignored .bin — regenerate on bank change):
  vectors-labse.i8.bin    int8, lang-major [tl | bis | en], each count*dims
  vectors-labse.meta.json {model, dims, scale, count, langs, bankHash}

Fact order == SCIENCE_FACTS order (the bank file order), so blob index i maps to
the i-th fact; no id list needed in the blob.
  finetuning/.convert-venv/bin/python rag/scripts/build-vectors.py
"""
import json, os, hashlib
import numpy as np, torch, torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # rag/
BANK = os.path.join(HERE, "bank", "science-facts.jsonl")
BIN = os.path.join(HERE, "bank", "vectors-labse.i8.bin")
META = os.path.join(HERE, "bank", "vectors-labse.meta.json")
MODEL = "sentence-transformers/LaBSE"
LANGS = ["tl", "bis", "en"]
dev = "mps" if torch.backends.mps.is_available() else "cpu"

rows = [json.loads(l) for l in open(BANK, encoding="utf-8")]
bankhash = hashlib.md5(open(BANK, "rb").read()).hexdigest()[:12]
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModel.from_pretrained(MODEL).to(dev).eval()

def encode(texts, bs=64):
    out = []
    for i in range(0, len(texts), bs):
        enc = tok(texts[i:i+bs], return_tensors="pt", padding=True, truncation=True, max_length=192).to(dev)
        with torch.no_grad():
            cls = model(**enc).last_hidden_state[:, 0]   # raw CLS, NO dense (== qvac GGUF)
        out.append(F.normalize(cls, p=2, dim=1).cpu().numpy())
        if (i // bs) % 50 == 0: print(f"  {i+len(texts[i:i+bs])}/{len(texts)}", flush=True)
    return np.vstack(out).astype(np.float32)

mats = {}
for lk in LANGS:
    print(f"embedding {lk} ...", flush=True)
    mats[lk] = encode([f"{r['topic']}. {r['fact'][lk]}" for r in rows])

# global int8 scale across all languages (so one dequant constant)
scale = float(np.concatenate(list(mats.values())).__abs__().max()) / 127.0
with open(BIN, "wb") as f:
    for lk in LANGS:
        f.write(np.round(mats[lk] / scale).astype(np.int8).tobytes())
meta = {"model": MODEL + " (raw-CLS, no dense)", "dims": int(mats["tl"].shape[1]),
        "scale": scale, "count": len(rows), "langs": LANGS, "bankHash": bankhash}
json.dump(meta, open(META, "w"), indent=1)
print(f"\nwrote {BIN}  ({os.path.getsize(BIN)/1e6:.0f} MB)")
print(f"wrote {META}: {meta}")
