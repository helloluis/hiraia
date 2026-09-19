#!/usr/bin/env python3
"""
ceb-lid.py — GlotLID (cis-lmu/glotlid) language metrics + filter for generated Cebuano.
Run with a venv pinned to numpy<2 (fasttext.predict breaks on numpy>=2). GlotLID
distinguishes ceb_Latn from tgl_Latn accurately. AUP-safe: `metrics` emits only aggregate
ratios/counts; `filter` writes a cleaned jsonl (kept = ceb_Latn, prob>=thresh), no text echoed.

Usage:
  python ceb-lid.py metrics out/ceb-shard-0.jsonl
  python ceb-lid.py filter  out/ceb-shard-0.jsonl out/ceb-shard-0.clean.jsonl
Env: LID_THRESH (default 0.50)
"""
import sys, json, os
from huggingface_hub import hf_hub_download
import fasttext

MODE = sys.argv[1]
INP  = sys.argv[2]
OUT  = sys.argv[3] if len(sys.argv) > 3 else None
THRESH = float(os.environ.get("LID_THRESH", "0.50"))

model = fasttext.load_model(hf_hub_download("cis-lmu/glotlid", "model.bin"))

def lid(text):
    t = " ".join(text.split())
    if not t:
        return ("none", 0.0)
    lab, prob = model.predict(t, k=1)
    return (lab[0].replace("__label__", ""), float(prob[0]))

n = 0
by = {"ceb": 0, "tgl": 0, "other": 0, "empty": 0}
kept = 0
toks_kept = 0
dups = 0
seen = set()
out_f = open(OUT, "w", encoding="utf-8") if MODE == "filter" else None
for ln in open(INP, encoding="utf-8"):
    ln = ln.strip()
    if not ln:
        continue
    try:
        r = json.loads(ln)
    except Exception:
        continue
    n += 1
    text = (r.get("text") or "").strip()
    if not text:
        by["empty"] += 1
        continue
    lab, prob = lid(text)
    fam = "ceb" if lab == "ceb_Latn" else ("tgl" if lab == "tgl_Latn" else "other")
    by[fam] += 1
    is_keep = (lab == "ceb_Latn" and prob >= THRESH)
    if is_keep:
        if MODE == "filter":
            key = text[:80]
            if key in seen:
                dups += 1; continue
            seen.add(key)
            out_f.write(ln + "\n")
        kept += 1
        toks_kept += r.get("ntok", 0)
if out_f:
    out_f.close()

den = max(1, n - by["empty"])
res = {
    "mode": MODE, "n": n, "empty": by["empty"],
    "ceb_ratio": round(by["ceb"] / den, 3),
    "tgl_drift_ratio": round(by["tgl"] / den, 3),
    "other_ratio": round(by["other"] / den, 3),
    "kept_ceb": kept, "kept_tok": toks_kept, "thresh": THRESH,
}
if MODE == "filter":
    res["dups_dropped"] = dups; res["out"] = OUT
print(json.dumps(res))
