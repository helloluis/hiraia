#!/usr/bin/env python3
"""Assemble the v4 training files.

Per language:
  1. science-dialogue-v4.<lang>.jsonl — the 8 validated v4-work batches merged,
     each system-less fragment expanded with the production system prompt for
     its grade (same injection as validate-v4.py), "grade" key dropped so rows
     match the train-v3 shape ({"messages": [...]}).
  2. ../<dir>/train-v4.jsonl — train-v3.jsonl + science-dialogue-v4 rows.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
DATASETS = os.path.dirname(HERE)
PROMPTS = json.load(open(os.path.join(HERE, "system-prompts.json")))

BATCHES = ["a-pos-1", "a-pos-2", "a-neg", "b1", "b2", "b3", "b4", "b5"]
LANGS = [
    # (batch-file prefix, prompts key, train dir)
    ("tagalog", "tagalog", "tagalog"),
    ("bisaya", "cebuano", "bisaya"),
]

for prefix, pkey, tdir in LANGS:
    merged = os.path.join(HERE, f"science-dialogue-v4.{prefix}.jsonl")
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
    print(f"{merged}: {n} rows")

    v3 = os.path.join(DATASETS, tdir, "train-v3.jsonl")
    v4 = os.path.join(DATASETS, tdir, "train-v4.jsonl")
    n3 = n4 = 0
    with open(v4, "w") as out:
        for line in open(v3):
            out.write(line if line.endswith("\n") else line + "\n")
            n3 += 1
        for line in open(merged):
            out.write(line)
            n4 += 1
    print(f"{v4}: {n3} v3 + {n4} v4 = {n3 + n4} rows")
