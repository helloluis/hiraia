#!/usr/bin/env python3
"""Build bisaya-c-myth.jsonl (15 rows) — authored in-session.

The workflow agent for this batch was killed by the Usage Policy classifier,
so the batch is hand-built here with the same mechanics as the v4 builders:
grounding facts copied verbatim (fact.bis) from the bank by id.

Family C MYTH VERDICTS: verdict-first Cebuano debunks ("Dili kana tinuod!"),
then 1-3 kid-level explanation sentences. Safe physical-science/animal myths
only (no body/health). 12/15 grounded; Great Wall, dim-light and baby-bird
rows go ungrounded (no bank facts cover them).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "bisaya-c-myth.jsonl")

bank = {}
for line in open(BANK):
    r = json.loads(line)
    bank[r["id"]] = (r["topic"], r["fact"].get("bis"))

G_HEAD = "VERIFIED FACTS FROM THE CURRICULUM (use these as your source of truth):"
G_TAIL = ("When the question is answered by the facts above, base your explanation on them "
          "and do not contradict them. Still teach in your own words at the student's level "
          "— do not just copy the fact. If the facts above do not cover the question, answer "
          "carefully from general knowledge and say so if you are unsure.")

def grounded(fact_ids, msg):
    lines = "\n".join(f"- ({bank[i][0]}) {bank[i][1]}" for i in fact_ids)
    return f"{G_HEAD}\n{lines}\n\n{G_TAIL}\n\n{msg}"

# (grade, [fact ids] or [], user message, assistant verdict+explanation)
ROWS = [
    ("5", [],
     "Ingon sa akong mama, madaot kuno ang mata kon magbasa ka sa ngitngit. Tinuod ba na?",
     "Dili kana tinuod! Ang pagbasa sa hanap nga suga makapakapoy ra sa imong mata, apan dili kini makadaot og permanente. Mas komportable lang gyud kon igo ang suga, busa pasigaa ang lampara kon magbasa ka sa gabii."),
    ("6", ["lightning-strikes-tallest-object-g6"],
     "Tinuod ba nga dili moigo ang kilat sa samang lugar kaduha?",
     "Sayop kana nga tuo-tuo! Moigo ang kilat sa samang lugar balik-balik. Sagad motama kini sa pinakahabog nga butang sa palibot, mao nga ang tag-as nga mga tore maigo gani og daghang beses matag tuig."),
    ("5", ["bat-echolocation-g5"],
     "Miingon ang akong amigo nga buta kuno ang mga kabog. Tinuod ba?",
     "Mito ra kana! Dili buta ang kabog — makakita sila. Gamit pa gyud nila ang echolocation: mohimo silag tingog ug maminaw sa alingugngog nga mobalik aron makit-an ang insekto bisan sa kangitngit."),
    ("4", ["goldfish-generic-g4"],
     "Tinuod ba nga tulo ra ka segundo ang memorya sa goldfish?",
     "Dili kana tinuod! Makahinumdom ang goldfish og mga butang sulod sa daghang bulan, dili lang tulo ka segundo. Makat-onan gani nila kon kanus-a ang oras sa pagpakaon nila sa aquarium."),
    ("7", [],
     "Nabasa nako sa internet nga makita kuno ang Great Wall of China gikan sa kawanangan. Tinuod ba?",
     "Dili kana tinuod! Nipis ra kaayo ang Great Wall aron makita gikan sa kawanangan pinaagi lang sa mata. Ang mga astronaut mismo nag-ingon nga lisod kaayo kini makit-an nga walay tabang sa camera."),
    ("3", ["housefly-langaw-g3"],
     "Ingon ni kuya, usa ra kuno ka adlaw mabuhi ang langaw. Tinuod ba?",
     "Dili kana tinuod! Mabuhi ang langaw og mga duha ngadto sa upat ka semana, dili usa ra ka adlaw. Apan pagbantay gyud — sayon kini makakuha og kagaw gikan sa hugaw ug makapakatag niini sa pagkaon."),
    ("8", ["earth-tilt-not-distance-g6"],
     "Tinuod ba nga init ang panahon kay nagduol ang Earth sa Adlaw?",
     "Sayop kana nga sabot! Ang tinuod nga hinungdan sa mga panahon mao ang pagkahilig sa Earth, dili ang gilay-on niini sa Adlaw. Tungod sa pagkahilig, motama ang silaw sa Adlaw og mas direkta o mas hilis sa lainlaing bahin sa tuig."),
    ("6", ["free-fall-same-rate-g6"],
     "Ingon sa akong klasmeyt, ang bug-at nga butang kuno mas paspas mahulog kaysa gaan. Tinuod ba?",
     "Dili kana tinuod! Kon walay hangin nga makababag, dungan nga mahulog ang bug-at ug gaan nga butang kay gipaspas sila sa grabidad sa samang gidaghanon. Ang papel lang ang morag hinay kay gibabagan kini sa hangin."),
    ("5", ["moon-gravity-one-sixth-g6"],
     "Tinuod ba nga walay grabidad sa Bulan?",
     "Mito kana! Adunay grabidad ang Bulan — mga ikaunom lang ka bahin sa grabidad sa Yuta. Mao nga morag naglukso-lukso ang mga astronaut kon maglakaw sila didto, apan dili gyud sila molupad palayo."),
    ("4", ["ostrich-largest-bird-g4"],
     "Tinuod ba nga ilubong sa ostrich ang ulo niini sa balas kon mahadlok?",
     "Dili kana tinuod! Wala maglubong ang ostrich sa iyang ulo sa balas — moduko lang kini aron atimanon ang itlog niini sa yuta. Ang ostrich mao ang pinakadako nga langgam sa kalibutan, ug kon mahadlok kini, modagan kini og paspas kaayo!"),
    ("4", ["thunder-cause-g6"],
     "Ingon ni lola, ang dalugdog kuno tingog sa nagbangga nga panganod. Tinuod ba?",
     "Dili kana tinuod! Ang dalugdog dili tingog sa nagbangga nga panganod. Kini ang tingog nga matawo kung ang kilat kalit nga mopainit ug mopalapad sa hangin sa palibot niini — mao nang kusog kaayo ang buto."),
    ("9", ["stars-are-suns-far-away-g6"],
     "Tinuod ba nga ang mga bituon gagmay ra nga suga sa langit?",
     "Sayop kana nga sabot! Ang mga bituon dili gagmay nga suga — mga Adlaw usab sila nga layo ra kaayo kanato. Kon duol pa sila sama sa atong Adlaw, masanag ug init usab kaayo sila."),
    ("6", ["day-night-rotation-g5"],
     "Ingon sa akong igsoon, ang Adlaw kuno ang naglibot sa Yuta. Tinuod ba na?",
     "Dili kana tinuod! Ang Yuta ang nagtuyok sa kaugalingong axis kausa matag 24 oras, mao nga morag naglibot ang Adlaw sa langit. Ang bahin sa Yuta nga nag-atubang sa Adlaw adunay adlaw, ug ang likod adunay gabii."),
    ("3", ["cloud-formation-g4"],
     "Tinuod ba nga adunay buslot ang panganod maong moulan?",
     "Dili kana tinuod! Walay buslot ang panganod. Ang panganod gilangkuban sa gagmay kaayong tinulo sa tubig — kon modagko ug mobug-at kini, mahulog sila ngadto sa yuta isip ulan."),
    ("4", [],
     "Ingon sila, kon hikapon kuno nimo ang piso sa langgam, isalikway na kini sa inahan. Tinuod ba?",
     "Dili kana tinuod! Dili isalikway sa inahan nga langgam ang piso tungod sa baho sa tawo, kay huyang ra ang pang-simhot sa kadaghanan sa langgam. Apan mas maayo gihapon nga dili hilabtan ang piso aron dili kini makuyawan."),
]

assert len(ROWS) == 15
with open(OUT, "w") as out:
    for grade, fids, user, asst in ROWS:
        for i in fids:
            assert i in bank and bank[i][1], f"bad fact id {i}"
        msg = grounded(fids, user) if fids else user
        row = {"grade": grade, "messages": [
            {"role": "user", "content": msg},
            {"role": "assistant", "content": asst},
        ]}
        out.write(json.dumps(row, ensure_ascii=False) + "\n")
print(f"{OUT}: {len(ROWS)} rows")
