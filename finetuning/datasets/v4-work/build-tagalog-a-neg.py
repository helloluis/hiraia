#!/usr/bin/env python3
"""Assemble tagalog-a-neg.jsonl (Family A negatives — 15 rows, NO [image:] tag).

~11 pop-culture / non-science image requests -> friendly 1-2 sentence redirect
toward a science topic the tutor could show instead (offer only, no tag emitted).
~4 too-vague requests -> ONE clarifying question, no tag.
Most rows still carry a tangential grounding block (the device always retrieves
something); rows 9, 13, 15 are plain (no block).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "tagalog-a-neg.jsonl")

bank = {}
for line in open(BANK):
    r = json.loads(line)
    bank[r["id"]] = (r["topic"], r["fact"]["tl"])

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
     "May picture ka ba ng paborito kong artista?",
     "Naku, mga larawang pang-agham lang ang dala ko rito! Pero kung gusto mo, maipapakita ko kung paano gumagana ang boses ng isang singer — yung vocal cords na nagvavibrate sa lalamunan. Game ka ba?"),
    ("4", ["fme-electricity-g5"],
     "Pakita mo naman yung character sa video game na nilalaro ko!",
     "Hindi ko kayang ipakita ang mga video game character — science ang specialty ko! Pero alam mo bang may science din sa paglalaro mo? Maipapakita ko kung paano dumadaloy ang kuryente para gumana ang gadget mo. Gusto mo?"),
    ("6", ["living-microorganisms-g7"],
     "May larawan ka ba ng paborito kong anime character?",
     "Wala akong mga anime picture — puro agham ang nasa album ko! Pero kung mahilig ka sa mga kakaibang nilalang, maipapakita ko ang mga totoong hayop na parang galing sa anime, tulad ng tarsier na napakalaki ng mata. Interesado ka ba?"),
    ("3", ["living-plant-parts-g3"],
     "Pakita mo yung logo ng paborito kong fast food!",
     "Hindi ako nagtatago ng mga logo — mga larawang pang-science lang! Pero may magandang kapalit ako: gusto mo bang makita kung anu-anong pagkain ang nagpapalakas at nagpapatangkad sa iyo?"),
    ("7", ["jeepney-stop-passengers-lurch-g7"],
     "Gusto ko makita yung bagong sports car na mamahalin!",
     "Mga larawang pang-agham lang ang kaya kong ipakita, hindi mga bagong kotse. Pero kung mahilig ka sa sasakyan, maipapakita ko kung paano ginagawang galaw ng makina ang gasolina — doon din naman nagsisimula ang bilis ng sports car. Tara?"),
    ("5", ["val-heart-rate"],
     "May picture ka ba ng sikat na basketball player?",
     "Wala akong mga larawan ng basketball stars — science pictures lang talaga! Pero may science sa basketball: maipapakita ko kung paano bumibilis ang tibok ng puso mo kapag tumatalon at tumatakbo ka sa court. Gusto mo iyon?"),
    ("4", ["jeepney-horn-blast-g5"],
     "Pakita mo naman yung paborito kong K-pop group!",
     "Hindi ko maipapakita ang mga K-pop idol — mga science illustration lang ang meron ako! Pero kung mahilig ka sa musika, maipapakita ko kung paano naglalakbay ang tunog sa hangin para marinig mo ang kanta nila. Subukan natin?"),
    ("6", ["earth-lightning-g6"],
     "May larawan ka ba nung superhero sa pelikula na ang bilis-bilis?",
     "Mga totoong kababalaghan ng agham lang ang nasa koleksyon ko, hindi mga superhero! Pero may kasing-astig: ang kidlat — mas mabilis pa ang liwanag nito kaysa kahit anong superhero. Gusto mo makita kung paano ito nabubuo?"),
    ("3", [],
     "Pakita mo si Peppa Pig!",
     "Wala akong mga cartoon character — mga larawan ng totoong mundo ang dala ko! Pero kung gusto mo ng baboy, may mas kakaiba ako: gusto mo bang makita ang baboy-ramo o kaya ang ibang hayop sa bukid?"),
    ("8", ["fme-lenses-mirrors-g6"],
     "May picture ka ba ng sikat na vlogger na sinusubaybayan ko?",
     "Hindi ko maipapakita ang mga vlogger — science ang linya ko! Pero kaugnay iyan ng agham: maipapakita ko kung paano hinuhuli ng lens ng camera ang liwanag para mabuo ang video na pinapanood mo. Interesado ka?"),
    ("5", ["living-body-systems-g5"],
     "Pakita mo naman yung sikat na TikTok dance!",
     "Hindi ako nagpapakita ng mga sayaw o video — mga science picture lang! Pero ang galing ng katawan mo kapag sumasayaw ka: maipapakita ko ang mga kalamnan at buto na nagtutulungan sa bawat galaw mo. Gusto mo makita?"),
    # --- too vague (one clarifying question, no tag) ---
    ("4", ["living-life-cycle-g4"],
     "Pakita mo ulit yung kahapon.",
     "Gusto kitang tulungan! Alin po ba sa mga napag-usapan natin kahapon ang ibig mong makita ulit — may paksa ka bang naaalala, tulad ng hayop o halaman?"),
    ("5", [],
     "Picture nung sinabi mo.",
     "Sige, pero ano po ba sa mga sinabi ko ang gusto mong makita? Sabihin mo lang kung anong bagay o hayop iyon para maipakita ko ang tama."),
    ("6", ["earth-typhoon-g5"],
     "Pakita mo yung picture.",
     "Anong picture po ba ang hinahanap mo? Sabihin mo kung tungkol saan ito — halimbawa, bagyo, halaman, o bahagi ng katawan — para mahanap ko agad."),
    ("3", [],
     "Pakita mo yun ulit!",
     "Alin po ulit iyon? Sabihin mo kung ano ang nasa larawan — hayop ba, halaman, o iba pa — para maipakita ko ulit sa iyo."),
]

with open(OUT, "w") as f:
    for grade, fids, msg, ans in ROWS:
        row = {"grade": grade, "messages": [
            {"role": "user", "content": grounded(fids, msg)},
            {"role": "assistant", "content": ans},
        ]}
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
print(f"wrote {len(ROWS)} rows -> {OUT}")
