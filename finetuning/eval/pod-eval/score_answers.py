#!/usr/bin/env python3
"""Deterministic scoring of an eval-answers file (no LLM judge).

  python3 score_answers.py finetuning/cpt/sft-v1-eval-answers.json /tmp/sft-v2-eval-answers.json

Gate: regex mustContain / mustNotContain, split by mode. `grounded` cases expect retrieved
facts injected into the user turn; without RAG injection only their mustNotContain is
meaningful, so they are reported as 'forbidden-term violations', not pass/fail.
Capability: per-tier reply-language rate (Cebuano for bis, Tagalog for tl, English for en),
refusal/deflection rate, and median answer length — the shape checks that catch a model that
has become hedgy or terse everywhere rather than just where it was trained to.
"""
import json, re, sys, statistics
CEB = re.compile(r"\b(mao|nga|kaayo|naghimo|gikan|usa ka|ilang|atong|og|dili|kini|kana|pinaagi|tungod|unsa|maayong|nindot)\b")
TL  = re.compile(r"\b(ay|ng|mga|po|kung|dahil|ito|iyan|ang mga|paano|bakit|ano)\b")
EN  = re.compile(r"\b(the|is|are|of|and|because|which|that)\b")
REFUSE = re.compile(r"hindi (ako|ko).{0,30}(sagot|alam|makapag)|dili (ko|nako).{0,30}(tubag|kahibalo)|not sure|hindi ako sigurado|ano ang gusto mong malaman|unsa (man )?ang (imong )?gusto", re.I)
def lang(a):
    h=a[:160]; c,t,e=len(CEB.findall(h)),len(TL.findall(h)),len(EN.findall(h))
    return max((("ceb",c),("tl",t),("en",e)),key=lambda x:x[1])[0] if max(c,t,e) else "?"
def hit(p,a): return re.search(p,a,re.I) is not None
runs=[]
for path in sys.argv[1:]:
    d=json.load(open(path,encoding="utf-8")); runs.append((d.get("label") or path.split("/")[-1].split("-eval")[0], d))
print("=== GATE (deterministic) ===")
print(f"{'':10}"+" ".join(f"{lab:>12}" for lab,_ in runs))
for mode in ("chitchat","abstain","grounded"):
    cells=[]
    for lab,d in runs:
        rs=[r for r in d.get("gate",[]) if r.get("mode")==mode]
        if not rs: cells.append("—"); continue
        if mode=="grounded":
            viol=sum(1 for r in rs if any(hit(p,r["answer"]) for p in (r.get("mustNotContain") or [])))
            cells.append(f"{viol} viol/{len(rs)}")
        else:
            ok=sum(1 for r in rs if all(hit(p,r["answer"]) for p in (r.get("mustContain") or [])) and not any(hit(p,r["answer"]) for p in (r.get("mustNotContain") or [])))
            cells.append(f"{ok}/{len(rs)}")
    print(f"{mode:10}"+" ".join(f"{c:>12}" for c in cells))
print("\n=== CAPABILITY by tier: expected-language rate | refusal/deflect rate | median chars ===")
tiers=sorted({r["tier"] for _,d in runs for r in d.get("capability",[])})
EXP={"tl":"tl","bis":"ceb","en":"en"}
print(f"{'tier':20}"+" ".join(f"{lab:>26}" for lab,_ in runs))
for t in tiers:
    cells=[]
    for lab,d in runs:
        rs=[r for r in d.get("capability",[]) if r["tier"]==t]
        if not rs: cells.append("—"); continue
        okl=sum(1 for r in rs if lang(r["answer"])==EXP.get(r.get("lang","tl"),"tl"))
        ref=sum(1 for r in rs if REFUSE.search(r["answer"][:200]))
        med=int(statistics.median(len(r["answer"]) for r in rs))
        cells.append(f"lang {okl}/{len(rs)} ref {ref} med {med}")
    print(f"{t:20}"+" ".join(f"{c:>26}" for c in cells))
