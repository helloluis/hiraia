#!/usr/bin/env python3
"""Per-competency coverage of the illustrated feed pool and the fact bank -> rag/bank/competency-gaps.json.

This is the swarm's target list: for every MATATAG competency (all matatag-*-competencies.json files),
how many confidently-tagged (>=0.20) illustrated cards and bank facts exist, and how far below the
floor it sits. Run after tag-curriculum.py. Usage: competency-gaps.py [--floor 60]
"""
import argparse, collections, glob, json, os, statistics
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ap = argparse.ArgumentParser(); ap.add_argument("--floor", type=int, default=60); ap.add_argument("--min-conf", type=float, default=0.20); ap.add_argument("--tags", default=None); ap.add_argument("--out", default=None)
a = ap.parse_args()
T = json.load(open(a.tags or f"{ROOT}/rag/bank/curriculum-tags.json"))
pool = json.load(open(f"{ROOT}/rag/pipeline/cardsPool.app.json"))["cards"]
pool_ids = {c["id"] for c in pool}
fact_of = {r["id"]: r.get("factId") for r in (json.loads(l) for l in open(f"{ROOT}/rag/bank/factoids.jsonl") if l.strip())}
feed, bank_facts = collections.Counter(), collections.defaultdict(set)
for i, t in T["factoids"].items():
    if t and t["confidence"] >= a.min_conf:
        for c in t.get("codes", [t["competency"]]):
            if i in pool_ids: feed[c] += 1                             # v2: a card counts under every code it serves
            if fact_of.get(i): bank_facts[c].add(fact_of[i])           # a bank fact is labelled via its factoid (as coverage-roundup.py)
for i, t in T["bank"].items():                                          # normally {} — see the file's scheme string
    if t and t["confidence"] >= a.min_conf:
        for c in t.get("codes", [t["competency"]]): bank_facts[c].add(i)
bank = {c: len(s) for c, s in bank_facts.items()}
KINDS = json.load(open(f"{ROOT}/rag/bank/competency-kinds.json"))["competencies"] if os.path.exists(f"{ROOT}/rag/bank/competency-kinds.json") else {}
rows = []
for f in sorted(glob.glob(f"{ROOT}/rag/sources/curriculum-guides/matatag-*-competencies.json")):
    for q in json.load(open(f))["quarters"]:
        for c in q["competencies"]:
            k = KINDS.get(c["code"], {}); fact_able = k.get("fact_able", 5); kind = k.get("kind", "content")
            # process / local-inquiry competencies are not fact-shaped: no fact-card deficit is counted for them
            floor = {5: a.floor, 4: round(a.floor * 0.75), 3: round(a.floor * 0.5)}.get(fact_able, a.floor)   # spec v2: floors by fact-ability
            deficit = max(0, floor - feed[c["code"]]) if fact_able >= 3 else 0
            rows.append(dict(code=c["code"], grade=q["grade"], quarter=q["quarter"], domain=q["domain"], text=c["text"], kind=kind,
                             fact_able=fact_able, card_form=k.get("card_form", "fact"), feed_cards=feed[c["code"]], bank_facts=bank.get(c["code"], 0), floor=floor, deficit=deficit))
rows.sort(key=lambda r: (r["feed_cards"], r["bank_facts"]))
f_ = [r["feed_cards"] for r in rows]
summary = dict(competencies=len(rows), grades=sorted({r["grade"] for r in rows}), floor=a.floor, min_confidence=a.min_conf,
               feed_median=statistics.median(f_), feed_zero=sum(1 for x in f_ if x == 0), feed_below_floor=sum(1 for x in f_ if x < a.floor),
               total_deficit=sum(r["deficit"] for r in rows), fact_able_competencies=sum(1 for r in rows if r["fact_able"] >= 3),
               not_fact_shaped=[r["code"] for r in rows if r["fact_able"] < 3])
out_path = a.out or (a.tags.replace(".json", ".gaps.json") if a.tags else f"{ROOT}/rag/bank/competency-gaps.json")
json.dump(dict(summary=summary, competencies=rows), open(out_path, "w"), indent=1, ensure_ascii=False); print("->", out_path)
print(json.dumps(summary))
by_cell = collections.defaultdict(int)
for r in rows: by_cell[(r["grade"], r["quarter"])] += r["deficit"]
print("deficit by grade x quarter (cards needed to reach the floor):")
for g in summary["grades"]:
    print(f"  G{g}: " + "  ".join(f"Q{q}={by_cell[(g, q)]:4d}" for q in (1, 2, 3, 4)))
