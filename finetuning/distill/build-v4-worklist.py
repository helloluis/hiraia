#!/usr/bin/env python3
"""v4 worklist — selects AUP-SAFE facts for the new skill-only row-types and shards them for the
teacher workflow. v4 reuses cleaned v3 (the skill/grounding/intent data) and ADDS:
  - multi-turn   (P4): grounded Q1 + bare follow-ups, confirm-and-build, no repetition
  - faithful     (P3): settled-science → confident-correct even w/ off/empty grounding (no confab,
                       no over-abstention); wrong-grounding → ignore it, teach the real topic
  - engage       (P5): NATURAL (non-framed) conversational Q with emoji + a fitting [image:] tag

AUP: body/bio facts (SENS) are EXCLUDED from the Claude teacher (route to local-35B separately or
skip). Settled-science 'faithful' rows draw from the curated val-* set.

Out: finetuning/distill/work-v4/{multiturn,faithful,engage}/shard-NNN.json (lists of fact items).
"""
import json, re, os, glob, random

BANK = "rag/bank/science-facts.jsonl"
WORK = "finetuning/distill/work-v4"
SH = 12
# AUP: human body/biology/medical — never to the Claude teacher. Broadened after a pilot leaked
# lymph/immune/organ facts (the v3 SENS missed them). Err toward EXCLUDING — dropping a safe fact
# is fine; leaking a body-bio one is not. Body val-* facts also excluded by id below.
SENS = re.compile(r"\b("
    r"dugo|blood|tiyan|sikmura|stomach|bituka|intestine|buto|bukog|bone|skeleton|kalansay|"
    r"puso|heart|cardiac|baga|lung|utak|brain|atay|liver|kidney|bato\s|lymph|node|immune|antibody|"
    r"germ|mikrobyo|bakterya|bacteri|virus|sakit|disease|lagnat|fever|sintomas|symptom|jaundice|"
    r"mucus|plema|swelling|namamaga|burn|paso|leech|linta|spine|gulugod|joint|kasukasuan|nerve|nerbiyo|"
    r"muscle|kalamnan|litid|tendon|organ|balat|skin|hininga|paghinga|breath|inhale|exhale|langhap|"
    r"reproduc|puberty|pagbibinata|pagdadalaga|sexual|menstr|regla|hormone|kasarian|ari\b|maselang|"
    r"suso|breast|dibdib|chest|leeg|neck|ngipin|teeth|tooth|dila|tongue|tainga|ear|ilong|nostril|"
    r"pawis|sweat|ihi|urine|dumi\b|waste|lalamunan|throat|esophagus|digest|tunaw|metabol|"
    r"selula\s|cell\b|tissue|tisyu|nutrient sa katawan|tubig sa katawan|body water|body temperature"
    r")\b", re.I)
# body-themed val-* facts (settled but human-body → AUP): exclude by id substring
BODY_VAL = re.compile(r"val-(human|body|heart|breathing|blood|largest-organ)", re.I)
# illustratable = concrete, picture-friendly domains (for the 'engage' image-tag rows)
ILLUSTRATABLE = {"EARTH_SPACE", "FORCE_MOTION_ENERGY", "MATTER"}

facts = [json.loads(l) for l in open(BANK) if l.strip()]
def safe(f):
    if BODY_VAL.search(f["id"]): return False
    blob = (f["fact"].get("en", "") + " " + f["fact"].get("tl", "") + " " + f.get("topic", "") + " " + f["id"]).lower()
    return not SENS.search(blob)

bank_safe = [f for f in facts if safe(f)]
val = [f for f in facts if f["id"].startswith("val-") and safe(f)]
random.seed(14)  # deterministic selection (no Math.random; reproducible worklist)

def item(f):
    return {"id": f["id"], "domain": f.get("domain", ""), "topic": f.get("topic", ""),
            "grades": f.get("grades", []), "en": f["fact"]["en"], "tl": f["fact"]["tl"],
            "bis": f["fact"].get("bis", "")}

# --- selection (tractable first-v4 sizes; scale after pilot QA) ---
N_MT, N_FAITH, N_ENG = 500, 200, 300
mt = random.sample(bank_safe, min(N_MT, len(bank_safe)))
faith = (val + random.sample([f for f in bank_safe if f not in val], max(0, N_FAITH - len(val))))[:N_FAITH]
illus = [f for f in bank_safe if f.get("domain") in ILLUSTRATABLE]
eng = random.sample(illus, min(N_ENG, len(illus)))

for sub, items in (("multiturn", mt), ("faithful", faith), ("engage", eng)):
    d = f"{WORK}/{sub}"
    os.makedirs(d, exist_ok=True)
    for x in glob.glob(f"{d}/*.json"): os.remove(x)
    rows = [item(f) for f in items]
    for j in range(0, len(rows), SH):
        json.dump(rows[j:j+SH], open(f"{d}/shard-{j//SH:03d}.json", "w"), ensure_ascii=False)
    print(f"{sub}: {len(rows)} facts -> {(len(rows)+SH-1)//SH} shards (x{SH})")
print(f"\nbank: {len(facts)} | AUP-safe: {len(bank_safe)} | val(safe): {len(val)} | illustratable(safe): {len(illus)}")

# --- AUP VERIFICATION GATE: scan every sharded fact for body-bio leaks; assert ZERO ---
leak = 0
for sf in glob.glob(f"{WORK}/*/shard-*.json"):
    for it in json.load(open(sf)):
        blob = (it.get("en", "") + " " + it.get("tl", "") + " " + it.get("topic", "") + " " + it.get("id", "")).lower()
        if SENS.search(blob) or BODY_VAL.search(it.get("id", "")):
            leak += 1; print(f"  ⚠️ AUP LEAK in {sf}: {it['id']} — {it.get('topic','')}")
print(f"AUP verification: {leak} body-bio facts in shards (must be 0)" + (" ✅" if leak == 0 else " ❌ FIX BEFORE GENERATING"))
