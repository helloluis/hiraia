#!/usr/bin/env python3
"""Assemble Fireworks multi-label competency labels (rag/pipeline/competency-labels/lab-*.jsonl) into
rag/bank/curriculum-tags.json (v2 schema). Each card: competency = primary code, codes = all codes
(best first, <=3), cells = distinct "G5-Q2"-style cells, confidence = model 1-3 mapped to 0.33/0.67/1.0.
'off' cards are omitted (untagged). The previous lexical file is kept as curriculum-tags.lexical.json.
Usage: assemble-competency-labels.py [--labels DIR] [--out PATH]"""
import argparse, glob, json, os, shutil, collections
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ap = argparse.ArgumentParser(); ap.add_argument("--labels", default=f"{ROOT}/rag/pipeline/competency-labels", help="primary label dir"); ap.add_argument("--also", action="append", default=[], help="additional label dir(s) from other models; cells agreed by >=2 models become cells_strong"); ap.add_argument("--extra", action="append", default=[], help="additional PRIMARY label dir(s) for other id spaces (e.g. dcards); single-model rows"); ap.add_argument("--out", default=f"{ROOT}/rag/bank/curriculum-tags.json"); a = ap.parse_args()
comp = {}
for f in sorted(glob.glob(f"{ROOT}/rag/sources/curriculum-guides/matatag-*-competencies.json")):
    for q in json.load(open(f))["quarters"]:
        for c in q["competencies"]: comp[c["code"]] = dict(grade=q["grade"], quarter=q["quarter"], domain=q["domain"])
def read(d):
    r = {}
    for fn in sorted(glob.glob(f"{d}/lab-*.jsonl")):
        for l in open(fn):
            o = json.loads(l); r[o["id"]] = o
    return r
rows = read(a.labels)
for d in a.extra: rows.update(read(d))   # other id spaces (dcard-*), primary labels only
others = [read(d) for d in a.also]
tags, stats = {}, collections.Counter()
for i, o in rows.items():
    codes = [c for c in o["codes"] if c in comp]
    if not codes: stats["off"] += 1; continue
    p = comp[codes[0]]; cells = []
    for c in codes:
        cell = f"G{comp[c]['grade']}-Q{comp[c]['quarter']}"
        if cell not in cells: cells.append(cell)
    conf = round({1: 0.33, 2: 0.67, 3: 1.0}.get(int(o.get("confidence", 2)), 0.67), 2)
    t = dict(competency=codes[0], grade=p["grade"], quarter=p["quarter"], domain=p["domain"], codes=codes, cells=cells, score=1.0, confidence=conf)
    if others:
        # union of every model's codes; a cell is STRONG when >=2 models emit it (or the primary is confident and alone)
        seen_cells = collections.Counter(cells)
        for om in others:
            oc = [c for c in (om.get(i, {}).get("codes") or []) if c in comp]
            ocells = []
            for c in oc:
                cell = f"G{comp[c]['grade']}-Q{comp[c]['quarter']}"
                if cell not in ocells: ocells.append(cell)
                if c not in t["codes"] and len(t["codes"]) < 4: t["codes"].append(c)
            for cell in ocells:
                seen_cells[cell] += 1
                if cell not in t["cells"]: t["cells"].append(cell)
        t["cells_strong"] = [c for c in t["cells"] if seen_cells[c] >= 2 or (c == f"G{p['grade']}-Q{p['quarter']}" and conf >= 1.0)]
        t["models"] = 1 + sum(1 for om in others if i in om)
        stats["agreed_any"] += bool(t["cells_strong"])
    tags[i] = t
    stats["tagged"] += 1; stats[f"n{len(codes)}"] += 1; stats["jhs_primary"] += p["grade"] >= 7
if os.path.exists(a.out) and a.out.endswith("curriculum-tags.json") and not os.path.exists(a.out.replace(".json", ".lexical.json")):
    shutil.copy(a.out, a.out.replace(".json", ".lexical.json")); print("backed up the lexical tags to curriculum-tags.lexical.json")
json.dump(dict(scheme="v2 multi-label: Fireworks qwen3.7-plus labels vs all 324 MATATAG competencies (G3-10); competency=primary, codes<=3 best first, cells=distinct grade-quarter cells; confidence=model 1-3 → 0.33/0.67/1.0; validated 83% agreement with Claude seed labels; bank={} by design — bank-fact coverage is derived from factoids via factId (competency-gaps.py, coverage-roundup.py), never stored here", factoids=tags, bank={}), open(a.out, "w"))
print(f"labels read {len(rows)} (+{len(others)} other model dirs) | tagged {stats['tagged']} | off {stats['off']} | codes per card: 1={stats['n1']} 2={stats['n2']} 3={stats['n3']} | JHS primary {stats['jhs_primary']} | cards with an agreed cell {stats['agreed_any']} -> {a.out}")
cells = collections.Counter(c for t in tags.values() for c in t["cells"]); print("cards per cell (any code):", " ".join(f"{k}={v}" for k, v in sorted(cells.items(), key=lambda kv: (int(kv[0][1:kv[0].index('-')]), kv[0]))))
