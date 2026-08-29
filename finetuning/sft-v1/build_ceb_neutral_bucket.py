#!/usr/bin/env python3
"""Build the Cebuano neutral-turn suppression bucket (SFT v2/v3).

  python3 build_ceb_neutral_bucket.py --up 4 --out finetuning/sft-v1/bucket-ceb-neutral-v3.jsonl \
      [--authored finetuning/sft-v1/ceb-authored-definitions.jsonl]

Pairs the app's Cebuano system prompt with language-NEUTRAL user turns (bare nouns, shared
tl/ceb vocabulary, English science terms) and answers them with Cebuano answers that genuinely
explain that topic.

Sourcing is DEFINITIONAL-QUESTION ONLY: a corpus row qualifies for topic X iff its user turn is
"Unsa (man) ang X?". Answer-text word-matching was tried and rejected 2026-08-26: `adlaw` and
`kasingkasing` are polysemous, and it paired 'Ang adlaw?' with an answer about fruit and
'Ang kasingkasing' with "the heart of chemical bonding". Training on those would teach the model
to answer in Cebuano about the wrong thing.

Topics with no definitional row in the corpus (13 of 30 in v2) can be covered by --authored: a
jsonl of {"topic": ..., "answer": ...} with human-checked Cebuano explanations.
"""
import json, re, random, argparse, collections
ap=argparse.ArgumentParser(); ap.add_argument("--up",type=int,default=4); ap.add_argument("--per-topic",type=int,default=6)
ap.add_argument("--authored"); ap.add_argument("--out",required=True); a=ap.parse_args()
random.seed(11)
rows=[json.loads(l) for l in open("finetuning/sft-v1/train-merged.jsonl",encoding="utf-8")]
ceb=[r for r in rows if any(m["role"]=="system" and ("bisaya" in m["content"].lower() or "cebuano" in m["content"].lower()) for m in r["messages"])]
sysp=next(m["content"] for m in ceb[0]["messages"] if m["role"]=="system")
TOPICS={"tubig":"water","hangin":"air","bato":"rock","bituon":"stars","adlaw":"sun","bulan":"moon","ulan":"rain","tanom":"plants",
 "hayop":"animals","photosynthesis":"photosynthesis","gravity":"gravity","bulkan":"volcano","kasingkasing":"heart","utok":"brain",
 "baga":"lungs","dugo":"blood","planeta":"planets","kuryente":"electricity","init":"heat","kahayag":"light","tingog":"sound",
 "yelo":"ice","asin":"salt","oxygen":"oxygen","magnet":"magnet","enerhiya":"energy","bukog":"bones","lindol":"earthquake","dagat":"sea","langit":"sky"}
DEF=re.compile(r"^\s*unsa\s+(man\s+)?(ang|ang\s+mga)\s+([\w\- ]+?)\s*\??\s*$",re.I)
pool=collections.defaultdict(list)
for r in ceb:
    u=next((m["content"] for m in r["messages"] if m["role"]=="user"),"")
    m=DEF.match(u)
    if not m: continue
    subj=m.group(3).lower()
    for k in TOPICS:
        if re.search(rf"\b{k}\b",subj): pool[k].append(next(x["content"] for x in r["messages"] if x["role"]=="assistant"))
authored=0
if a.authored:
    for l in open(a.authored,encoding="utf-8"):
        d=json.loads(l); pool[d["topic"]].append(d["answer"]); authored+=1
out=[]
for k,en in TOPICS.items():
    srcs=pool.get(k,[]); random.shuffle(srcs)
    for ans in srcs[:a.per_topic]:
        for p in (f"Ang {k}", k, f"Ang {k}?", en, en.capitalize(), f"{en}?"):
            out.append({"messages":[{"role":"system","content":sysp},{"role":"user","content":p},{"role":"assistant","content":ans}]})
seen=set(); uniq=[]
for r in out:
    key=(r["messages"][1]["content"],r["messages"][2]["content"][:80])
    if key not in seen: seen.add(key); uniq.append(r)
random.shuffle(uniq)
with open(a.out,"w",encoding="utf-8") as f:
    for _ in range(a.up):
        for r in uniq: f.write(json.dumps(r,ensure_ascii=False)+"\n")
cov=[k for k in TOPICS if pool.get(k)]
print(f"topics covered: {len(cov)}/{len(TOPICS)}  missing: {[k for k in TOPICS if not pool.get(k)]}")
print(f"authored answers used: {authored}")
print(f"unique rows: {len(uniq)}  x{a.up} = {len(uniq)*a.up}  (~{100*len(uniq)*a.up/(6687+len(uniq)*a.up):.1f}% of the mix)")
