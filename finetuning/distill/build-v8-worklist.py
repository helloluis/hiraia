#!/usr/bin/env python3
"""v8 worklist — TARGETED pedagogy patch on top of v7 (see hiraiabench: Hiraia's weakest category was
Pedagogy 2.7 — accurate but terse/definitional; higher scorers use simpler words + engagement).

ONE category, modest size (user: keep it down, reasonable number):
  - pedagogy_eli5 : a grounded settled-science question answered in an ELI5, ENGAGING style —
                    SIMPLER everyday word choices (define any needed term plainly), warm tone, and a
                    friendly check/follow-up question at the end. CRITICAL CONSTRAINTS (user):
                    * NO analogies ("imagine it's like…") — a small model can confabulate a bad one.
                    * Stay ACCURATE — grounded in a verified fact, so there's nothing to fabricate.
                    * Stay CONCISE (2-3 short sentences) so we don't undo the conciseness/TTFT wins.

AUP: body/bio facts excluded from the Claude teacher (same SENS/BODY_VAL filter as v5-v7).
Out: finetuning/distill/work-v8/pedagogy_eli5/shard-NNN.json
"""
import json, re, os, glob, random

BANK = "rag/bank/science-facts.jsonl"
WORK = "finetuning/distill/work-v8"
SH = 12
N_ELI5 = 120  # modest, focused
SENS = re.compile(r"\b("
    r"dugo|blood|tiyan|sikmura|stomach|bituka|intestine|buto|bukog|bone|skeleton|kalansay|"
    r"puso|heart|cardiac|baga|lung|utak|brain|atay|liver|kidney|bato\s|lymph|node|immune|antibody|"
    r"germ|mikrobyo|bakterya|bacteri|virus|sakit|disease|lagnat|fever|sintomas|symptom|jaundice|"
    r"mucus|plema|swelling|namamaga|burn|paso|leech|linta|spine|gulugod|joint|kasukasuan|nerve|nerbiyo|"
    r"muscle|kalamnan|litid|tendon|organ|balat|skin|hininga|paghinga|breath|inhale|exhale|langhap|"
    r"reproduc|puberty|pagbibinata|pagdadalaga|sexual|menstr|regla|hormone|kasarian|ari\b|maselang|"
    r"suso|breast|dibdib|chest|leeg|neck|ngipin|teeth|tooth|dila|tongue|tainga|ear|ilong|nostril|"
    r"pawis|sweat|ihi|urine|dumi\b|waste|lalamunan|throat|esophagus|digest|tunaw|metabol|sigarilyo|"
    r"selula\s|cell\b|tissue|tisyu|nutrient sa katawan|tubig sa katawan|body water|body temperature"
    r")\b", re.I)
BODY_VAL = re.compile(r"val-(human|body|heart|breathing|blood|largest-organ)", re.I)

facts = [json.loads(l) for l in open(BANK) if l.strip()]
def safe(f):
    if BODY_VAL.search(f["id"]): return False
    blob = (f["fact"].get("en","") + " " + f["fact"].get("tl","") + " " + f.get("topic","") + " " + f["id"]).lower()
    return not SENS.search(blob)
bank_safe = [f for f in facts if safe(f)]
random.seed(18)

def item(f):
    return {"id": f["id"], "domain": f.get("domain",""), "topic": f.get("topic",""),
            "en": f["fact"]["en"], "tl": f["fact"]["tl"], "bis": f["fact"].get("bis","")}

# Favor explanatory "concept" facts (the kind a kid asks why/how about), but any safe fact teaches the
# STYLE; sample broadly for topic variety.
rows = [item(f) for f in random.sample(bank_safe, min(N_ELI5, len(bank_safe)))]

d = f"{WORK}/pedagogy_eli5"; os.makedirs(d, exist_ok=True)
for x in glob.glob(f"{d}/*.json"): os.remove(x)
for j in range(0, len(rows), SH):
    json.dump(rows[j:j+SH], open(f"{d}/shard-{j//SH:03d}.json","w"), ensure_ascii=False)
print(f"pedagogy_eli5: {len(rows)} rows -> {(len(rows)+SH-1)//SH} shards")
print(f"bank: {len(facts)} | AUP-safe: {len(bank_safe)}")

leak = 0
for sf in glob.glob(f"{WORK}/*/shard-*.json"):
    for it in json.load(open(sf)):
        b = (it.get("en","")+" "+it.get("tl","")+" "+it.get("topic","")+" "+it.get("id","")).lower()
        if SENS.search(b) or BODY_VAL.search(it.get("id","")): leak += 1; print(f"  LEAK {sf}: {it.get('id')}")
print(f"AUP verification: {leak} leaks (must be 0)" + (" OK" if leak == 0 else " FIX"))
