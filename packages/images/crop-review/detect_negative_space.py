#!/usr/bin/env python3
"""detect_negative_space.py — rank factoid images by subject fill ratio.

Pen-and-ink engravings on white: threshold dark pixels, compute a noise-robust
ink bounding box, and report fill = bbox_area / frame_area. Low fill = subject
swimming in negative space = crop candidate. Outer 2% margin is zeroed first
to defeat thin frame/border rules.

Output: crop-review/fill-report.jsonl sorted ascending by fill.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

SRC = Path("/Users/luis/Code/hiraia/packages/images/factoid-webp")
OUT = Path("/Users/luis/Code/hiraia/packages/images/crop-review")
OUT.mkdir(exist_ok=True)
THRESH = 128          # gray < 128 counts as ink
MIN_ROW_INK = 0.004   # row/col must have >=0.4% ink pixels to count as content

def fill_report(path):
    a = np.asarray(Image.open(path).convert("L"))
    h, w = a.shape
    ink = a < THRESH
    m = int(0.02 * h)
    ink[:m, :] = ink[-m:, :] = ink[:, :m] = ink[:, -m:] = False
    rows = np.where(ink.sum(axis=1) >= MIN_ROW_INK * w)[0]
    cols = np.where(ink.sum(axis=0) >= MIN_ROW_INK * h)[0]
    if len(rows) == 0 or len(cols) == 0:
        return None
    t, b, l, r = rows[0], rows[-1], cols[0], cols[-1]
    fill = ((b - t + 1) * (r - l + 1)) / (h * w)
    return {"t": int(t), "b": int(b), "l": int(l), "r": int(r),
            "fill": round(fill, 4), "ink": round(float(ink.mean()), 4)}

def main():
    rows = []
    for p in sorted(SRC.glob("ffct-*.webp")):
        rep = fill_report(p)
        if rep:
            rep["id"] = p.stem
            rows.append(rep)
    rows.sort(key=lambda x: x["fill"])
    with open(OUT / "fill-report.jsonl", "w") as f:
        for x in rows:
            f.write(json.dumps(x) + "\n")
    n = len(rows)
    for cut in (0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85):
        c = sum(1 for x in rows if x["fill"] < cut)
        print(f"fill < {cut:.2f}: {c:6d}  ({100*c/n:.1f}%)")
    print(f"total {n}")

if __name__ == "__main__":
    main()
