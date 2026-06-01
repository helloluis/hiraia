#!/usr/bin/env python3
"""Normalize harvested source files: convert literal \\n escapes to real
newlines, strip stray markdown fences, collapse excess blank lines.
Only touches files we created this run (by checking the Retrieved: stamp)."""
import os, re, glob

SRC = "/Users/luis/Code/hiraia/finetuning/datasets/bisaya/sources"
changed = []
for path in glob.glob(os.path.join(SRC, "*.txt")):
    raw = open(path, encoding="utf-8").read()
    if "Retrieved: 2026-05-31" not in raw:
        continue  # leave pre-existing files alone
    new = raw.replace("\\n", "\n")
    new = re.sub(r"\n?```\s*$", "\n", new)        # stray closing fence
    new = re.sub(r"[ \t]+\n", "\n", new)           # trailing whitespace
    new = re.sub(r"\n{3,}", "\n\n", new)           # collapse blank runs
    new = new.rstrip() + "\n"
    if new != raw:
        open(path, "w", encoding="utf-8").write(new)
        changed.append(os.path.basename(path))

with open("/Users/luis/Code/hiraia/finetuning/datasets/bisaya/.raw/normalize.out", "w") as f:
    f.write(f"normalized {len(changed)} files\n" + "\n".join(changed) + "\n")
print(f"normalized {len(changed)} files")
