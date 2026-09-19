#!/usr/bin/env python3
"""apply_crops.py — execute a decision file: crop originals, emit 512 grayscale
WebP q80 masters into crop-review/staged/. Masters in factoid-webp/ are NOT
touched; a human verifies staged output before swap-in.

Usage: python3 apply_crops.py decisions/agent-N.json
"""
import json
import sys
from pathlib import Path

from PIL import Image

STAGED = Path("/Users/luis/Code/hiraia/packages/images/crop-review/staged")
STAGED.mkdir(exist_ok=True)

def main(path):
    items = json.loads(Path(path).read_text())["items"]
    done = skipped = 0
    for it in items:
        if it.get("skip"):
            skipped += 1
            print(f"SKIP {it['id']}")
            continue
        x0, y0, x1, y1 = it["box"]
        img = Image.open(it["orig"]).convert("L")
        img.crop((x0, y0, x1, y1)).resize((512, 512), Image.LANCZOS).save(
            STAGED / f"{it['id']}.webp", "WEBP", quality=80)
        done += 1
        print(f"CROP {it['id']} box={it['box']}")
    print(f"done={done} skipped={skipped} -> {STAGED}")

if __name__ == "__main__":
    main(sys.argv[1])
