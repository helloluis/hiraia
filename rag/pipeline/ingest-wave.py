#!/usr/bin/env python3
"""Ingest a fact-gen workflow result file into the bank: parse -> dedup (by id,
vs bank + within batch) -> validate (schema, trilingual, terms) -> append."""
import json, sys, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BANK = os.path.join(ROOT, "rag/bank/science-facts.jsonl")
DOMAINS = {"MATTER","LIVING_THINGS","FORCE_MOTION_ENERGY","EARTH_SPACE","ABOUT_HIRAIA"}

out_file = sys.argv[1]
data = json.load(open(out_file))
facts = (data.get("result") or {}).get("facts") or data.get("facts") or []
print(f"workflow returned: {len(facts)} facts")

existing_ids = set()
for l in open(BANK):
    try: existing_ids.add(json.loads(l)["id"])
    except: pass

def slug_ok(s): return bool(re.match(r"^[a-z0-9][a-z0-9-]*$", s or ""))

accepted, seen, drops = [], set(), {"dup_bank":0,"dup_batch":0,"bad_id":0,"bad_domain":0,"missing_lang":0,"few_terms":0}
for x in facts:
    fid = x.get("id","")
    if not slug_ok(fid): drops["bad_id"]+=1; continue
    if fid in existing_ids: drops["dup_bank"]+=1; continue
    if fid in seen: drops["dup_batch"]+=1; continue
    if x.get("domain") not in DOMAINS: drops["bad_domain"]+=1; continue
    fa = x.get("fact") or {}
    if not all(len((fa.get(k) or "").strip()) >= 10 for k in ("tl","en","bis")): drops["missing_lang"]+=1; continue
    if len(x.get("terms") or []) < 4: drops["few_terms"]+=1; continue
    seen.add(fid)
    accepted.append({
        "id": fid, "domain": x["domain"], "topic": x.get("topic",""),
        "grades": x.get("grades") or [5], "terms": x["terms"],
        "fact": {"tl":fa["tl"],"en":fa["en"],"bis":fa["bis"]},
        "source": x.get("source","wave1"), "generator":"claude-workflow", "reviewed": False,
    })

print("dropped:", {k:v for k,v in drops.items() if v})
print(f"accepted: {len(accepted)}")
if "--write" in sys.argv:
    with open(BANK,"a") as fh:
        for x in accepted: fh.write(json.dumps(x, ensure_ascii=False)+"\n")
    print(f"appended -> {BANK}")
else:
    print("(dry run; pass --write to append)")
