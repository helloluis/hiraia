#!/usr/bin/env python3
"""pick_samples.py — select 12 crop candidates with local originals and render
before/after pairs + a contact sheet for human review.

Crop rule: square crop = max(bbox_w, bbox_h) * 1.12 side, centered on the ink
bbox, clamped to the frame; then resized to 512 grayscale (the master format).
Detection bbox is in 512-space and is scaled up to the original's dimensions.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path("/Users/luis/Code/hiraia/packages/images")
REVIEW = ROOT / "crop-review"
PAIRS = REVIEW / "pairs"
PAIRS.mkdir(exist_ok=True)
ORIG_DIRS = [Path.home() / "Dropbox/Projects/hiraia/factoid-raw-png-2026-08" / d
             for d in ("asset-fixes", "round2-out-final", "round2-qwen-fallback", "round3")]
PAD = 1.12

def find_original(stem):
    for d in ORIG_DIRS:
        p = d / f"{stem}.png"
        if p.exists():
            return p
    return None

def square_crop(rep, W, H):
    s = lambda v: v / 512.0  # noqa: E731 — detection coords are 512-space
    t, b, l, r = s(rep["t"]) * H, s(rep["b"]) * H, s(rep["l"]) * W, s(rep["r"]) * W
    side = max(b - t, r - l) * PAD
    cy, cx = (t + b) / 2, (l + r) / 2
    side = min(side, H, W)
    y0 = int(min(max(cy - side / 2, 0), H - side))
    x0 = int(min(max(cx - side / 2, 0), W - side))
    return (x0, y0, x0 + int(side), y0 + int(side))

def main():
    cands = []
    for line in open(REVIEW / "fill-report.jsonl"):
        x = json.loads(line)
        if x["fill"] >= 0.35:
            break
        bw, bh = x["r"] - x["l"] + 1, x["b"] - x["t"] + 1
        aspect = bw / bh
        # extreme-aspect subjects (rulers, thermometers) can't be helped by a
        # square crop — skip them; true candidates are small in BOTH dims
        if not (0.4 <= aspect <= 2.5):
            continue
        orig = find_original(x["id"])
        if orig:
            cands.append((x, orig))
    print(f"candidates fill<0.35 with originals: {len(cands)}")
    worst = cands[:8]
    mild = cands[len(cands) // 2 - 2:len(cands) // 2 + 2] if len(cands) > 12 else []
    samples = worst + mild
    thumbs = []
    for i, (rep, orig) in enumerate(samples):
        img = Image.open(orig).convert("L")
        W, H = img.size
        box = square_crop(rep, W, H)
        before = img.resize((512, 512), Image.LANCZOS)
        after = img.crop(box).resize((512, 512), Image.LANCZOS)
        before.save(PAIRS / f"{i+1:02d}_{rep['id']}_before.png")
        after.save(PAIRS / f"{i+1:02d}_{rep['id']}_after.png")
        thumbs.append((rep, box, W, before, after))
        print(f"{i+1:02d} {rep['id']} fill={rep['fill']:.3f} crop={box} "
              f"(side {box[2]-box[0]}px of {W}px)")
    # contact sheet: rows = samples, cols = before|after, 256px thumbs
    n = len(thumbs)
    sheet = Image.new("L", (2 * 256, n * 256), 255)
    for i, (_, _, _, before, after) in enumerate(thumbs):
        sheet.paste(before.resize((256, 256)), (0, i * 256))
        sheet.paste(after.resize((256, 256)), (256, i * 256))
    sheet.save(REVIEW / "contact-sheet.png")
    print(f"contact sheet -> {REVIEW/'contact-sheet.png'}")

if __name__ == "__main__":
    main()
