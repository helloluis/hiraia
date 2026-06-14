#!/usr/bin/env python3
"""Assemble the v5 training files.

Per language:
  1. science-dialogue-v5.<lang>.jsonl — the 6 validated v5-work counterweight
     batches merged, each system-less fragment expanded with the production
     system prompt for its grade (same injection as validate-v4.py), "grade"
     dropped — plus the compact-<lang>.jsonl rows appended as-is (they are
     final {"messages"} rows matching the device's system-less compaction call).
  2. ../<dir>/train-v5.jsonl — train-v4.jsonl + science-dialogue-v5 rows.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
DATASETS = os.path.dirname(HERE)
V4WORK = os.path.join(DATASETS, "v4-work")
PROMPTS = json.load(open(os.path.join(V4WORK, "system-prompts.json")))

BATCHES = ["c-abstain", "c-no-confab", "c-brevity", "c-gibberish", "c-myth", "c-imgtag"]
LANGS = [
    # (batch-file prefix, prompts key, train dir)
    ("tagalog", "tagalog", "tagalog"),
    ("bisaya", "cebuano", "bisaya"),
]

for prefix, pkey, tdir in LANGS:
    merged = os.path.join(HERE, f"science-dialogue-v5.{prefix}.jsonl")
    n = 0
    with open(merged, "w") as out:
        for b in BATCHES:
            path = os.path.join(HERE, f"{prefix}-{b}.jsonl")
            for line in open(path):
                row = json.loads(line)
                ms = row["messages"]
                if ms[0]["role"] != "system":
                    g = str(row["grade"])
                    ms = [{"role": "system", "content": PROMPTS[pkey][g]}] + ms
                out.write(json.dumps({"messages": ms}, ensure_ascii=False) + "\n")
                n += 1
        # compaction rows ship system-less by design (device parity)
        for line in open(os.path.join(HERE, f"compact-{prefix}.jsonl")):
            out.write(line)
            n += 1
    print(f"{merged}: {n} rows")

    v4 = os.path.join(DATASETS, tdir, "train-v4.jsonl")
    v5 = os.path.join(DATASETS, tdir, "train-v5.jsonl")
    n4 = n5 = 0
    with open(v5, "w") as out:
        for line in open(v4):
            out.write(line if line.endswith("\n") else line + "\n")
            n4 += 1
        for line in open(merged):
            out.write(line)
            n5 += 1
    print(f"{v5}: {n4} v4 + {n5} v5 = {n4 + n5} rows")
