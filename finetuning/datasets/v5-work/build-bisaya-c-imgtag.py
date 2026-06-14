#!/usr/bin/env python3
"""Build bisaya-c-imgtag.jsonl (30 rows) — authored in-session.

Mirrors build-tagalog-c-imgtag.py (same fact ids, same already-validated
English captions) with Cebuano see-requests and lead sentences; grounding
fact lines use fact.bis verbatim.

Family C FAST IMAGE TAG: assistant = ONE short warm sentence (<=~120 chars)
then the [image: ...] tag alone on the final line. ~half ON-topic grounding,
~half tangential/hijack. Includes 3 dinosaur rows (T-rex is a THEROPOD) and
2 whale-shark rows (the whale shark IS a fish).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "bisaya-c-imgtag.jsonl")

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

# (grade, [fact ids], user request, assistant lead sentence, image caption)
ROWS = [
    ("4", ["living-dinosaurs-g4", "earth-fossils-g6"],
     "Ipakita ra gud ang T-rex!",
     "Ania ang T-rex — usa ka dakong theropod nga mokaon og karne!",
     "A Tyrannosaurus rex dinosaur with massive jaws, tiny arms, and a long tail."),
    ("4", ["magnet-attracts-iron-g4"],
     "Unsay hitsura sa triceratops? Patan-awa ko.",
     "Ania ang triceratops — inila sa tulo ka sungay sa nawong niini!",
     "A triceratops dinosaur with three horns and a large neck frill."),
    ("3", ["what-is-fossil-g3"],
     "Pakita kog fossil sa dinosaur!",
     "Ania ang fossil sa dinosaur — timaan sa mananap nga nabuhi milyon-milyon ka tuig na ang milabay!",
     "A dinosaur fossil skeleton embedded in rock."),
    ("5", ["butanding-whale-shark-largest-fish-g5", "butanding-filter-feeder-g5"],
     "Patan-awa ko sa butanding!",
     "Ania ang butanding — ang pinakadako nga isda sa tibuok kalibutan!",
     "A whale shark swimming with its wide flat mouth and spotted back."),
    ("5", ["rainbow-formation-g5"],
     "Naa kay picture sa whale shark?",
     "Naa! Ania ang whale shark o butanding — isda gihapon kini bisan dako kaayo!",
     "A whale shark (butanding) with white spots swimming in the sea."),
    ("4", ["jellyfish-no-brain-g4"],
     "Gusto nakong makita ang salabay!",
     "Ania ang salabay o jellyfish — talagsaong mananap nga walay utok!",
     "A jellyfish with a round bell and long trailing tentacles."),
    ("3", ["water-cycle-g4"],
     "Ipakita ra gud ang seahorse.",
     "Ania ang seahorse o kabayo sa dagat — tinuod kini nga isda!",
     "A seahorse with a curled tail floating upright in the water."),
    ("4", ["living-starfish-arms-regrow-g4"],
     "Pwede ba nakong makita ang starfish?",
     "Ania ang starfish — makapatubo kini pag-usab sa naputol nga bukton niini!",
     "A starfish with five arms on the sea floor."),
    ("4", ["sound-travels-through-air-g4"],
     "Picture sa ngiwngiw palihog!",
     "Ania ang ngiwngiw o kuwago — hanas nga mangangayam sa kagabhion!",
     "An owl (kuwago) with big round eyes perched on a branch."),
    ("5", ["bat-echolocation-g5", "bat-only-flying-mammal-g4"],
     "Pakita sa kabog bi!",
     "Ania ang kabog — ang bugtong mammal nga tinuod nga makalupad!",
     "A bat flying at night with wings spread wide."),
    ("6", ["condensation-cold-glass-g4"],
     "Patan-awa kog buaya!",
     "Ania ang buaya — usa sa pinakakusog mopaak nga mananap!",
     "A crocodile (buwaya) with a long snout and sharp teeth."),
    ("4", ["birds-penguin-swim-g4"],
     "Naa kay hulagway sa penguin?",
     "Naa! Ania ang penguin — langgam nga dili makalupad apan hanas molangoy!",
     "A penguin standing upright on ice."),
    ("3", ["gravity-pulls-things-down-g4"],
     "Ipakita palihog ang elepante!",
     "Ania ang elepante — ang pinakadako nga mananap sa yuta!",
     "An elephant grabbing leaves with its long trunk."),
    ("3", ["giraffe-tallest-animal-g3"],
     "Gusto nakong makita ang giraffe!",
     "Ania ang giraffe — ang pinakataas nga mananap sa kalibutan!",
     "A giraffe with a very long neck eating leaves from a tall tree."),
    ("3", ["static-electricity-shock-g5"],
     "Ipakita ra gud ang suso!",
     "Ania ang suso — dala-dala niini ang iyang balay nga shell!",
     "A snail (suso) with a spiral shell."),
    ("3", ["spider-web-silk-g3"],
     "Patan-awa sa balay sa lawa!",
     "Ania ang balay sa lawa — hinabi gikan sa sutla nga gama sa lawas niini!",
     "A spider web with a spider at the center."),
    ("4", ["hanging-laundry-evaporation-g4"],
     "Naa kay pic sa buyog?",
     "Naa! Ania ang buyog — kugihan nga tigdala sa pollen!",
     "A bee collecting nectar from a flower."),
    ("6", ["jupiter-great-red-spot-g6", "jupiter-planet-g5"],
     "Ipakita ang planetang Jupiter!",
     "Ania ang Jupiter — ang pinakadako nga planeta sa solar system!",
     "The planet Jupiter with its colorful bands and Great Red Spot."),
    ("5", ["magnet-poles-attract-repel-g5"],
     "Unsay hitsura sa kometa? Ipakita!",
     "Ania ang kometa — adunay taas kining ikog nga gas ug abog!",
     "A comet with a bright head and a long glowing tail in space."),
    ("7", ["solar-eclipse-new-moon-g7"],
     "Pwede ba makita ang solar eclipse?",
     "Ania ang solar eclipse — gitabonan sa bulan ang adlaw!",
     "A solar eclipse with the moon blocking the sun, corona glowing."),
    ("6", ["cloud-types-g6"],
     "Patan-awa ko sa lainlaing panganod!",
     "Ania ang lainlaing matang sa panganod sa langit!",
     "A chart of different cloud types: cirrus, cumulus, and stratus."),
    ("5", ["day-night-rotation-g5"],
     "Gusto kong makita ang busay!",
     "Ania ang busay — naghaguros nga tubig gikan sa itaas!",
     "A tall waterfall pouring down a rocky cliff."),
    ("6", ["energy-windmill-bangui-g6"],
     "Ipakita ang mga windmill sa Bangui!",
     "Ania ang mga windmill — gihimong kuryente ang kusog sa hangin!",
     "Tall wind turbines turning in the wind."),
    ("5", ["thunder-after-lightning-g5"],
     "Naa kay picture sa telescope?",
     "Naa! Ania ang telescope — gipaduol niini ang talan-awon sa kalangitan!",
     "A telescope on a tripod aimed at the stars."),
    ("5", ["microscope-reveals-cells-g5"],
     "Ipakita palihog ang microscope!",
     "Ania ang microscope — gipakita niini ang gagmay kaayo nga mga butang!",
     "A microscope for looking at very small things."),
    ("5", ["free-fall-same-rate-g6"],
     "Pakita sa tabanog bi!",
     "Ania ang tabanog — gipataas kini sa kusog sa hangin!",
     "A diamond-shaped kite (saranggola) flying in the wind."),
    ("6", ["banana-herb-not-tree-g6"],
     "Patan-awa kog punoan sa saging!",
     "Ania ang saging — sa tinuod, dako kining tanom nga sagbot ug dili tinuod nga kahoy!",
     "A banana plant (saging) with large leaves and bunches of bananas."),
    ("5", ["moon-gravity-one-sixth-g6"],
     "Unsay hitsura sa humay? Ipakita ra gud!",
     "Ania ang humay — matang kini sa sagbot nga gigikanan sa atong bugas!",
     "Rice plants (palay) growing in a flooded rice field."),
    ("5", ["fungi-not-plants-g5"],
     "Naa kay hulagway sa uhong?",
     "Naa! Ania ang uhong — dili kini tanom kondili fungus!",
     "A mushroom (kabute) with a cap and stem."),
    ("6", ["volcano-ash-cloud-g6"],
     "Patan-awa sa nagbuto nga bulkan!",
     "Ania ang nagbuto nga bulkan — moulbo ang abo ug aso gikan niini!",
     "An erupting volcano with smoke and ash rising from its crater."),
]

assert len(ROWS) == 30
with open(OUT, "w") as out:
    for grade, fids, user, lead, caption in ROWS:
        for i in fids:
            assert i in bank and bank[i][1], f"bad fact id {i}"
        assert len(lead) <= 125, f"lead too long ({len(lead)}): {lead}"
        row = {"grade": grade, "messages": [
            {"role": "user", "content": grounded(fids, user)},
            {"role": "assistant", "content": f"{lead}\n\n[image: {caption}]"},
        ]}
        out.write(json.dumps(row, ensure_ascii=False) + "\n")
print(f"{OUT}: {len(ROWS)} rows")
