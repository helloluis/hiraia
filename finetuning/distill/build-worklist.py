import json, random, re, os, glob
random.seed(7)
BANK="rag/bank/science-facts.jsonl"
WORK="finetuning/distill/work"
SENS=re.compile(r"\b(dugo|tiyan|buto|bukog|puso|baga|lason|sakit|sumasakit|digest|tunaw|kidney|lungs|heart|blood|stomach|brain|utak|atay|liver|disease|fever|lagnat|sintomas|symptom|jaundice|mucus|swelling|burn|leech|spine|joint|nerve|muscle|kalamnan)\b", re.I)
TARGET=2500  # stage-1 stratified sample

# reset work dir
for d in ["safe","out"]:
    os.makedirs(f"{WORK}/{d}", exist_ok=True)
for f in glob.glob(f"{WORK}/safe/*.json")+glob.glob(f"{WORK}/out/*.jsonl"): os.remove(f)

by_dom={}
for l in open(BANK):
    f=json.loads(l)
    by_dom.setdefault(f["domain"],[]).append(f)
total=sum(len(v) for v in by_dom.values())

safe=[]; sens=[]
for dom,facts in by_dom.items():
    random.shuffle(facts)
    take=max(8, round(TARGET*len(facts)/total)) if dom!="ABOUT_HIRAIA" else len(facts)
    for f in facts[:take]:
        txt=(f["fact"].get("en","")+" "+f["fact"].get("tl","")+" "+f["topic"]).lower()
        rec={"id":f["id"],"domain":f["domain"],"topic":f["topic"],
             "en":f["fact"].get("en",""),"tl":f["fact"].get("tl","")}
        (sens if SENS.search(txt) else safe).append(rec)

random.shuffle(safe); random.shuffle(sens)
# shard safe into chunks of 20 for Claude agents
SH=20
nshards=0
for i in range(0,len(safe),SH):
    json.dump(safe[i:i+SH], open(f"{WORK}/safe/shard-{i//SH:03d}.json","w"), ensure_ascii=False)
    nshards+=1
json.dump(sens, open(f"{WORK}/sensitive.json","w"), ensure_ascii=False)
print(f"sampled {len(safe)+len(sens)} facts: {len(safe)} safe ({nshards} shards x{SH}), {len(sens)} sensitive")
print(f"safe pct={100*len(safe)/(len(safe)+len(sens)):.0f}%  sensitive pct={100*len(sens)/(len(safe)+len(sens)):.0f}%")
