#!/usr/bin/env python3
"""Summarize all harvested Bisaya source files into a manifest table."""
import os, glob, json

SRC = "/Users/luis/Code/hiraia/finetuning/datasets/bisaya/sources"
rows = []
for path in sorted(glob.glob(os.path.join(SRC, "*.txt"))):
    raw = open(path, encoding="utf-8").read()
    lines = raw.splitlines()
    title = lines[0].lstrip("# ").strip() if lines else ""
    src = next((l[8:].strip() for l in lines if l.startswith("Source:")), "")
    new = "Retrieved: 2026-05-31" in raw
    # body word count = everything after the header block, before ## Notes
    body = raw.split("\n\n", 1)[-1].split("## Notes")[0]
    words = len(body.split())
    rows.append({"file": os.path.basename(path), "title": title,
                 "words": words, "new_this_run": new, "source": src})

rows.sort(key=lambda r: (not r["new_this_run"], -r["words"]))
total_new = sum(r["words"] for r in rows if r["new_this_run"])
out = {"total_files": len(rows),
       "new_this_run": sum(1 for r in rows if r["new_this_run"]),
       "new_words": total_new, "rows": rows}
with open("/Users/luis/Code/hiraia/finetuning/datasets/bisaya/.raw/index.json", "w") as f:
    json.dump(out, f, indent=1)
print(json.dumps({k: out[k] for k in ("total_files","new_this_run","new_words")}))
