#!/usr/bin/env python3
"""k3_sidecar.py — one batch of the K3 synthetic-Cebuano sidecar.

Usage:  /tmp/sailcraft-local/.venv/bin/python k3_sidecar.py <candidates.jsonl>

Input: a JSONL file of candidate docs, one {"text": "..."} per line (written by
the in-session K3 agent). This script then:
  1. QC's each candidate (len>=100, fastText ceb>=0.70, tl-bleed <=0.04)
  2. assigns sequential src_ids (k3gen:<max+1 ...>) read from the local kept file
  3. appends kept rows to synth-ceb/docs_ceb_k3.jsonl and ALL rows (with QC
     fields + verdict) to synth-ceb/docs_ceb_k3_all.jsonl
  4. POSTs just this batch to https://hiraia.b11.dev/admin/api/synth-k3
  5. prints a one-line summary
"""
import json, sys, urllib.request
from pathlib import Path

sys.path.insert(0, "/Users/luis/Code/hiraia/finetuning/cpt")
from gen_ceb_ox import tl_bleed

OUT = Path("/Users/luis/Code/hiraia/finetuning/cpt/synth-ceb")
KEPT = OUT / "docs_ceb_k3.jsonl"
AUDIT = OUT / "docs_ceb_k3_all.jsonl"
LID = "/Users/luis/Code/hiraia/finetuning/cpt/lm_resource/lid.176.bin"
ENDPOINT = "https://hiraia.b11.dev/admin/api/synth-k3"
# telemetry ingest token (same class as the one documented in SIDECAR-GROK.md)
TOKEN = "NlWCqd8zN_T_AjskYCjxOiuziSLHjRP5"

def next_seq(tag):
    top = 0
    if KEPT.exists():
        prefix = f"k3gen:{tag}:" if tag else "k3gen:"
        for line in open(KEPT, encoding="utf-8"):
            try:
                sid = json.loads(line)["src_id"]
                if sid.startswith(prefix):
                    top = max(top, int(sid.rsplit(":", 1)[1]))
            except Exception:
                pass
    return top + 1

def main(path, tag=""):
    import fasttext
    fasttext.FastText.eprint = lambda *a, **k: None
    lid = fasttext.load_model(LID)

    seq = next_seq(tag)
    kept_rows, audit_rows = [], []
    for line in open(path, encoding="utf-8"):
        if not line.strip():
            continue
        text = json.loads(line)["text"].strip()
        sid = f"k3gen:{tag + ':' if tag else ''}{seq}"
        seq += 1
        pred = lid.predict(text.replace("\n", " ")[:2000])
        lang, conf = pred[0][0].replace("__label__", ""), float(pred[1][0])
        bleed = tl_bleed(text)
        verdict = "ok" if (len(text) >= 100 and lang == "ceb"
                           and conf >= 0.70 and bleed <= 0.04) else \
                  ("lid" if lang != "ceb" or conf < 0.70 else "bleed")
        audit_rows.append({"text": text, "src": "k3gen", "src_id": sid,
                           "lid": lang, "lid_conf": round(conf, 3),
                           "bleed": round(bleed, 4), "verdict": verdict})
        if verdict == "ok":
            kept_rows.append({"text": text, "src": "k3gen", "src_id": sid})

    with open(KEPT, "a", encoding="utf-8") as f:
        for d in kept_rows:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")
    with open(AUDIT, "a", encoding="utf-8") as f:
        for d in audit_rows:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")

    body = json.dumps({"kept": kept_rows, "audit": audit_rows}).encode()
    req = urllib.request.Request(ENDPOINT, data=body,
                                 headers={"Content-Type": "application/json",
                                          "X-Token": TOKEN})
    resp = json.load(urllib.request.urlopen(req, timeout=90))
    print(f"[k3] batch: {len(audit_rows)} candidates, {len(kept_rows)} kept "
          f"({kept_rows[0]['src_id'] if kept_rows else '-'}"
          f"..{kept_rows[-1]['src_id'] if kept_rows else '-'}) -> push {resp}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "")
