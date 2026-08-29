#!/usr/bin/env python3
"""Is 'strong hit / weak hit / miss' separable by retrieval score?

Embeds each query with the LaBSE service (raw CLS, L2-normalised — the device method), scores
it against the CURRENT bank blob (49,556 facts x 3 langs, int8), and reports the top-1 cosine
per query bucket (curriculum / adjacent / offtopic) against the app's existing floors.
Also reports the lexical score the cards feed uses today (searchCards, idf token overlap) so
the two retrieval paths can be compared on the same queries.
"""
import json, numpy as np, urllib.request, collections, sys
ROOT="."
meta=json.load(open(f"{ROOT}/packages/mobile/assets/rag/vectors-labse.meta.json"))
N,D,LANGS,SCALE=meta["count"],meta["dims"],meta["langs"],meta["scale"]
raw=np.fromfile(f"{ROOT}/packages/mobile/assets/rag/vectors-labse.i8.bin",dtype=np.int8)
assert raw.size==N*D*len(LANGS),(raw.size,N*D*len(LANGS))
V=raw.reshape(len(LANGS),N,D).astype(np.float32)*SCALE            # lang-major
bank=[json.loads(l) for l in open(f"{ROOT}/rag/bank/science-facts.jsonl",encoding="utf-8")]
assert len(bank)==N
def embed(text):
    r=urllib.request.Request("http://localhost:8091/v1/embeddings",data=json.dumps({"input":text}).encode(),headers={"Content-Type":"application/json"})
    e=np.array(json.load(urllib.request.urlopen(r,timeout=120))["data"][0]["embedding"],dtype=np.float32)
    return e/np.linalg.norm(e)
qs=json.load(open(f"{ROOT}/finetuning/eval/retrieval/queries.json"))
FLOORS={"SEARCH_FLOOR(cards,lexical)":0.34,"SEMANTIC_FLOOR":0.53,"RETRIEVAL_IMAGE_FLOOR":0.60,"CONTEXT_FALLBACK_FLOOR":0.62}
rows=[]
for q in qs:
    e=embed(q["q"])
    best=-1; bl=None; bi=None
    for li,lang in enumerate(LANGS):
        s=V[li]@e; i=int(np.argmax(s))
        if s[i]>best: best=float(s[i]); bl=lang; bi=i
    top5=sorted(((float((V[li]@e).max()),lang) for li,lang in enumerate(LANGS)),reverse=True)
    rows.append({**q,"top1":round(best,3),"lang":bl,"hit_topic":bank[bi]["topic"],"hit_domain":bank[bi]["domain"]})
json.dump(rows,open(f"{ROOT}/finetuning/eval/retrieval/scores-labse.json","w"),ensure_ascii=False,indent=0)
print("=== LaBSE top-1 cosine vs current bank (49,556 facts) ===")
print(f"{'bucket':11}{'n':>4}{'min':>7}{'p10':>7}{'p50':>7}{'p90':>7}{'max':>7}")
by=collections.defaultdict(list)
for r in rows: by[r["bucket"]].append(r["top1"])
for b in ("curriculum","adjacent","offtopic"):
    a=np.array(by[b]); print(f"{b:11}{len(a):>4}{a.min():>7.3f}{np.percentile(a,10):>7.3f}{np.median(a):>7.3f}{np.percentile(a,90):>7.3f}{a.max():>7.3f}")
print("\n=== separability: % of each bucket ABOVE each existing floor ===")
print(f"{'floor':32}"+"".join(f"{b:>12}" for b in ("curriculum","adjacent","offtopic")))
for name,f in sorted(FLOORS.items(),key=lambda x:x[1]):
    print(f"{name:32}"+"".join(f"{100*np.mean(np.array(by[b])>=f):>11.0f}%" for b in ("curriculum","adjacent","offtopic")))
# best single threshold for offtopic-vs-rest and for curriculum-vs-adjacent
def best_cut(pos,neg):
    cands=sorted(set(pos+neg)); best=(0,None)
    for c in cands:
        acc=(np.mean(np.array(pos)>=c)+np.mean(np.array(neg)<c))/2
        if acc>best[0]: best=(acc,c)
    return best
a1,c1=best_cut(by["curriculum"]+by["adjacent"],by["offtopic"]); a2,c2=best_cut(by["curriculum"],by["adjacent"])
print(f"\n  best cut (science vs offtopic): {c1:.3f}  balanced acc {100*a1:.0f}%")
print(f"  best cut (curriculum vs adjacent): {c2:.3f}  balanced acc {100*a2:.0f}%")
print("\n=== what the top-1 hit IS, for borderline cases ===")
for r in sorted(rows,key=lambda r:r["top1"]):
    if r["bucket"]=="offtopic" and r["top1"]>=c1-0.02 or r["bucket"]!="offtopic" and r["top1"]<=c1+0.02:
        print(f"  {r['bucket']:10} {r['q']:22} {r['top1']:.3f} -> [{r['lang']}] {r['hit_topic'][:40]!r}")
