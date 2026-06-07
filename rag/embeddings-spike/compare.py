#!/usr/bin/env python3
"""Compare lexical-only vs semantic-only vs SEMANTIC-LED hybrid on the hard cases.
Naive 50/50 RRF regressed (lexical's wrong #1 polluted), so we sweep a
semantic-dominant weighted RRF: score = 1/(k+rank_sem) + wL/(k+rank_lex).
Pick the smallest wL that keeps semantic's wins while letting strong lexical
matches (exact terms/numbers/proper nouns) still contribute."""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
cases = json.load(open(os.path.join(HERE, "cases.json")))
lex = json.load(open(os.path.join(HERE, "lexical_results.json")))
sem = json.load(open(os.path.join(HERE, "semantic_results.json")))

def wrrf(L, S, wL, k=60):
    score = {}
    for rank, it in enumerate(S):
        score[it["id"]] = score.get(it["id"], 0) + 1.0 / (k + rank + 1)
    for rank, it in enumerate(L):
        score[it["id"]] = score.get(it["id"], 0) + wL / (k + rank + 1)
    return [{"id": i, "score": s} for i, s in sorted(score.items(), key=lambda x: -x[1])]

def rank_of(lst, expect):
    rx = re.compile(expect, re.I)
    return next((i + 1 for i, it in enumerate(lst) if rx.search(it["id"])), None)

def hit(lst, expect, mustnot):
    r = rank_of(lst, expect)
    bad = mustnot and lst and re.search(mustnot, lst[0]["id"], re.I)
    return r is not None and r <= 3 and not bad

def hits(method_lists):
    return sum(hit(method_lists[c["q"]], c["expect"], c.get("mustnot")) for c in cases)

N = len(cases)
sem_only = {c["q"]: sem[c["q"]] for c in cases}
lex_only = {c["q"]: lex[c["q"]] for c in cases}
print(f"lexical-only  : {hits(lex_only)}/{N}")
print(f"semantic-only : {hits(sem_only)}/{N}")
print("\nsemantic-led weighted-RRF sweep (wL = lexical weight; semantic weight = 1.0):")
for wL in [0.0, 0.2, 0.3, 0.5, 1.0]:
    hy = {c["q"]: wrrf(lex[c["q"]], sem[c["q"]], wL) for c in cases}
    print(f"  wL={wL:<4} -> {hits(hy)}/{N}")

WL = 0.3
print(f"\n=== per-case detail (hybrid wL={WL}) ===")
print(f"{'query':40s} {'expect':12s} {'LEX':>4} {'SEM':>4} {'HYB':>4}")
print("-" * 78)
for c in cases:
    q, exp = c["q"], c["expect"]
    H = wrrf(lex[q], sem[q], WL)
    print(f"{q:40s} {exp[:12]:12s} {('#'+str(rank_of(lex[q],exp))) if rank_of(lex[q],exp) else '—':>4} "
          f"{('#'+str(rank_of(sem[q],exp))) if rank_of(sem[q],exp) else '—':>4} "
          f"{('#'+str(rank_of(H,exp))) if rank_of(H,exp) else '—':>4}")

# abstain calibration: top semantic cosine per case (on-topic) — to pick a floor
print("\n=== semantic top-1 cosine (abstain-floor calibration) ===")
for c in cases:
    print(f"  {sem[c['q']][0]['score']:.3f}  {c['q']}")

print("\n=== actual top-3 per method ===")
for c in cases:
    q=c["q"]; H=wrrf(lex[q],sem[q],WL)
    print(f"• {q}")
    print("   lex:", ", ".join(x["id"] for x in lex[q][:3]))
    print("   sem:", ", ".join(x["id"] for x in sem[q][:3]))
    print("   hyb:", ", ".join(x["id"] for x in H[:3]))
