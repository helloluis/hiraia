#!/usr/bin/env python
"""Semantic MATATAG tagger: LaBSE cosine (raw CLS, L2-normalised — the device recipe) between a
fact and every competency, hard-filtered to the card's own domain. Replaces the lexical anchor
tagger, whose judged precision was 17% strict / 50% lenient even in its high-confidence band.
Usage: finetuning/.convert-venv/bin/python rag/pipeline/tag-curriculum-labse.py [--variant text|anchors] [--bank]
Writes rag/bank/curriculum-tags.labse.json (same schema as curriculum-tags.json; score = cosine, confidence = margin).
"""
import argparse, glob, json, os, sys, time
import numpy as np, torch, torch.nn.functional as F
from transformers import AutoTokenizer, AutoModel
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ap = argparse.ArgumentParser(); ap.add_argument("--variant", default="anchors", choices=["text", "anchors"]); ap.add_argument("--bank", action="store_true"); ap.add_argument("--out", default=None)
a = ap.parse_args()
dev = "mps" if torch.backends.mps.is_available() else "cpu"
tok = AutoTokenizer.from_pretrained("sentence-transformers/LaBSE"); model = AutoModel.from_pretrained("sentence-transformers/LaBSE").to(dev).eval()
@torch.no_grad()
def embed(texts, bs=64):
    out = []
    for i in range(0, len(texts), bs):
        b = tok(texts[i:i+bs], padding=True, truncation=True, max_length=128, return_tensors="pt").to(dev)
        out.append(F.normalize(model(**b).last_hidden_state[:, 0], dim=-1).float().cpu().numpy())
    return np.concatenate(out)
comps = []
for f in sorted(glob.glob(f"{ROOT}/rag/sources/curriculum-guides/matatag-*-competencies.json")):
    for q in json.load(open(f))["quarters"]:
        for c in q["competencies"]:
            t = f'{q["title"]}: {c["text"]}' + (f'. Keywords: {", ".join(c.get("anchors", []))}' if a.variant == "anchors" else "")
            comps.append(dict(code=c["code"], grade=q["grade"], quarter=q["quarter"], domain=q["domain"], text=t))
CE = embed([c["text"] for c in comps]); print(f"competencies {len(comps)} ({a.variant}) on {dev}", file=sys.stderr)
def tag(items, key):
    t0 = time.time(); E = embed([x[key] for x in items]); S = E @ CE.T
    dom = np.array([c["domain"] for c in comps]); res = {}
    for i, x in enumerate(items):
        mask = dom == x["domain"] if x["domain"] in set(dom) else np.ones(len(comps), bool)
        s = np.where(mask, S[i], -1.0); o = np.argsort(-s); j, k = o[0], o[1]
        c = comps[j]; res[x["id"]] = dict(competency=c["code"], grade=c["grade"], quarter=c["quarter"], domain=c["domain"], score=round(float(s[j]), 4), confidence=round(float(s[j] - s[k]), 4), runner_up=comps[k]["code"])
    print(f"tagged {len(items)} in {time.time()-t0:.0f}s", file=sys.stderr); return res
pool = json.load(open(f"{ROOT}/packages/mobile/src/generated/cardsPool.generated.json"))["cards"]
out = dict(scheme=f"LaBSE CLS cosine fact.en vs '{a.variant}' competency text, domain hard-filter; score=cosine, confidence=top1-top2 margin", factoids=tag([dict(id=c["id"], domain=c["domain"], t=c["fact"]["en"]) for c in pool], "t"), bank={})
if a.bank:
    bank = [json.loads(l) for l in open(f"{ROOT}/rag/bank/science-facts.jsonl", encoding="utf-8")]
    out["bank"] = tag([dict(id=b["id"], domain=b.get("domain", ""), t=b["fact"]["en"]) for b in bank], "t")
json.dump(out, open(a.out or f"{ROOT}/rag/bank/curriculum-tags.labse.json", "w")); print("wrote", a.out or "curriculum-tags.labse.json", file=sys.stderr)
