#!/usr/bin/env python3
"""Assemble bisaya-a-pos-2.jsonl (Family A positives, set 2 — 23 rows, Cebuano).

Mirror of build-tagalog-a-pos-2.py: same fact ids (grounding uses fact.bis verbatim),
same English tag descs, Cebuano student/tutor text.
Off-topic (retrieval-hijack) grounding rows: 2, 5, 8, 12, 15, 19, 22.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "bisaya-a-pos-2.jsonl")

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
    lines = "\n".join(f"- ({bank[i][0]}) {bank[i][1]}" for i in fact_ids)
    return f"{G_HEAD}\n{lines}\n\n{G_TAIL}\n\n{msg}"

# (grade, [fact ids], student msg, assistant answer (no tag), tag desc)
ROWS = [
    # --- space ---
    ("6", ["val-planets-order"],
     "Ipakita ra gud ang planetang Saturn!",
     "Ania ang Saturn! Sikat kini tungod sa hayag niini nga mga singsing nga hinimo sa dili maihap nga piraso sa yelo ug bato nga nagtuyok niini. Mao kini ang ikaunom nga planeta gikan sa Adlaw.",
     "The planet Saturn with its bright rings around it."),
    ("5", ["living-food-chain-g5"],
     "Unsa man ang hitsura sa ibabaw sa bulan? Gusto unta nako makita.",
     "Ania ang ibabaw sa bulan! Puno kini sa dagko nga mga lungag nga gitawag og craters, nga gibilin sa mga bato gikan sa kawanangan nga nahulog didto. Tungod kay halos walay hangin ug ulan sa bulan, dili mapapas ang mga craters bisan binilyon ka tuig na ang milabay.",
     "A close view of a large round impact crater on the moon, with smaller craters around it."),
    ("6", ["faq-why-astronauts-float"],
     "Gusto nako makita ang astronaut nga naglutaw sa kawanangan!",
     "Ania ang astronaut! Hinumdomi: aduna gihapoy gravity sa kawanangan. Naglutaw sila tungod kay sila ug ang ilang spacecraft parehong padayon nga 'nahulog' palibot sa Earth — free fall ang tawag niini — mao nga gibati nila nga wala silay gibug-aton.",
     "An astronaut floating weightlessly in space outside the spacecraft."),
    ("6", ["action-reaction-rockets-g6"],
     "Ipakita ra gud ang rocket samtang molupad kini!",
     "Ania ang rocket sa pagsaka niini! Giduso niini paubos ang nagdilaab nga gas sa kusog kaayo, ug ang katumbas nga duso pabalik mao ang nag-alsa niini paitaas — mao kana ang action ug reaction.",
     "A rocket launching upward with flames and smoke below it."),
    ("4", ["how-bees-make-honey-g4"],
     "Naa ka'y picture sa tibuok solar system?",
     "Naa! Ania ang atong solar system — anaa sa tunga ang Adlaw, ug nagtuyok niini ang walo ka planeta. Ang atong Earth mao ang ikatulo gikan sa Adlaw.",
     "The solar system showing the sun in the center and the eight planets in order."),
    ("4", ["earth-solar-system-g4"],
     "Unsa man ang hitsura sa planetang Mars?",
     "Ania ang Mars! Gitawag kini og 'red planet' tungod kay pulahon-kapehon ang yuta niini — adunay sagol kini nga taya o rust. Mao usab kini ang planeta nga labing gisuhid sa mga robot nga rover karon.",
     "The planet Mars as a round globe with a polar ice cap and dark surface patches."),
    # --- volcanoes & weather ---
    ("6", ["earth-ph-volcanoes-g6"],
     "Ipakita ra gud ang Bulkang Mayon!",
     "Ania ang Bulkang Mayon sa Albay! Sikat kini sa tibuok kalibutan tungod sa halos perpekto niini nga porma og kono — talagsaon ang bulkan nga ingon niana kalingin ug kasimetriko ang kilid. Aktibo pa gihapon kini nga bulkan hangtod karon.",
     "Mayon volcano with its near-perfect cone shape."),
    ("5", ["mango-one-big-seed-g4"],
     "Naa ka'y hulagway sa Taal volcano?",
     "Naa! Ang Taal usa sa pinakagagmay nga aktibong bulkan sa kalibutan, apan talagsaon gyud kini: usa kini ka bulkan nga anaa sa tunga sa lanaw. Tan-awa:",
     "Taal volcano, a small volcano island sitting inside a lake."),
    ("6", ["faq-thunder-after-lightning"],
     "Ipakita ra gud ang kilat!",
     "Ania ang kilat! Usa kini ka dako kaayo nga pagbuto sa static electricity gikan sa mga panganod — mas init pa kini sa makadiyot kaysa sa ibabaw sa Adlaw. Mao gani nga sundan kini sa dahunog sa dalugdog.",
     "A bright lightning bolt striking down from dark storm clouds."),
    ("5", ["rainbow-colors-g4"],
     "Gusto nako makita ang balangaw!",
     "Ania ang balangaw! Maporma kini kung ang kahayag sa adlaw mobawog sulod sa mga tulo sa ulan ug magbulag-bulag sa mga kolor niini. Mao nga kasagaran nimo kining makita human sa ulan samtang naa pay adlaw.",
     "A rainbow arching over a green field."),
    ("5", ["why-ph-many-typhoons-g6"],
     "Unsa man ang hitsura sa bagyo kung tan-awon gikan sa taas?",
     "Ania ang bagyo gikan sa kawanangan! Morag nagtuyok nga puti nga spiral sa mga panganod kini, ug sa pinakatunga adunay gamay nga lungag nga gitawag og mata (eye) — katingad-an, didto mismo kalma ug halos walay hangin.",
     "A typhoon seen from space as a giant spiral of clouds with an eye at the center."),
    # --- simple machines & electricity ---
    ("5", ["val-human-teeth"],
     "Ipakita kung giunsa paglihok ang seesaw.",
     "Ania ang seesaw! Usa kini ka lever: ang lingkoranan usa ka taas nga barra nga mosaka-monaog sa usa ka tungtonganan sa tunga nga gitawag og fulcrum. Kung mas bug-at ang usa ka bata, kinahanglan molingkod siya nga mas duol sa tunga aron magbalanse sila.",
     "Two kids balancing on a seesaw in a playground."),
    ("4", ["faq-why-magnet-sticks"],
     "Naa ka'y picture sa magnet nga naay midikit nga butang?",
     "Naa! Ania ang magnet nga nag-alsa og lansang. Birahon sa magnet ang mga butang nga adunay puthaw o iron — mao nga pilit kaayo ang lansang bisan wala sila magdikit sa sinugdanan.",
     "A magnet picking up an iron nail."),
    ("5", ["circuit-complete-loop-g5"],
     "Ipakita ra gud kung unsa ang hitsura sa simple nga circuit.",
     "Ania ang simple nga circuit! Adunay baterya, mga alambre o wire, ug usa ka bombilya. Kung sirado ug tibuok ang lingin sa agianan, modagayday ang kuryente ug mosiga ang bombilya — putla ang agianan ug mapalong dayon kini.",
     "Building a simple circuit: a battery, two wires, and a small bulb connected so the bulb lights up."),
    ("5", ["val-temperature-scales"],
     "Unsa man ang hitsura sa pulley? Palihug ipakita.",
     "Ania ang pulley! Usa kini ka ligid nga giagian sa pisi. Kung birahon nimo paubos ang pisi, mosaka ang pikas tumoy — gipasayon niini ang pag-alsa, sama sa pagkalos og tubig gikan sa atabay.",
     "A pulley with a rope raising a bucket of water from a well."),
    # --- Philippine-specific ---
    ("3", ["carabao-national-animal-g3"],
     "Gusto nako makita ang kabaw!",
     "Ania ang kabaw! Kusgan kini nga katabang sa mga mag-uuma sa pagdaro sa uma. Ganahan usab kini molunang sa lapok aron magpabugnaw tungod kay gamay ra ang singot niini.",
     "A carabao grazing on grass in a field."),
    ("7", ["jeepney-stop-passengers-lurch-g7"],
     "Ipakita ra gud ang jeepney.",
     "Ania ang jeepney! Puno sa kolor ug disenyo ang atong nasudnong sakyanan. Sa sulod usab niini nimo mabati ang science — kung kalit kining mopreno, mopadayon gihapon og dagan ang imong lawas tungod sa inertia.",
     "A colorful decorated jeepney."),
    ("5", ["banaue-rice-terraces-g5"],
     "Unsa man ang hitsura sa Banaue Rice Terraces?",
     "Ania ang Banaue Rice Terraces! Morag dagko nga hagdanan nga gikulit sa atong mga katigulangan sa kilid sa bukid aron matamnan og humay ang titip nga yuta. Liboan ka tuig na ang pipila niini!",
     "The Banaue rice terraces carved like giant steps into the mountainside."),
    ("4", ["why-we-yawn-g3"],
     "Naa ka'y picture sa mangga?",
     "Naa! Ania ang mangga — ang nasudnong prutas sa Pilipinas. Sa sulod sa tam-is niini nga unod adunay usa ka dako nga liso, nga mahimong motubo isip bag-ong punoan sa mangga.",
     "A mango (mangga) fruit with its golden yellow skin."),
    ("4", ["tarsier-big-eyes-g4", "tarsier-smallest-primate-g4"],
     "Ipakita ra gud ang tarsier!",
     "Ania ang tarsier o mawmag! Sama ra kini kadako sa imong palad apan dako kaayo ang mga mata niini aron makakita sa ngitngit. Tungod kay dili niini malihok ang mga mata, ilibot na lang niini ang tibuok ulo aron motan-aw sa palibot.",
     "A Philippine tarsier with huge round eyes clinging to a branch."),
    # --- everyday science objects ---
    ("4", ["matter-made-of-particles-magnify-g4"],
     "Unsa man ang hitsura sa magnifying glass?",
     "Ania ang magnifying glass! Adunay lingin kini nga lens nga salamin nga mas baga sa tunga ug adunay kuptanan. Bawgon niini ang kahayag mao nga modako ang hitsura sa imong gitan-aw — perpekto alang sa gagmay nga butang sama sa hulmigas.",
     "A magnifying glass with a round lens and a handle."),
    ("5", ["pollination-g4"],
     "Palihug ipakita kung unsa ang hitsura sa thermometer.",
     "Ania ang thermometer! Adunay nipis kini nga tubo nga naay likido sa sulod. Kung moinit, modako ang likido ug mosaka kini sa tubo — mao nga ang gitas-on sa likido mao ang magsulti sa temperatura diha sa iskala.",
     "Reading a liquid thermometer with its scale of numbers."),
    ("6", ["fme-magnetism-g4"],
     "Naa ka'y hulagway sa compass?",
     "Naa! Ania ang compass. Ang dagom niini usa ka gamay nga magnet nga gawasnon nga motuyok, mao nga mopahiluna kini sa magnetic field sa Earth ug kanunay nga magtudlo sa amihanan — mao nga dili ka mawala.",
     "A compass with its magnetic needle pointing north."),
]

with open(OUT, "w") as f:
    for grade, fids, msg, ans, tag in ROWS:
        row = {"grade": grade, "messages": [
            {"role": "user", "content": grounded(fids, msg)},
            {"role": "assistant", "content": f"{ans}\n\n[image: {tag}]"},
        ]}
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
print(f"wrote {len(ROWS)} rows -> {OUT}")
