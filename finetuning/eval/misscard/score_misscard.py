#!/usr/bin/env python3
"""Score miss-card outputs: format (exactly 3 lines), language (fastText lid == mode), and —
the one that matters — whether each proposed direction is something the bank can actually
follow (LaBSE top-1 cosine >= 0.63 against the bank). A direction the feed can't retrieve is a
dead end, not a direction.  Needs the LaBSE service on :8091 for the retrievability check.
  python3 score_misscard.py misscard-sft-v1.json
"""
import json, re, sys, numpy as np, urllib.request, collections
EXP={"tagalog":"tl","cebuano":"ceb","english":"en"}; CUT=0.63
meta=json.load(open("packages/mobile/assets/rag/vectors-labse.meta.json")); N,D,L,S=meta["count"],meta["dims"],meta["langs"],meta["scale"]
V=np.fromfile("packages/mobile/assets/rag/vectors-labse.i8.bin",dtype=np.int8).reshape(len(L),N,D).astype(np.float32)*S
def embed(t):
    r=urllib.request.Request("http://localhost:8091/v1/embeddings",data=json.dumps({"input":t}).encode(),headers={"Content-Type":"application/json"})
    e=np.array(json.load(urllib.request.urlopen(r,timeout=120))["data"][0]["embedding"],dtype=np.float32); return e/np.linalg.norm(e)
def directions(ans):
    lines=[l.strip(" -•*0123456789.)") for l in ans.strip().splitlines() if l.strip()]
    return [l for l in lines if len(l)>3]
d=json.load(open(sys.argv[1])); rs=d["results"]
print(f"=== {d.get('label')}  n={len(rs)} ===")
fmt=lang=retr=0; per_mode=collections.defaultdict(lambda:[0,0,0,0]); dead=[]
for r in rs:
    ds=directions(r["answer"]); ok3=len(ds)==3
    okl=r["lid"]==EXP[r["mode"]]
    topics=[re.split(r"\s+[-–—:]\s+",x,1)[0] for x in ds[:3]]
    scores=[float(max((V[i]@embed(t)).max() for i in range(len(L)))) for t in topics] if topics else []
    okr=len(scores)==3 and all(s>=CUT for s in scores)
    m=per_mode[r["mode"]]; m[0]+=1; m[1]+=ok3; m[2]+=okl; m[3]+=okr
    r["n_dirs"]=len(ds); r["dir_scores"]=[round(s,3) for s in scores]
    if scores and min(scores)<CUT: dead.append((r["mode"],r["typed"],topics[int(np.argmin(scores))],min(scores)))
print(f"{'mode':10}{'n':>5}{'3 lines':>10}{'mode lang':>11}{'all 3 retrievable':>19}")
for m,(n,a,b,c) in per_mode.items(): print(f"{m:10}{n:>5}{a:>10}{b:>11}{c:>19}")
tot=len(rs); print(f"{'ALL':10}{tot:>5}{sum(v[1] for v in per_mode.values()):>10}{sum(v[2] for v in per_mode.values()):>11}{sum(v[3] for v in per_mode.values()):>19}")
print("\nsample outputs:")
for r in rs[:3]: print(f"  [{r['mode']}] {r['typed']!r} ->\n    "+r["answer"][:230].replace("\n","\n    "))
print("\ndead-end directions (not retrievable):")
for m,t,top,s in dead[:8]: print(f"  [{m}] {t!r} -> {top!r} ({s:.3f})")
json.dump(d,open(sys.argv[1],"w"),ensure_ascii=False)
