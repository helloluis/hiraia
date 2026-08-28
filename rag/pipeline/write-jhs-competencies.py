#!/usr/bin/env python3
"""Assemble rag/sources/curriculum-guides/matatag-jhs-competencies.json (Grades 7-10) from the
verified per-grade extractions recorded in a workflow journal (verify agents return corrected_quarters).
Usage: write-jhs-competencies.py <journal.jsonl>. Re-run as more grades verify; refuses to write a partial
file unless --partial is given."""
import json, sys, re
ROOT = __file__.rsplit("/rag/", 1)[0]
journal, partial = sys.argv[1], "--partial" in sys.argv
elem = json.load(open(f"{ROOT}/rag/sources/curriculum-guides/matatag-elementary-competencies.json"))
verified = {}
for l in open(journal):
    r = json.loads(l)
    x = r.get("result")
    if r.get("type") == "result" and isinstance(x, dict) and "corrected_quarters" in x: verified[x["grade"]] = x
missing = [g for g in (7, 8, 9, 10) if g not in verified]
print("verified grades:", sorted(verified), "| missing:", missing)
if missing and not partial: sys.exit("not all grades verified; pass --partial to write anyway")
quarters, problems = [], []
for g in sorted(verified):
    v = verified[g]
    for q in sorted(v["corrected_quarters"], key=lambda q: q["quarter"]):
        codes = [c["code"] for c in q["competencies"]]
        if len(set(codes)) != len(codes): problems.append(f"G{g}Q{q['quarter']} duplicate codes")
        for c in q["competencies"]:
            if not re.fullmatch(rf"G{g}-[MLFE]-\d+", c["code"]): problems.append(f"bad code {c['code']}")
            if len(c["anchors"]) < 3: problems.append(f"{c['code']} only {len(c['anchors'])} anchors")
        quarters.append(dict(grade=g, quarter=q["quarter"], title=q["title"], domain=q["domain"], content=q["content"], competencies=q["competencies"]))
out = dict(source=elem["source"], scope="Junior High School (Grades 7-10). One domain per quarter; the domain ORDER rotates per grade from Grade 8 (CG p.27). Extracted per grade by an LLM agent and adversarially verified against the PDF by a second agent (2026-08-27).",
           domain_map=elem["domain_map"], verification={g: dict(verdict=v["verdict"], changes=v["changes"]) for g, v in verified.items()}, quarters=quarters)
path = f"{ROOT}/rag/sources/curriculum-guides/matatag-jhs-competencies.json"
json.dump(out, open(path, "w"), indent=1, ensure_ascii=False)
n = sum(len(q["competencies"]) for q in quarters)
print(f"wrote {path}: {len(quarters)} quarter blocks, {n} competencies; per grade:", {g: sum(len(q['competencies']) for q in quarters if q['grade'] == g) for g in sorted(verified)})
print("problems:", problems or "none")
for q in quarters[:1]: print("sample:", q["grade"], q["quarter"], q["domain"], "|", q["competencies"][0]["code"], q["competencies"][0]["text"][:90], "| anchors:", q["competencies"][0]["anchors"][:5])
