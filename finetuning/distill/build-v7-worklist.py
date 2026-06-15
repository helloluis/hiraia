#!/usr/bin/env python3
"""v7 worklist — TARGETED safety/myth patch on top of v6 (see hiraia-safety-myth-negation-bug).

Bug (temp 0.5, both v5+v6): yes/no SAFETY and MYTH questions get a reflexive mis-scoped "Hindi po"
opener — "Masama ba manigarilyo?" -> "Hindi po, hindi masama" (dangerous); "Totoo bang 10% lang ng
utak?" -> affirmed. Root cause = the heavy abstain/refuse "Hindi po…" opener over-training.

Fix = retrain the OPENER PATTERN on yes/no questions with CORRECT, MIXED polarity so the model learns
to EVALUATE the claim, not reflexively negate:
  - confident_safety : "Masama/Delikado ba X?" -> confident correct-polarity answer (Oo, delikado… for
                       genuinely dangerous; Hindi naman, lig", for safe/good things).
  - myth_debunk      : "Totoo ba X?" -> "Hindi po, hindi totoo… ang totoo ay…" for false myths;
                       "Oo po, totoo…" for true facts.

AUP CONSTRAINT: the actual failing topics (smoking->lungs, brain) are body/biology and MUST NOT reach
the Claude teacher. So ALL v7 seeds are NON-BODY (fire, electricity, lightning, water, flat-earth,
moon, planets…); we rely on the opener pattern GENERALIZING to the body cases, verified at temp 0.5.
The AUP gate below also checks the SEED text (not just facts) to enforce this.

Out: finetuning/distill/work-v7/{confident_safety,myth_debunk}/shard-NNN.json
"""
import json, re, os, glob, random

BANK = "rag/bank/science-facts.jsonl"
WORK = "finetuning/distill/work-v7"
SH = 12
SENS = re.compile(r"\b("
    r"dugo|blood|tiyan|sikmura|stomach|bituka|intestine|buto|bukog|bone|skeleton|kalansay|"
    r"puso|heart|cardiac|baga|lung|utak|brain|atay|liver|kidney|bato\s|lymph|node|immune|antibody|"
    r"germ|mikrobyo|bakterya|bacteri|virus|sakit|disease|lagnat|fever|sintomas|symptom|jaundice|"
    r"mucus|plema|swelling|namamaga|burn|paso|leech|linta|spine|gulugod|joint|kasukasuan|nerve|nerbiyo|"
    r"muscle|kalamnan|litid|tendon|organ|balat|skin|hininga|paghinga|breath|inhale|exhale|langhap|"
    r"reproduc|puberty|pagbibinata|pagdadalaga|sexual|menstr|regla|hormone|kasarian|ari\b|maselang|"
    r"suso|breast|dibdib|chest|leeg|neck|ngipin|teeth|tooth|dila|tongue|tainga|ear|ilong|nostril|"
    r"pawis|sweat|ihi|urine|dumi\b|waste|lalamunan|throat|esophagus|digest|tunaw|metabol|sigarilyo|nikotina|"
    r"selula\s|cell\b|tissue|tisyu|nutrient sa katawan|tubig sa katawan|body water|body temperature"
    r")\b", re.I)
BODY_VAL = re.compile(r"val-(human|body|heart|breathing|blood|largest-organ)", re.I)

# yes/no SAFETY seeds (NON-body), MIXED polarity + a topic keyword for grounding. The teacher answers
# with the CORRECT polarity — dangerous->affirm danger, safe->reassure — never a mis-scoped negation.
SAFETY_SEEDS = [
    ("Delikado po ba ang maglaro ng posporo o apoy?",                 r"apoy|fire|sunog|init"),
    ("Delikado po ba ang humawak ng kawad ng kuryente?",              r"kuryente|electric|kawad|wire"),
    ("Delikado po ba ang tumayo sa labas kapag may kidlat?",          r"kidlat|lightning|kulog|bagyo"),
    ("Masama po ba ang uminom ng tubig na hindi malinis?",            r"tubig|malinis|water"),
    ("Delikado po ba ang maglaro ng matalim na gunting?",             r"matalim|gunting|sharp"),
    ("Delikado po ba ang lumangoy sa malalim na tubig nang mag-isa?", r"tubig|dagat|lumangoy|malalim"),
    ("Delikado po ba ang magsindi ng apoy sa loob ng bahay?",         r"apoy|fire|usok|sunog"),
    ("Delikado po ba ang sumakay sa motor nang walang helmet?",       r"helmet|motor|ulo"),
    ("Delikado po ba ang lumapit sa baha o rumaragasang tubig?",      r"baha|tubig|flood"),
    ("Delikado po ba ang tumingin nang diretso sa Araw?",             r"araw|sun|liwanag"),
    ("Masama po ba ang kumain ng prutas at gulay araw-araw?",         r"prutas|gulay|fruit|halaman"),
    ("Masama po ba ang maglaro sa labas tuwing umaga?",               r"araw|umaga|laro"),
    ("Masama po ba ang magtanim ng puno at halaman?",                 r"puno|halaman|tanim"),
    ("Masama po ba ang magsuot ng helmet kapag nagbibisikleta?",      r"helmet|bisikleta|ulo"),
    ("Masama po ba ang magtipid ng tubig at kuryente?",               r"tubig|kuryente|tipid"),
    ("Masama po ba ang magtapon ng basura sa ilog?",                  r"basura|ilog|polusyon|tubig"),
]
# yes/no MYTH seeds (NON-body), MIXED truth value. False myth -> "Hindi totoo, ang totoo…"; true -> "Oo".
MYTH_SEEDS = [
    ("Totoo po bang patag ang Earth?",                                          r"earth|daigdig|mundo|bilog"),
    ("Totoo po bang gawa sa keso ang Buwan?",                                   r"buwan|moon|bato"),
    ("Totoo po bang hindi tumatama nang dalawang beses ang kidlat sa iisang lugar?", r"kidlat|lightning"),
    ("Totoo po bang umiikot ang Araw sa Earth?",                                r"araw|earth|umiikot|solar"),
    ("Totoo po bang mas mabilis bumagsak ang mabigat na bagay kaysa magaan?",   r"bagsak|grabidad|gravity|bigat"),
    ("Totoo po bang nakikita ang Great Wall of China mula sa kalawakan gamit ang mata?", r"kalawakan|space|mundo"),
    ("Totoo po bang walang grabidad sa kalawakan?",                            r"grabidad|gravity|kalawakan|astronaut"),
    ("Totoo po bang malamig ang kalawakan kaya malamig ang mga bituin?",        r"bituin|star|init|kalawakan"),
    ("Totoo po bang umiikot ang Earth sa Araw?",                                r"earth|araw|umiikot|solar"),
    ("Totoo po bang may walong planeta sa ating solar system?",                 r"planeta|solar|walo"),
    ("Totoo po bang bilog (parang bola) ang hugis ng Earth?",                   r"earth|bilog|mundo|daigdig"),
    ("Totoo po bang kailangan ng halaman ang sikat ng araw para mabuhay?",      r"halaman|araw|photosynthesis"),
    ("Totoo po bang mas mabigat ang bakal kaysa sa parehong laki ng bula?",     r"bakal|metal|bigat|density|timbang"),
    ("Totoo po bang nagiging tubig ang yelo kapag natunaw?",                    r"yelo|tubig|natunaw|ice"),
]

facts = [json.loads(l) for l in open(BANK) if l.strip()]
def safe(f):
    if BODY_VAL.search(f["id"]): return False
    blob = (f["fact"].get("en","") + " " + f["fact"].get("tl","") + " " + f.get("topic","") + " " + f["id"]).lower()
    return not SENS.search(blob)
bank_safe = [f for f in facts if safe(f)]
random.seed(17)

def item(f):
    return {"id": f["id"], "domain": f.get("domain",""), "topic": f.get("topic",""),
            "en": f["fact"]["en"], "tl": f["fact"]["tl"], "bis": f["fact"].get("bis","")}
def blob_of(f):
    return (f["fact"].get("en","")+" "+f["fact"].get("tl","")+" "+f.get("topic","")+" "+f["id"]).lower()

N_PER = 5
def build(seeds):
    rows = []
    for i, (seed, pat) in enumerate(seeds):
        rx = re.compile(pat, re.I)
        pool = [f for f in bank_safe if rx.search(blob_of(f))]
        for j in range(N_PER):
            base = {"seed": seed}
            if pool:
                base.update(item(random.choice(pool)))
            else:
                base["id"] = f"nofact-{i:02d}-{j}"
            rows.append(base)
    return rows

confident_safety_rows = build(SAFETY_SEEDS)
myth_debunk_rows = build(MYTH_SEEDS)

for sub, rows in (("confident_safety", confident_safety_rows), ("myth_debunk", myth_debunk_rows)):
    d = f"{WORK}/{sub}"; os.makedirs(d, exist_ok=True)
    for x in glob.glob(f"{d}/*.json"): os.remove(x)
    for j in range(0, len(rows), SH):
        json.dump(rows[j:j+SH], open(f"{d}/shard-{j//SH:03d}.json","w"), ensure_ascii=False)
    print(f"{sub}: {len(rows)} rows -> {(len(rows)+SH-1)//SH} shards")
print(f"\nbank: {len(facts)} | AUP-safe: {len(bank_safe)}")

# AUP verification — checks FACTS *and* SEEDS (v7 seeds must be non-body so they're safe for Claude).
leak = 0
for sf in glob.glob(f"{WORK}/*/shard-*.json"):
    for it in json.load(open(sf)):
        b = (it.get("en","")+" "+it.get("tl","")+" "+it.get("topic","")+" "+it.get("id","")+" "+it.get("seed","")).lower()
        if SENS.search(b) or BODY_VAL.search(it.get("id","")): leak += 1; print(f"  LEAK {sf}: {it.get('id')} / {it.get('seed','')[:40]}")
print(f"AUP verification (facts+seeds): {leak} leaks (must be 0)" + (" OK" if leak == 0 else " FIX"))
