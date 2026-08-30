#!/usr/bin/env python3
"""One writing brief per fact-able competency below its floor: competency text, kind/card_form, what the
feed already has for it (existing_facts_en, from the v2 tags — every card carrying the code), and the
target count (need × oversample: 3x for fact_able<=4, 1.6x otherwise). Reads rag/bank/competency-gaps.json
(quote its invocation) and curriculum-tags.json. Usage: build-competency-briefs.py [--grades 3-6]"""
import argparse, json, os, math, collections
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ap = argparse.ArgumentParser(); ap.add_argument("--grades", default="3-10"); ap.add_argument("--max-existing", type=int, default=60); a = ap.parse_args()
lo, hi = (int(x) for x in a.grades.split("-"))
G = json.load(open(f"{ROOT}/rag/bank/competency-gaps.json")); T = json.load(open(f"{ROOT}/rag/bank/curriculum-tags.json"))["factoids"]
pool = {c["id"]: c for c in json.load(open(f"{ROOT}/rag/pipeline/cardsPool.app.json"))["cards"]}
byc = collections.defaultdict(list)
for i, t in T.items():
    if i in pool:
        for c in t.get("codes", [t["competency"]]): byc[c].append(pool[i]["fact"]["en"])
briefs = []
for r in G["competencies"]:
    if r["deficit"] <= 0 or not (lo <= r["grade"] <= hi): continue
    over = 3.0 if r["fact_able"] <= 4 else 1.6
    briefs.append(dict(code=r["code"], grade=r["grade"], quarter=r["quarter"], domain=r["domain"], competency=r["text"], kind=r["kind"], fact_able=r["fact_able"],
                       card_form=r["card_form"], have=r["feed_cards"], floor=r["floor"], need=r["deficit"], target=math.ceil(r["deficit"] * over), existing_facts_en=byc.get(r["code"], [])[: a.max_existing]))
out = dict(source=dict(gaps=G["summary"], grades=a.grades), scheme="one brief per fact-able competency below its floor; target = need x oversample (3x if fact_able<=4 else 1.6x); existing_facts_en = feed cards carrying the code (v2 tags)", briefs=briefs)
json.dump(out, open(f"{ROOT}/rag/bank/competency-briefs.json", "w"), indent=1, ensure_ascii=False)
print(f"briefs: {len(briefs)} competencies (grades {a.grades}) | need {sum(b['need'] for b in briefs)} | target {sum(b['target'] for b in briefs)} candidates | {sum(len(b['existing_facts_en']) for b in briefs)} existing facts attached")
