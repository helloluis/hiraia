#!/usr/bin/env python3
"""Build tagalog-c-imgtag.jsonl (30 rows) — authored in-session.

The workflow agent for this batch was killed by the Usage Policy classifier
(it dumped bank rows into its context), so the batch is hand-built here with
the same mechanics as the v4 builders: grounding facts copied verbatim from
the bank by id.

Family C FAST IMAGE TAG: explicit see-requests; assistant = ONE short warm
sentence (≤~120 chars) then the [image: ...] tag alone on the final line.
~half ON-topic grounding (the failing device path), ~half tangential/hijack.
Includes 3 dinosaur rows (T-rex is a THEROPOD) and 2 whale-shark rows
(the whale shark IS a fish).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "tagalog-c-imgtag.jsonl")

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
    lines = "\n".join(f"- ({bank[i][0]}) {bank[i][1]}" for i in fact_ids)
    return f"{G_HEAD}\n{lines}\n\n{G_TAIL}\n\n{msg}"

# (grade, [fact ids], user request, assistant lead sentence, image caption)
ROWS = [
    ("4", ["living-dinosaurs-g4", "earth-fossils-g6"],
     "Pakita mo naman ang T-rex!",
     "Heto po ang T-rex — isang dambuhalang theropod na kumakain ng karne!",
     "A Tyrannosaurus rex dinosaur with massive jaws, tiny arms, and a long tail."),
    ("4", ["magnet-attracts-iron-g4"],
     "Ano po ang hitsura ng triceratops? Pakita mo naman.",
     "Heto ang triceratops — kilala sa tatlong sungay sa mukha nito!",
     "A triceratops dinosaur with three horns and a large neck frill."),
    ("3", ["what-is-fossil-g3"],
     "Pakita mo naman ng fossil ng dinosaur!",
     "Heto ang fossil ng dinosaur — bakas ng hayop na nabuhay milyon-milyong taon na ang nakalipas!",
     "A dinosaur fossil skeleton embedded in rock."),
    ("5", ["butanding-whale-shark-largest-fish-g5", "butanding-filter-feeder-g5"],
     "Patingin po ng butanding!",
     "Heto po ang butanding — ang pinakamalaking isda sa buong mundo!",
     "A whale shark swimming with its wide flat mouth and spotted back."),
    ("5", ["rainbow-formation-g5"],
     "May picture ka ba ng whale shark?",
     "Meron! Heto ang whale shark o butanding — isda ito kahit napakalaki!",
     "A whale shark (butanding) with white spots swimming in the sea."),
    ("4", ["jellyfish-no-brain-g4"],
     "Gusto kong makita ang dikya!",
     "Heto ang dikya — kakaibang hayop na walang utak!",
     "A jellyfish with a round bell and long trailing tentacles."),
    ("3", ["water-cycle-g4"],
     "Ipakita mo nga ang kabayong-dagat.",
     "Heto ang kabayong-dagat o seahorse — totoong isda ito!",
     "A seahorse with a curled tail floating upright in the water."),
    ("4", ["living-starfish-arms-regrow-g4"],
     "Pwede po bang makita ang starfish?",
     "Heto ang starfish — kaya nitong palaguin muli ang naputol na braso!",
     "A starfish with five arms on the sea floor."),
    ("4", ["sound-travels-through-air-g4"],
     "Picture naman ng kuwago please!",
     "Heto ang kuwago — bihasang mangangaso sa gabi!",
     "An owl (kuwago) with big round eyes perched on a branch."),
    ("5", ["bat-echolocation-g5", "bat-only-flying-mammal-g4"],
     "Show mo naman yung paniki!",
     "Heto ang paniki — ang tanging mammal na talagang nakakalipad!",
     "A bat flying at night with wings spread wide."),
    ("6", ["condensation-cold-glass-g4"],
     "Patingin naman ng buwaya!",
     "Heto po ang buwaya — isa sa pinakamalakas kumagat na hayop!",
     "A crocodile (buwaya) with a long snout and sharp teeth."),
    ("4", ["birds-penguin-swim-g4"],
     "May larawan ka ba ng penguin?",
     "Meron! Heto ang penguin — ibong hindi nakakalipad pero mahusay lumangoy!",
     "A penguin standing upright on ice."),
    ("3", ["gravity-pulls-things-down-g4"],
     "Pakita mo po ang elepante!",
     "Heto po ang elepante — ang pinakamalaking hayop sa lupa!",
     "An elephant grabbing leaves with its long trunk."),
    ("3", ["giraffe-tallest-animal-g3"],
     "Gusto ko pong makita ang giraffe!",
     "Heto ang giraffe — ang pinakamatangkad na hayop sa mundo!",
     "A giraffe with a very long neck eating leaves from a tall tree."),
    ("3", ["static-electricity-shock-g5"],
     "Ipakita mo naman ang suso!",
     "Heto ang suso — dala-dala niya ang bahay niyang shell!",
     "A snail (suso) with a spiral shell."),
    ("3", ["spider-web-silk-g3"],
     "Patingin ng sapot ng gagamba!",
     "Heto ang sapot ng gagamba — hinabi mula sa sutlang gawa ng katawan niya!",
     "A spider web with a spider at the center."),
    ("4", ["hanging-laundry-evaporation-g4"],
     "May pic ka ba ng bubuyog?",
     "Meron! Heto ang bubuyog — masipag na tagapagdala ng pollen!",
     "A bee collecting nectar from a flower."),
    ("6", ["jupiter-great-red-spot-g6", "jupiter-planet-g5"],
     "Pakita mo ang planetang Jupiter!",
     "Heto ang Jupiter — ang pinakamalaking planeta sa solar system!",
     "The planet Jupiter with its colorful bands and Great Red Spot."),
    ("5", ["magnet-poles-attract-repel-g5"],
     "Anong itsura ng kometa? Pakita mo!",
     "Heto ang kometa — may mahabang buntot itong gas at alikabok!",
     "A comet with a bright head and a long glowing tail in space."),
    ("7", ["solar-eclipse-new-moon-g7"],
     "Pwede bang makita ang solar eclipse?",
     "Heto ang solar eclipse — natatakpan ng buwan ang araw!",
     "A solar eclipse with the moon blocking the sun, corona glowing."),
    ("6", ["cloud-types-g6"],
     "Patingin po ng iba't ibang ulap!",
     "Heto ang iba't ibang uri ng ulap sa langit!",
     "A chart of different cloud types: cirrus, cumulus, and stratus."),
    ("5", ["day-night-rotation-g5"],
     "Gusto kong makita ang talon!",
     "Heto po ang talon — rumaragasang tubig mula sa itaas!",
     "A tall waterfall pouring down a rocky cliff."),
    ("6", ["energy-windmill-bangui-g6"],
     "Pakita mo yung mga windmill sa Bangui!",
     "Heto ang mga windmill — ginagawang kuryente ang lakas ng hangin!",
     "Tall wind turbines turning in the wind."),
    ("5", ["thunder-after-lightning-g5"],
     "May picture ka ba ng telescope?",
     "Meron! Heto ang telescope — pinapalapit nito ang tanawin ng kalangitan!",
     "A telescope on a tripod aimed at the stars."),
    ("5", ["microscope-reveals-cells-g5"],
     "Ipakita mo po ang microscope!",
     "Heto ang microscope — pinapakita nito ang sobrang liliit na bagay!",
     "A microscope for looking at very small things."),
    ("5", ["free-fall-same-rate-g6"],
     "Pakita mo naman ang saranggola!",
     "Heto ang saranggola — itinataas ito ng lakas ng hangin!",
     "A diamond-shaped kite (saranggola) flying in the wind."),
    ("6", ["banana-herb-not-tree-g6"],
     "Patingin po ng puno ng saging!",
     "Heto ang saging — ang totoo, malaking halamang-damo ito at hindi tunay na puno!",
     "A banana plant (saging) with large leaves and bunches of bananas."),
    ("5", ["moon-gravity-one-sixth-g6"],
     "Ano hitsura ng palay? Pakita mo naman!",
     "Heto ang palay — uri ito ng damo na pinagkukunan ng bigas natin!",
     "Rice plants (palay) growing in a flooded rice field."),
    ("5", ["fungi-not-plants-g5"],
     "May larawan ka ba ng kabute?",
     "Meron! Heto ang kabute — hindi ito halaman kundi fungus!",
     "A mushroom (kabute) with a cap and stem."),
    ("6", ["volcano-ash-cloud-g6"],
     "Patingin ng bulkan na pumuputok!",
     "Heto ang pumuputok na bulkan — umiilanlang ang abo at usok mula rito!",
     "An erupting volcano with smoke and ash rising from its crater."),
]

assert len(ROWS) == 30
with open(OUT, "w") as out:
    for grade, fids, user, lead, caption in ROWS:
        for i in fids:
            assert i in bank, f"unknown fact id {i}"
        assert len(lead) <= 125, f"lead too long ({len(lead)}): {lead}"
        row = {"grade": grade, "messages": [
            {"role": "user", "content": grounded(fids, user)},
            {"role": "assistant", "content": f"{lead}\n\n[image: {caption}]"},
        ]}
        out.write(json.dumps(row, ensure_ascii=False) + "\n")
print(f"{OUT}: {len(ROWS)} rows")
