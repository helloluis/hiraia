#!/usr/bin/env python3
"""verify_sheet.py — before/after contact sheet of staged crops vs current
factoid-webp masters, for human review before swap-in."""
from pathlib import Path

from PIL import Image

ROOT = Path("/Users/luis/Code/hiraia/packages/images")
STAGED = ROOT / "crop-review/staged"
MASTERS = ROOT / "factoid-webp"

pairs = []
for p in sorted(STAGED.glob("ffct-*.webp")):
    before = Image.open(MASTERS / p.name).convert("L").resize((256, 256))
    after = Image.open(p).convert("L").resize((256, 256))
    pairs.append((p.stem, before, after))

sheet = Image.new("L", (2 * 256, len(pairs) * 256), 255)
for i, (_, b, a) in enumerate(pairs):
    sheet.paste(b, (0, i * 256))
    sheet.paste(a, (256, i * 256))
out = ROOT / "crop-review/verify-sheet.png"
sheet.save(out)
print(f"{len(pairs)} pairs -> {out}")
print(" ".join(s for s, _, _ in pairs))
