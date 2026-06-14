import json, random, re, sys
random.seed(42)  # reproducible

BANK = "rag/bank/science-facts.jsonl"
# AUP body/medical trigger lexemes — facts containing these are "sensitive" (route to LOCAL teacher only)
SENSITIVE = re.compile(r"\b(dugo|tiyan|buto|bukog|puso|baga|lason|sakit|sumasakit|digest|tunaw|kidney|bato sa|lungs|heart|blood|stomach|brain|utak|atay|liver|disease|fever|lagnat|sintomas|symptom)\b", re.I)

safe, sens = [], []
for l in open(BANK):
    f = json.loads(l)
    txt = (f["fact"].get("en","") + " " + f["fact"].get("tl","") + " " + f.get("topic","")).lower()
    rec = {"id": f["id"], "domain": f["domain"], "topic": f["topic"],
           "en": f["fact"].get("en",""), "tl": f["fact"].get("tl","")}
    (sens if SENSITIVE.search(txt) else safe).append(rec)

random.shuffle(safe); random.shuffle(sens)
# 20 safe spread across domains, 10 sensitive
picked_safe = safe[:20]
picked_sens = sens[:10]
for r in picked_safe: r["bucket"]="safe"
for r in picked_sens: r["bucket"]="sensitive"
out = picked_safe + picked_sens
with open("finetuning/distill/pilot/facts.jsonl","w") as w:
    for r in out: w.write(json.dumps(r,ensure_ascii=False)+"\n")
print(f"safe pool={len(safe)} sensitive pool={len(sens)}")
print(f"picked: {len(picked_safe)} safe + {len(picked_sens)} sensitive = {len(out)}")
print("sample safe topics:", [r["topic"] for r in picked_safe[:6]])
print("sample sens topics:", [r["topic"] for r in picked_sens[:6]])
