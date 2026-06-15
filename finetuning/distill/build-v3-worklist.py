import json, re, os, glob
BANK="rag/bank/science-facts.jsonl"; WORK="finetuning/distill/work-v3"
SENS=re.compile(r"\b(dugo|tiyan|buto|bukog|puso|baga|lason|sakit|sumasakit|digest|tunaw|kidney|lungs|heart|blood|stomach|brain|utak|atay|liver|disease|fever|lagnat|sintomas|symptom|jaundice|mucus|swelling|burn|leech|spine|joint|nerve|muscle|kalamnan)\b", re.I)
SH=20
bank={json.loads(l)["id"]:json.loads(l) for l in open(BANK)}
rows=[json.loads(l) for l in open("finetuning/distill/dataset-v1.jsonl")]
os.makedirs(f"{WORK}/safe", exist_ok=True); os.makedirs(f"{WORK}/out", exist_ok=True)
for f in glob.glob(f"{WORK}/safe/*.json")+glob.glob(f"{WORK}/out/*.jsonl"): os.remove(f)
safe_items=[]; n_sens=0
for i,r in enumerate(rows):
    f=bank.get(r["fact_id"]);
    if not f: continue
    txt=(f["fact"].get("en","")+f["fact"].get("tl","")+f["topic"]).lower()
    if SENS.search(txt): n_sens+=1; continue  # sensitive → keep v1 answer (style generalizes)
    safe_items.append({"i":i,"fact_id":r["fact_id"],"lang":r["lang"],"topic":f["topic"],
                       "en":f["fact"]["en"],"tl":f["fact"]["tl"],"question":r["question"]})
ns=0
for j in range(0,len(safe_items),SH):
    json.dump(safe_items[j:j+SH], open(f"{WORK}/safe/shard-{j//SH:03d}.json","w"), ensure_ascii=False); ns+=1
print(f"dataset-v1 rows={len(rows)} | safe-to-enrich={len(safe_items)} ({ns} shards x{SH}) | sensitive-kept={n_sens}")
