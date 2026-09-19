#!/usr/bin/env python3
"""gen_decisions.py — build per-agent decision files for the crop pilot.

Each decisions/agent-N.json contains ~10 candidates with the mechanical square
crop pre-filled. Agents review each image and either keep the box, adjust it,
or set "skip": true. apply_crops.py then executes the file.
"""
import json
from pathlib import Path

ROOT = Path("/Users/luis/Code/hiraia/packages/images")
REVIEW = ROOT / "crop-review"
DEC = REVIEW / "decisions"
DEC.mkdir(exist_ok=True)
ORIG_DIRS = [Path.home() / "Dropbox/Projects/hiraia/factoid-raw-png-2026-08" / d
             for d in ("asset-fixes", "round2-out-final", "round2-qwen-fallback", "round3")]
PAD = 1.12
N_AGENTS = 3

def find_original(stem):
    for d in ORIG_DIRS:
        p = d / f"{stem}.png"
        if p.exists():
            return p
    return None

def square_crop(rep, W, H):
    t = rep["t"] / 512.0 * H
    b = rep["b"] / 512.0 * H
    l = rep["l"] / 512.0 * W
    r = rep["r"] / 512.0 * W
    side = min(max(b - t, r - l) * PAD, H, W)
    cy, cx = (t + b) / 2, (l + r) / 2
    y0 = int(min(max(cy - side / 2, 0), H - side))
    x0 = int(min(max(cx - side / 2, 0), W - side))
    return [x0, y0, x0 + int(side), y0 + int(side)]

def main():
    from PIL import Image
    cands = []
    for line in open(REVIEW / "fill-report.jsonl"):
        x = json.loads(line)
        if x["fill"] >= 0.35:
            break
        bw, bh = x["r"] - x["l"] + 1, x["b"] - x["t"] + 1
        if not (0.4 <= bw / bh <= 2.5):
            continue
        orig = find_original(x["id"])
        if orig:
            cands.append((x, orig))
    items = []
    for rep, orig in cands:
        with Image.open(orig) as im:
            W, H = im.size
        items.append({"id": rep["id"], "orig": str(orig), "fill": rep["fill"],
                      "box": square_crop(rep, W, H), "skip": False})
    buckets = [items[i::N_AGENTS] for i in range(N_AGENTS)]
    for n, b in enumerate(buckets):
        path = DEC / f"agent-{n}.json"
        path.write_text(json.dumps({"items": b}, indent=1))
        print(f"{path}: {len(b)} items")
    print(f"total {len(items)}")

if __name__ == "__main__":
    main()
