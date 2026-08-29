#!/usr/bin/env python3
"""How much illustrated supply each grade×quarter cell would have if the engravings were wired into the
pool: counts labelled factoids (rag/pipeline/competency-labels/lab-*.jsonl, v2 multi-label, every cell a
card serves) that are (a) already in the pool, (b) not in the pool but have an engraving
(packages/images/factoid-webp/<id>.webp), (c) neither. Confidence >= 2 only."""
import glob, json, os, collections, re
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
comp = {}
for f in sorted(glob.glob(f"{ROOT}/rag/sources/curriculum-guides/matatag-*-competencies.json")):
    for q in json.load(open(f))["quarters"]:
        for c in q["competencies"]: comp[c["code"]] = (q["grade"], q["quarter"])
pool = {c["id"] for c in json.load(open(f"{ROOT}/packages/mobile/src/generated/cardsPool.generated.json"))["cards"]}
webp = {os.path.basename(p)[:-5] for p in glob.glob(f"{ROOT}/packages/images/factoid-webp/*.webp")}
cells = collections.defaultdict(lambda: collections.Counter()); n = 0
for fn in glob.glob(f"{ROOT}/rag/pipeline/competency-labels/lab-*.jsonl"):
    for l in open(fn):
        o = json.loads(l); n += 1
        if int(o.get("confidence", 2)) < 2: continue
        kind = "pool" if o["id"] in pool else ("engraving" if o["id"] in webp else "none")
        for cell in {comp[c] for c in o["codes"] if c in comp}: cells[cell][kind] += 1
print(f"labels read {n} | engravings on disk {len(webp)}")
print("cell        pool  +engraving  (no image)   → illustrated if wired")
for g in range(3, 11):
    for q in range(1, 5):
        c = cells[(g, q)]; print(f"  G{g:<2} Q{q}  {c['pool']:5d}  {c['engraving']:9d}  {c['none']:9d}   → {c['pool'] + c['engraving']:5d}")
jhs = sum(cells[(g, q)]["engraving"] for g in range(7, 11) for q in range(1, 5)); el = sum(cells[(g, q)]["engraving"] for g in range(3, 7) for q in range(1, 5))
print(f"engraving-backed cards not yet in the pool: elementary cells {el}, JHS cells {jhs} (a card counts once per cell it serves)")
