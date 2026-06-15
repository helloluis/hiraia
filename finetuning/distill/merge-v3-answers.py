import json, glob
rows=[json.loads(l) for l in open("finetuning/distill/dataset-v1.jsonl")]
enriched={}
for fn in glob.glob("finetuning/distill/work-v3/out/v3-safe-*.jsonl"):
    for l in open(fn):
        l=l.strip().rstrip(",")
        if not l: continue
        try: o=json.loads(l)
        except: continue
        if "i" in o and o.get("answer"): enriched[o["i"]]=o["answer"]
n_repl=0
for i,r in enumerate(rows):
    if i in enriched: r["answer"]=enriched[i]; n_repl+=1
with open("finetuning/distill/dataset-v3-correct.jsonl","w") as w:
    for r in rows: w.write(json.dumps(r,ensure_ascii=False)+"\n")
print(f"v3 correct rows: {len(rows)} | enriched (safe): {n_repl} | kept (sensitive): {len(rows)-n_repl}")
