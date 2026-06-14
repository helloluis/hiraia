#!/usr/bin/env python3
"""Builder for the bisaya c-gibberish batch (15 rows). Pulls grounding facts
VERBATIM from rag/bank/science-facts.jsonl by (topic, bis-prefix)."""
import json, os

ROOT = "/Users/luis/Code/hiraia"
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(ROOT, "finetuning", "datasets", "v5-work", "bisaya-c-gibberish.jsonl")

G_HEAD = "VERIFIED FACTS FROM THE CURRICULUM (use these as your source of truth):"
G_TAIL = ("When the question is answered by the facts above, base your explanation on them "
          "and do not contradict them. Still teach in your own words at the student's level "
          "— do not just copy the fact. If the facts above do not cover the question, "
          "answer carefully from general knowledge and say so if you are unsure.")

# (topic, bis-prefix to disambiguate)
WANTED = {
    "wood": ("wood is a natural material from trees", "Ang kahoy usa ka natural"),
    "rock": ("what is a rock", "Ang bato usa ka gahi"),
    "sundial": ("A sundial cannot tell time at night", "Dili molihok ang sundial"),
    "soup": ("boiling water cooks soup with heat", "Sa nilagang baboy"),
    "collision": ("collision transfers motion", "Sa bilyar"),
    "atoms": ("atoms are not created or destroyed", "Ang matter dili lang basta"),
    "meteor": ("a falling star is really a meteor", "Ang gitawag nga bulalakaw"),
    "balloon": ("Why a balloon puffs into a round shape", "Kung huypan"),
    "taal": ("Taal viewed from Tagaytay", "Nindot ang talan-awon"),
    "galaxy": ("types of galaxy shapes", "Adunay lain-laing matang sa galaksiya"),
    "momentum": ("Units of momentum kilogram meter per second", "Ang momentum gisukod"),
    "intensity": ("what makes intensity high", "Motaas ang gibating intensity"),
    "plates": ("global pattern of plate boundaries", "Adunay tin-aw nga kalibutanon"),
}

facts = {}
with open(BANK) as f:
    for line in f:
        r = json.loads(line)
        bis = r.get("fact", {}).get("bis")
        if not bis:
            continue
        for key, (topic, prefix) in WANTED.items():
            if key not in facts and r.get("topic") == topic and bis.startswith(prefix):
                facts[key] = (topic, bis)
missing = set(WANTED) - set(facts)
assert not missing, f"facts not found in bank: {missing}"

def grounded(key, msg):
    topic, bis = facts[key]
    return f"{G_HEAD}\n- ({topic}) {bis}\n\n{G_TAIL}\n\n{msg}"

ROWS = [
    # grade, fact-key (None = raw), gibberish user msg, assistant clarification
    ("3", "wood", "asdkjfhg",
     "Morag napislit ra ang imong keyboard! Unsa may gusto nimong ipangutana?"),
    ("3", "rock", "??????",
     "Puro question mark man ni! Unsa may pangutana nimo karon?"),
    ("4", "sundial", "e",
     "Wala ra kaayo ko kasabot ana — unsa may buot nimong isulti?"),
    ("4", None, "....",
     "Hilom ra man na nga mga tuldok! Unsa may gusto nimong tun-an nato karon?"),
    ("5", "soup", "unsaon man pag",
     "Morag naputol imong mensahe. Unsa diay tong gusto nimong unsaon?"),
    ("5", "collision", "kanang ano gud",
     "Hmm, wala ko kasabot. Unsa man diay tong imong gipasabot?"),
    ("5", "atoms", "saging kompyuter",
     "Nalibog ko anang duha ka pulong! Unsa man gyud ang gusto nimong ipangutana?"),
    ("6", "meteor", "\U0001F438\U0001F680\U0001F355\U0001F602",
     "Nindot nang mga emoji! Unsa may gusto nimong mahibal-an karon?"),
    ("6", "balloon", "ha",
     "Hmm, unsa may buot nimong isulti? Ania ra ko kung naa kay pangutana."),
    ("6", "taal", "ganina tong",
     "Morag wala nahuman imong gisulti — unsa tong ganina nga buot nimong ipangutana?"),
    ("7", "galaxy", "jkjkjkjk",
     "Morag random nga mga letra man ni — unsa diay ang imong pangutana?"),
    ("7", None, "uy",
     "Uy, kumusta! Unsa may gusto nimong tun-an karon sa science?"),
    ("8", "momentum", "qwert poiu zx",
     "Wala koy nasabtan anang mga letra — unsa may imong buot isulti?"),
    ("9", "intensity", "?!?!?!",
     "Naa kay gustong ipangutana? Isulat lang kini sa tibuok nga pangutana, ha."),
    ("10", "plates", "orasan isda",
     "Duha ka managlahi nga pulong man ni — unsa gyud ang gusto nimong tun-an?"),
]

with open(OUT, "w") as out:
    for grade, key, msg, asst in ROWS:
        user = grounded(key, msg) if key else msg
        row = {"grade": grade, "messages": [
            {"role": "user", "content": user},
            {"role": "assistant", "content": asst},
        ]}
        out.write(json.dumps(row, ensure_ascii=False) + "\n")
print(f"wrote {len(ROWS)} rows -> {OUT}")
for _, _, _, asst in ROWS:
    assert len(asst) <= 120, asst
print("all assistant turns <= 120 chars")
