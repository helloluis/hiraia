import json, random, re, os, glob
random.seed(202)
BANK="rag/bank/science-facts.jsonl"; WORK="finetuning/distill/work-v2"
SENS=re.compile(r"\b(dugo|tiyan|buto|bukog|puso|baga|lason|sakit|sumasakit|digest|tunaw|kidney|lungs|heart|blood|stomach|brain|utak|atay|liver|disease|fever|lagnat|sintomas|symptom|jaundice|mucus|swelling|burn|leech|spine|joint|nerve|muscle|kalamnan)\b", re.I)
N_DISTRACT=1050; N_NOFACT=400; SH=15

facts=[json.loads(l) for l in open(BANK)]
by_dom={}
for f in facts: by_dom.setdefault(f["domain"],[]).append(f)
def is_sens(f): return bool(SENS.search((f["fact"].get("en","")+f["fact"].get("tl","")+f["topic"]).lower()))
def rec(f): return {"id":f["id"],"domain":f["domain"],"topic":f["topic"],"en":f["fact"]["en"],"tl":f["fact"]["tl"]}

random.shuffle(facts)
items=[]
# DISTRACTORS: F_right + an off-DOMAIN F_wrong
right_pool=facts[:N_DISTRACT]
for f in right_pool:
    other_doms=[d for d in by_dom if d!=f["domain"]]
    wd=random.choice(other_doms); fw=random.choice(by_dom[wd])
    lang=random.choice(["tl","en"])
    items.append({"kind":"distractor","lang":lang,"right":rec(f),"wrong":rec(fw),
                  "sensitive": is_sens(f) or is_sens(fw)})
# NO-FACT: just F_right, empty grounding, graceful general-knowledge/hedge
for f in facts[N_DISTRACT:N_DISTRACT+N_NOFACT]:
    lang=random.choice(["tl","en"])
    items.append({"kind":"nofact","lang":lang,"right":rec(f),"sensitive":is_sens(f)})

random.shuffle(items)
safe=[it for it in items if not it["sensitive"]]; sens=[it for it in items if it["sensitive"]]
os.makedirs(f"{WORK}/safe",exist_ok=True); os.makedirs(f"{WORK}/out",exist_ok=True)
for x in glob.glob(f"{WORK}/safe/*.json")+glob.glob(f"{WORK}/out/*.jsonl"): os.remove(x)
ns=0
for i in range(0,len(safe),SH):
    json.dump(safe[i:i+SH], open(f"{WORK}/safe/shard-{i//SH:03d}.json","w"), ensure_ascii=False); ns+=1
json.dump(sens, open(f"{WORK}/sensitive.json","w"), ensure_ascii=False)
nd=sum(1 for it in items if it["kind"]=="distractor"); nf=sum(1 for it in items if it["kind"]=="nofact")
print(f"items: {len(items)} ({nd} distractor + {nf} nofact) | safe {len(safe)} ({ns} shards x{SH}) | sensitive {len(sens)}")
