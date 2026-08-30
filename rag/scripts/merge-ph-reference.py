#!/usr/bin/env python3
"""Merge rag/bank/ph-reference.generated.jsonl into the fact bank
(rag/bank/science-facts.jsonl), idempotently.

Re-running is safe: every existing PH_CIVICS/PH_GEOGRAPHY line is dropped first,
then the freshly generated block is appended. So the pipeline is:

  node rag/scripts/gen-ph-reference.mjs
  python3 rag/scripts/merge-ph-reference.py
  python3 rag/pipeline/build-facts-db.py   # rebuild the fact tables the app ships
"""
import json, os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # rag/
BANK = os.path.join(HERE, "bank", "science-facts.jsonl")
PH = os.path.join(HERE, "bank", "ph-reference.generated.jsonl")
PH_DOMAINS = {"PH_CIVICS", "PH_GEOGRAPHY"}

bank = [json.loads(l) for l in open(BANK, encoding="utf-8") if l.strip()]
ph = [json.loads(l) for l in open(PH, encoding="utf-8") if l.strip()]

kept = [r for r in bank if r.get("domain") not in PH_DOMAINS]
dropped = len(bank) - len(kept)
merged = kept + ph

# sanity: unique ids
ids = [r["id"] for r in merged]
dups = {i for i in ids if ids.count(i) > 1}
assert not dups, f"DUPLICATE IDS after merge: {sorted(dups)[:10]}"

with open(BANK, "w", encoding="utf-8") as f:
    for r in merged:
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

print(f"bank: {len(kept)} non-PH kept (dropped {dropped} old PH) + {len(ph)} PH = {len(merged)} total")
