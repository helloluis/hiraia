#!/usr/bin/env python3
"""v9 worklist — retry the PEDAGOGY lift without v8's safety regression (see
hiraia-safety-myth-negation-bug). v8 added warm/encouraging rows → the model became AGREEABLE
(affirmed myths, confabulated) → Safety 3.1→2.7, pedagogy flat. v9 changes the lever AND adds ballast.

Categories:
  - pedagogy_clear   : the SAFE pedagogy lever — explain settled science CLEARLY: simple everyday
                       words (define any term), a CONCRETE GROUNDED EXAMPLE (a real instance a
                       Filipino kid has seen — NOT an analogy/"parang"/metaphor, which risk
                       confabulation), clear structure that builds intuition. NEUTRAL tone: NO praise
                       or agreement openers ("ang galing mo", "Oo tama ka") — those are what bled into
                       agreeableness. Grounded in a verified fact (accurate). Concise.
  - myth_debunk      : BALLAST — reinforce "Hindi po, hindi totoo… ang totoo…" (false) / "Oo po,
                       totoo…" (true) so the pedagogy data can't erode myth-correction.
  - abstain          : BALLAST — reinforce honest abstention on unknowables (no confabulation).

AUP: body/bio facts excluded from the Claude teacher. Out: finetuning/distill/work-v9/{...}/shard-NNN.json
"""
import json, re, os, glob, random

BANK = "rag/bank/science-facts.jsonl"
WORK = "finetuning/distill/work-v9"
SH = 12
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

# Ballast seeds (reinforce v7 safety behavior). NON-BODY only (body myths can't go to the Claude
# teacher per AUP; the debunk PATTERN generalizes, as v7 showed). MIXED truth so it discriminates.
MYTH_SEEDS = [
    "Totoo po bang patag ang Earth?",                        # false
    "Totoo po bang gawa sa keso ang Buwan?",                 # false
    "Totoo po bang walang grabidad sa kalawakan?",           # false
    "Totoo po bang hindi tumatama ng dalawang beses ang kidlat sa iisang lugar?",  # false
    "Totoo po bang mas mabilis bumagsak ang mabigat na bagay kaysa magaan?",        # false
    "Totoo po bang umiikot ang Araw sa Earth?",              # false
    "Totoo po bang umiikot ang Earth sa Araw?",              # true
    "Totoo po bang may walong planeta sa solar system?",     # true
    "Totoo po bang kailangan ng halaman ang sikat ng araw?", # true
    "Totoo po bang nagiging tubig ang yelo kapag natunaw?",  # true
]
ABSTAIN_SEEDS = [
    "Ano po ang pinakamalaking bituin sa buong uniberso?",
    "Uulan po ba bukas sa amin sa Maynila?",
    "Ano po ang panalong numero sa lotto bukas?",
    "Pasado po ba ako sa exam ko kahapon?",
    "Saang barangay po nakatira ang kaklase kong si Juan?",
    "Ano po ang pangalan ng alagang aso ni Einstein?",
    "Ilang buhangin po ang nasa lahat ng beach sa mundo?",
    "Sino po ang pinakamatalinong tao sa kasaysayan?",
]

facts = [json.loads(l) for l in open(BANK) if l.strip()]
def safe(f):
    if BODY_VAL.search(f["id"]): return False
    blob = (f["fact"].get("en","") + " " + f["fact"].get("tl","") + " " + f.get("topic","") + " " + f["id"]).lower()
    return not SENS.search(blob)
bank_safe = [f for f in facts if safe(f)]
random.seed(19)

def item(f):
    return {"id": f["id"], "domain": f.get("domain",""), "topic": f.get("topic",""),
            "en": f["fact"]["en"], "tl": f["fact"]["tl"], "bis": f["fact"].get("bis","")}

pedagogy_rows = [item(f) for f in random.sample(bank_safe, min(100, len(bank_safe)))]
myth_rows = [{"id": f"v9-myth-{i:03d}", "seed": s} for i, s in enumerate([s for s in MYTH_SEEDS for _ in range(3)])]
abstain_rows = [{"seed": s, **item(random.choice(bank_safe))} for s in ABSTAIN_SEEDS for _ in range(4)]

for sub, rows in (("pedagogy_clear", pedagogy_rows), ("myth_debunk", myth_rows), ("abstain", abstain_rows)):
    d = f"{WORK}/{sub}"; os.makedirs(d, exist_ok=True)
    for x in glob.glob(f"{d}/*.json"): os.remove(x)
    for j in range(0, len(rows), SH):
        json.dump(rows[j:j+SH], open(f"{d}/shard-{j//SH:03d}.json","w"), ensure_ascii=False)
    print(f"{sub}: {len(rows)} rows -> {(len(rows)+SH-1)//SH} shards")
print(f"bank: {len(facts)} | AUP-safe: {len(bank_safe)}")

leak = 0
for sf in glob.glob(f"{WORK}/*/shard-*.json"):
    for it in json.load(open(sf)):
        b = (it.get("en","")+" "+it.get("tl","")+" "+it.get("topic","")+" "+it.get("id","")+" "+it.get("seed","")).lower()
        if SENS.search(b) or BODY_VAL.search(it.get("id","")): leak += 1; print(f"  LEAK {sf}: {it.get('id')} / {it.get('seed','')[:30]}")
print(f"AUP verification: {leak} leaks (must be 0)" + (" OK" if leak == 0 else " FIX"))
