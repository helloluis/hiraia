#!/usr/bin/env python3
"""Assemble bisaya-a-neg.jsonl (Family A negatives — 15 rows, NO [image:] tag, Cebuano).

Mirror of build-tagalog-a-neg.py: same fact ids, Cebuano text.
~11 pop-culture / non-science image requests -> friendly redirect (offer only, no tag).
~4 too-vague requests -> ONE clarifying question, no tag.
Rows 9, 13, 15 are plain (no grounding block).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "bisaya-a-neg.jsonl")

bank = {}
for line in open(BANK):
    r = json.loads(line)
    bank[r["id"]] = (r["topic"], r["fact"]["bis"])

G_HEAD = "VERIFIED FACTS FROM THE CURRICULUM (use these as your source of truth):"
G_TAIL = ("When the question is answered by the facts above, base your explanation on them "
          "and do not contradict them. Still teach in your own words at the student's level "
          "— do not just copy the fact. If the facts above do not cover the question, answer "
          "carefully from general knowledge and say so if you are unsure.")

def grounded(fact_ids, msg):
    if not fact_ids:
        return msg
    lines = "\n".join(f"- ({bank[i][0]}) {bank[i][1]}" for i in fact_ids)
    return f"{G_HEAD}\n{lines}\n\n{G_TAIL}\n\n{msg}"

# (grade, [fact ids] (may be empty), student msg, assistant answer — NO tag)
ROWS = [
    # --- pop-culture / non-science (redirect, offer only) ---
    ("5", ["faq-why-rainbow"],
     "Naa ka'y picture sa akong paborito nga artista?",
     "Ay, mga hulagway nga pang-science ra ang dala nako dinhi! Apan kung gusto nimo, mapakita nako kung giunsa paglihok ang tingog sa usa ka singer — kanang vocal cords nga mag-vibrate sa tutunlan. Ganahan ka?"),
    ("4", ["fme-electricity-g5"],
     "Ipakita ra gud kanang character sa video game nga akong gidula!",
     "Dili nako mapakita ang mga video game character — science ang akong specialty! Apan kahibalo ka ba nga naay science usab sa imong pagdula? Mapakita nako kung giunsa pagdagayday ang kuryente aron molihok ang imong gadget. Gusto ka?"),
    ("6", ["living-microorganisms-g7"],
     "Naa ka'y hulagway sa akong paborito nga anime character?",
     "Wala koy mga anime picture — puro science ang naa sa akong album! Apan kung ganahan ka sa mga talagsaong binuhat, mapakita nako ang mga tinuod nga mananap nga morag gikan sa anime, sama sa tarsier nga dako kaayo og mata. Interesado ka?"),
    ("3", ["living-plant-parts-g3"],
     "Ipakita kanang logo sa akong paborito nga fast food!",
     "Wala ko magtago og mga logo — mga hulagway nga pang-science ra! Apan naa koy nindot nga puli: gusto ba nimo makita kung unsa nga mga pagkaon ang makapakusgan ug makapataas nimo?"),
    ("7", ["jeepney-stop-passengers-lurch-g7"],
     "Gusto nako makita kanang bag-o nga sports car nga mahalon!",
     "Mga hulagway nga pang-science ra ang akong mapakita, dili mga bag-ong sakyanan. Apan kung ganahan ka sa sakyanan, mapakita nako kung giunsa paghimo sa makina nga lihok ang gasolina — didto man usab magsugod ang kapaspas sa sports car. Tara?"),
    ("5", ["val-heart-rate"],
     "Naa ka'y picture sa sikat nga basketball player?",
     "Wala koy mga hulagway sa basketball stars — science pictures ra gyud! Apan naay science sa basketball: mapakita nako kung giunsa pagpaspas ang pitik sa imong kasingkasing kung molukso ug modagan ka sa court. Gusto ka ana?"),
    ("4", ["jeepney-horn-blast-g5"],
     "Ipakita ra gud kanang akong paborito nga K-pop group!",
     "Dili nako mapakita ang mga K-pop idol — mga science illustration ra ang naa nako! Apan kung ganahan ka sa musika, mapakita nako kung giunsa pagbiyahe sa tingog diha sa hangin aron madungog nimo ang ilang kanta. Sulayan nato?"),
    ("6", ["earth-lightning-g6"],
     "Naa ka'y hulagway anang superhero sa salida nga paspas kaayo?",
     "Mga tinuod nga katingalahan sa science ra ang naa sa akong koleksyon, dili mga superhero! Apan naay parehas ka-nindot: ang kilat — mas paspas pa ang kahayag niini kaysa bisan unsang superhero. Gusto nimo makita kung giunsa kini pagporma?"),
    ("3", [],
     "Ipakita si Peppa Pig!",
     "Wala koy mga cartoon character — mga hulagway sa tinuod nga kalibutan ang akong dala! Apan kung gusto nimo og baboy, naa koy mas talagsaon: gusto ba nimo makita ang baboy-ihalas o kaha ang ubang mananap sa uma?"),
    ("8", ["fme-lenses-mirrors-g6"],
     "Naa ka'y picture sa sikat nga vlogger nga akong gisubay?",
     "Dili nako mapakita ang mga vlogger — science ang akong linya! Apan may kalabotan kana sa science: mapakita nako kung giunsa pagdakop sa lens sa camera ang kahayag aron maporma ang video nga imong gitan-aw. Interesado ka?"),
    ("5", ["living-body-systems-g5"],
     "Ipakita ra gud kanang sikat nga TikTok dance!",
     "Dili ko magpakita og mga sayaw o video — mga science picture ra! Apan nindot kaayo ang imong lawas kung mosayaw ka: mapakita nako ang mga kaunoran ug bukog nga magtinabangay sa matag lihok nimo. Gusto nimo makita?"),
    # --- too vague (one clarifying question, no tag) ---
    ("4", ["living-life-cycle-g4"],
     "Ipakita usab kanang gahapon.",
     "Gusto tika tabangan! Asa man sa atong mga gihisgotan gahapon ang gusto nimo makita pag-usab — naa ba kay nahinumdoman nga topic, sama sa mananap o tanom?"),
    ("5", [],
     "Picture sa imong giingon.",
     "Sige, apan unsa man sa akong mga gisulti ang gusto nimo makita? Isulti lang kung unsa nga butang o mananap kadto aron mapakita nako ang sakto."),
    ("6", ["earth-typhoon-g5"],
     "Ipakita kanang picture.",
     "Unsa man nga picture ang imong gipangita? Isulti kung bahin sa unsa kini — pananglitan, bagyo, tanom, o bahin sa lawas — aron makit-an dayon nako."),
    ("3", [],
     "Ipakita to usab!",
     "Asa man to usab? Isulti kung unsa ang naa sa hulagway — mananap ba, tanom, o lain pa — aron mapakita nako pag-usab kanimo."),
]

with open(OUT, "w") as f:
    for grade, fids, msg, ans in ROWS:
        row = {"grade": grade, "messages": [
            {"role": "user", "content": grounded(fids, msg)},
            {"role": "assistant", "content": ans},
        ]}
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
print(f"wrote {len(ROWS)} rows -> {OUT}")
