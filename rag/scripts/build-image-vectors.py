#!/usr/bin/env python3
"""Build the bundled IMAGE-TAG retrieval blob: one LaBSE raw-CLS vector per
bundled 512x512 PNG (the 4228-slug IMAGE_MAP), so the tutor's free-form
`[image: <english desc>]` control token can be resolved on-device to a real
bundled asset (brute-force cosine over ~4k vectors — sub-ms).

Embed text per slug (English-anchored, like the SFT tag descriptions):
  - curated catalog entry (packages/images/index.json, 414 assets):
      "<name>. <caption.en>"           (richest; the SFT rows were grounded here)
  - gemini-queue prompt (everything else):
      "<name>. <scene part of prompt>" (style boilerplate stripped)

Same embedder + packing discipline as build-vectors.py (LaBSE raw CLS, no dense
head — parity 0.99999 vs the on-device qvac GGMLBert GGUF; L2-normalized, int8).

Output (packages/mobile/assets/rag/, slug order == vector order):
  image-vectors-labse.i8.bin    int8, count*dims
  image-vectors-labse.meta.json {model, dims, scale, count, slugs:[...]}

  finetuning/.convert-venv/bin/python rag/scripts/build-image-vectors.py
"""
import json, os, re, glob
import numpy as np, torch, torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # rag/
ROOT = os.path.dirname(HERE)
IMAGE_MAP = os.path.join(ROOT, "packages", "mobile", "src", "generated", "imageMap.ts")
CATALOG = os.path.join(ROOT, "packages", "images", "index.json")
PROMPTS = os.path.join(ROOT, "packages", "images", "gemini-queue", "prompts", "*.json")
BIN = os.path.join(ROOT, "packages", "mobile", "assets", "rag", "image-vectors-labse.i8.bin")
META = os.path.join(ROOT, "packages", "mobile", "assets", "rag", "image-vectors-labse.meta.json")
MODEL = "sentence-transformers/LaBSE"
# Everything after this marker in a gemini prompt is style boilerplate, not content.
# Variants seen in the queue: "Black-and-white hand-drawn line…" (4222),
# "Black-and-white line-art sketch…" (170), "black-and-white pixel blocks…" (1).
STYLE_MARKER = re.compile(r"\s*[Bb]lack-and-white (hand-drawn|line-art|pixel)")

# 1) the slug set actually bundled in the APK (source of truth: the generated map)
slugs = re.findall(r'"([^"]+)": require\(', open(IMAGE_MAP, encoding="utf-8").read())
assert len(slugs) == len(set(slugs)), "duplicate slugs in IMAGE_MAP"

# 2) embed text per slug: curated caption first, gemini scene prompt fallback
curated = {a["id"]: f"{a['name']}. {a['caption']['en']}"
           for a in json.load(open(CATALOG, encoding="utf-8"))["assets"]}
prompts = {}
for f in glob.glob(PROMPTS):
    for img in json.load(open(f, encoding="utf-8"))["images"]:
        scene = STYLE_MARKER.split(img["prompt"], 1)[0].strip().rstrip(".")
        # drop the generation preamble ("Full illustration of X:", "A simple illustration of a scene:")
        scene = re.sub(r"^(Full illustration of [^:]+:|A simple illustration of a scene:)\s*", "", scene)
        prompts[img["id"]] = f"{img['name']}. {scene}"

texts, missing = [], []
for s in slugs:
    t = curated.get(s) or prompts.get(s)
    if t is None:
        missing.append(s)
        t = s.replace("-", " ")  # last resort: the slug itself
    texts.append(t)
if missing:
    print(f"WARN: {len(missing)} slugs had no caption/prompt metadata (embedded slug text): {missing[:10]}")

# 3) embed (identical to build-vectors.py: raw CLS, no dense, L2-normalized)
dev = "mps" if torch.backends.mps.is_available() else "cpu"
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModel.from_pretrained(MODEL).to(dev).eval()

def encode(batch_texts, bs=64):
    out = []
    for i in range(0, len(batch_texts), bs):
        enc = tok(batch_texts[i:i+bs], return_tensors="pt", padding=True,
                  truncation=True, max_length=192).to(dev)
        with torch.no_grad():
            cls = model(**enc).last_hidden_state[:, 0]
        out.append(F.normalize(cls, p=2, dim=1).cpu().numpy())
        if (i // bs) % 10 == 0:
            print(f"  {i+len(batch_texts[i:i+bs])}/{len(batch_texts)}", flush=True)
    return np.vstack(out).astype(np.float32)

mat = encode(texts)
scale = float(np.abs(mat).max()) / 127.0
with open(BIN, "wb") as f:
    f.write(np.round(mat / scale).astype(np.int8).tobytes())
meta = {"model": MODEL + " (raw-CLS, no dense)", "dims": int(mat.shape[1]),
        "scale": scale, "count": len(slugs), "slugs": slugs}
json.dump(meta, open(META, "w"))
print(f"\nwrote {BIN}  ({os.path.getsize(BIN)/1e6:.1f} MB)")
print(f"wrote {META}: {len(slugs)} slugs, dims {meta['dims']}, scale {scale:.6f}")
