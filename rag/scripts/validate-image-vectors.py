#!/usr/bin/env python3
"""Calibrate IMAGE_TAG_FLOOR (LocalEngine.resolveImageTag): retrieve top-1 slugs
for (a) the real SFT tag descriptions (true positives — authored against the
catalog) and (b) out-of-catalog decoy descriptions (should NOT resolve), then
report both cosine distributions so the floor can sit between them.

  finetuning/.convert-venv/bin/python rag/scripts/validate-image-vectors.py
"""
import json, os, re, glob
import numpy as np, torch, torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(HERE)
BIN = os.path.join(ROOT, "packages", "mobile", "assets", "rag", "image-vectors-labse.i8.bin")
META = os.path.join(ROOT, "packages", "mobile", "assets", "rag", "image-vectors-labse.meta.json")
SFT = [
    os.path.join(ROOT, "finetuning", "datasets", "tagalog", "science-chat-tagged.jsonl"),
    os.path.join(ROOT, "finetuning", "datasets", "bisaya", "science-chat-tagged.jsonl"),
]
# Plausible-but-absent decoys: things a kid might ask to see that the catalog
# (science clip-art) should refuse rather than mis-resolve.
DECOYS = [
    "a popular video game character jumping over a pipe",
    "a basketball player dunking during a professional game",
    "the logo of a famous fast food restaurant",
    "a birthday cake with candles at a party",
    "a cartoon superhero flying over a city",
    "a brand new sports car driving on a highway",
    "a celebrity singing on a concert stage",
    "a delicious bowl of ramen with chopsticks",
    "a smartphone showing a social media app",
    "a Christmas tree decorated with lights and gifts",
]

meta = json.load(open(META))
vecs = np.frombuffer(open(BIN, "rb").read(), dtype=np.int8).reshape(meta["count"], meta["dims"])
vecs_f = vecs.astype(np.float32) * meta["scale"]

MODEL = "sentence-transformers/LaBSE"
dev = "mps" if torch.backends.mps.is_available() else "cpu"
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModel.from_pretrained(MODEL).to(dev).eval()

def encode(texts, bs=64):
    out = []
    for i in range(0, len(texts), bs):
        enc = tok(texts[i:i+bs], return_tensors="pt", padding=True, truncation=True, max_length=192).to(dev)
        with torch.no_grad():
            cls = model(**enc).last_hidden_state[:, 0]
        out.append(F.normalize(cls, p=2, dim=1).cpu().numpy())
    return np.vstack(out)

descs = []
for path in SFT:
    for line in open(path):
        r = json.loads(line)
        for m in r["messages"]:
            if m["role"] == "assistant":
                descs += re.findall(r"\[image: ([^\]]+)\]", m["content"])
descs = sorted(set(descs))
print(f"{len(descs)} unique SFT tag descriptions, {len(DECOYS)} decoys")

def top1(qs):
    sims = qs @ vecs_f.T  # qs unit-norm; corpus ~unit-norm → cosine
    idx = sims.argmax(axis=1)
    return idx, sims[np.arange(len(qs)), idx]

ti, tc = top1(encode(descs))
di, dc = top1(encode(DECOYS))

def dist(name, c):
    q = np.percentile(c, [1, 5, 25, 50, 75, 95, 99])
    print(f"{name}: n={len(c)} min={c.min():.3f} p1={q[0]:.3f} p5={q[1]:.3f} "
          f"p25={q[2]:.3f} p50={q[3]:.3f} p75={q[4]:.3f} p95={q[5]:.3f} p99={q[6]:.3f} max={c.max():.3f}")

dist("SFT true-positive top-1 cosine", tc)
dist("decoy            top-1 cosine", dc)
print("\ndecoy top-1 matches (should all be below the floor):")
for d, i, c in zip(DECOYS, di, dc):
    print(f"  {c:.3f}  {meta['slugs'][i]:40s} <- {d}")
print("\nlowest-cosine true positives (floor must sit below most of these):")
order = tc.argsort()
for k in order[:12]:
    print(f"  {tc[k]:.3f}  {meta['slugs'][ti[k]]:40s} <- {descs[k][:70]}")
# the t-rex acid test
q = encode(["a t-rex dinosaur", "tyrannosaurus rex", "isang dinosaur na t-rex"])
qi, qc = top1(q)
print("\nt-rex acid test:")
for t, i, c in zip(["a t-rex dinosaur", "tyrannosaurus rex", "isang dinosaur na t-rex (tl)"], qi, qc):
    print(f"  {c:.3f}  {meta['slugs'][i]:40s} <- {t}")
