#!/usr/bin/env python3
"""Assemble bisaya-a-pos-1.jsonl (Family A positives, set 1 — 22 rows, Cebuano).

Mirror of build-tagalog-a-pos-1.py: same fact ids (grounding uses fact.bis verbatim),
same English tag descs (already floor-validated), Cebuano student/tutor text.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "bisaya-a-pos-1.jsonl")

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
    # --- animals & prehistoric life (>=2 t-rex/dino) ---
    ("4", ["living-dinosaurs-g4", "earth-fossils-g6"],
     "Ipakita ra gud ang T-rex! Gusto nako makita kung unsa siya kadako.",
     "Sige! Ang Tyrannosaurus rex usa sa pinakadagko nga karnivoro nga dinosaur — halos sama kataas sa duha ka andana nga balay ug ang iyang mga ngipon sama kataas sa saging. Bisan dako kaayo ang ulo ug apapangig niini, gagmay ra kaayo ang duha niini ka bukton. Ania ang iyang hitsura:",
     "A Tyrannosaurus rex dinosaur standing upright with huge open jaws, tiny arms, and a long balancing tail."),
    ("5", ["earth-water-cycle-g4"],
     "Naa ka'y picture sa dinosaur nga T-rex? Kanang bangis gyud.",
     "Naa! Ang T-rex nabuhi mga 66 ka milyon ka tuig na ang milabay ug nailhan sa kusog kaayo niini nga paak — mas kusog pa kaysa sa buwaya karon. Tan-awa kung unsa siya kabangis:",
     "A fierce Tyrannosaurus rex dinosaur showing its sharp teeth and powerful jaws."),
    ("4", ["living-dinosaur-extinction-g5", "living-dinosaurs-g4"],
     "Unsa man ang hitsura sa triceratops?",
     "Ang triceratops usa ka dinosaur nga mokaon og tanom. Sayon ra siya mailhan tungod kay naa siyay tulo ka sungay sa nawong ug lapad nga morag taming (frill) sa likod sa iyang ulo. Mao ni ang iyang hitsura:",
     "A triceratops dinosaur with three horns on its face and a wide bony neck frill."),
    ("5", ["living-shark-g5", "shark-smell-blood-g5"],
     "Gusto nako makita ang hammerhead shark!",
     "Nindot gyud nga iho ang hammerhead! Ang ulo niini nga porma og martilyo dili lang dekorasyon — tungod kay layo ang gilay-on sa iyang mga mata, mas lapad ang makita niini sa palibot samtang mangita og pagkaon. Ania siya:",
     "A hammerhead shark with a wide flat hammer-shaped head, an eye at each end, and a tall dorsal fin."),
    ("3", ["butterfly-metamorphosis-g3"],
     "Naa ka'y picture sa alibangbang?",
     "Oo gyud! Ang alibangbang adunay mga pakpak nga puno sa kolor ug gagmay nga himbis — ug sa wala pa kini nahimong alibangbang, ulod una kini nga nag-usab sa iyang porma. Tan-awa:",
     "A butterfly resting on a flower with its wings spread open."),
    ("4", ["living-frog-g4", "living-life-cycle-g4"],
     "Ipakita ra gud ang baki. Giunsa man diay siya mokaon?",
     "Ania ang baki! Abtik kaayo kini nga mangangayam — aduna kini taas ug pilit nga dila nga kalit niini nga ipagawas aron dakpon ang mga lamok ug langaw. Sa usa lang ka pamilok, nadakpan na ang insekto!",
     "A frog catching a fly with its long sticky tongue."),
    ("6", ["matter-mass-volume-weight-g5"],
     "Unsa may hitsura sa blue whale? Palihug ko'g pakita.",
     "Ania siya! Ang blue whale mao ang pinakadako nga mananap nga nabuhi sukad dinhi sa Earth — mas dako pa kini kaysa bisan unsang dinosaur, ug moabot kini og mga 30 ka metros ang gitas-on. Mammal kini, dili isda, mao nga mohaw-as kini sa tubig aron moginhawa.",
     "An enormous blue whale with a long streamlined body and broad tail flukes, swimming."),
    ("5", ["eagle-predator-g4", "eagle-eyesight-g5"],
     "Gusto nako makita ang agila!",
     "Ania ang agila! Usa kini ka langgam nga mangangayam nga adunay hait kaayo nga mata — makita niini ang gamay nga mananap bisan taas pa kaayo kini sa kahanginan. Ang Philippine eagle pa gyud usa sa pinakadagko nga agila sa tibuok kalibutan.",
     "A Philippine eagle (agila) in side view, with a strong hooked beak and sharp talons."),
    ("5", ["val-heart-rate"],
     "Picture sa kugita palihug!",
     "Ania ang kugita! Lahi ra gyud kini nga mananap — aduna kini walo ka bukton nga puno sa suction cups, tulo ka kasingkasing, ug wala kini bukog mao nga makalusot kini sa gagmay kaayo nga lungag.",
     "An octopus with eight curling arms covered in suction cups."),
    ("4", ["sea-turtle-return-beach-g5", "sea-turtle-hatchlings-sea-g4"],
     "Gusto nako makita ang pawikan!",
     "Ania ang pawikan! Halos tibuok kinabuhi niini anaa sa dagat, ug ang mga kapay niini nga morag bugsay mao ang gamit niini sa paglangoy. Espesyal kini nga mananap sa Pilipinas mao nga atong giampingan ang mga baybayon nga gipangitlogan niini.",
     "A green sea turtle swimming in the sea with its flipper paddles."),
    # --- human body parts ---
    ("6", ["living-circulatory-g6"],
     "Unsa man ang hitsura sa atong kasingkasing sa sulod? Mahimo ba nimo ipakita?",
     "Ania ang sulod sa kasingkasing! Aduna kini upat ka lawak o chambers — duha sa ibabaw ug duha sa ubos — ug magsunod-sunod sila og puga aron iduso ang dugo ngadto sa tibuok lawas. Sama ra kini kadako sa imong kinumo apan dili kini mohunong sa trabaho sa tibuok nimong kinabuhi.",
     "A cross-section of the heart showing its four chambers, with arrows tracing the blood flow."),
    ("5", ["living-respiratory-g6"],
     "Ipakita ra gud kung unsa ang hitsura sa atong baga.",
     "Ania ang baga! Duha kini sa sulod sa imong dughan ug morag espongha ang kahumok. Matag ginhawa nimo, mosulod dinhi ang hangin aron makuha sa lawas ang oxygen. Makita usab nimo sa hulagway kung nganong kinahanglan kining ampingan batok sa aso.",
     "Healthy human lungs compared side by side with lungs darkened by smoke."),
    ("7", ["faq-why-we-sleep"],
     "Unsa man ang hitsura sa utok? Naa ba moy hulagway?",
     "Naa! Ang utok mao ang control center sa tibuok lawas — adunay mga bahin kini nga nagdumala sa panghunahuna, paglihok, panan-aw, ug memorya. Kunot ang ibabaw niini aron mas daghan nga brain cells ang mahiluna sulod sa bagolbagol.",
     "A side view of the brain divided into regions that control thinking, movement, and balance."),
    ("6", ["why-two-eyes-g4"],
     "Ipakita ra gud kung unsa ang naa sa sulod sa atong mata.",
     "Ania ang sulod sa mata! Ang kahayag mosulod sa pupil, i-focus sa lens, ug motama sa retina sa likod — didto kini himoon nga signal nga ipadala ngadto sa utok aron makakita kita. Morag gamay nga kamera ang matag mata nimo!",
     "Parts of the human eye: a cross-section of the round eyeball showing the dark pupil opening and the back lining."),
    ("6", ["living-digestive-g6", "living-digestion-enzymes-g6"],
     "Ipakita ra gud kung unsa ang mahitabo sa pagkaon inig-abot niini sa tiyan.",
     "Tan-awa kini! Sa tiyan, sagolon ug masahon ang pagkaon kauban sa digestive juices hangtod mahimo kining morag lapok nga sabaw. Ingon-ana gisugdan sa lawas og tunaw ang imong gikaon aron makuha ang sustansya.",
     "A cutaway stomach churning food with digestive juices into a soupy mixture."),
    ("3", ["crocodile-bite-g5"],
     "Naa ka'y picture sa atong mga ngipon?",
     "Naa! Lain-lain ang porma sa atong mga ngipon tungod kay lain-lain usab ang ilang trabaho — naay pangpaak sa atubangan, naay panggisi nga hait, ug naay pangdugmok nga lapad sa likod. Tan-awa sila:",
     "A row of teeth showing incisors, canines, premolars, and molars and their different shapes."),
    # --- plants & trees ---
    ("4", ["coconut-tree-of-life-g4"],
     "Ipakita ra gud ang punoan sa lubi!",
     "Ania ang punoan sa lubi! Taas kini, walay sanga, ug anaa tanan sa tumoy ang mga dahon ug bunga niini. Dili ikatingala nga gitawag kini og 'tree of life' — daghan kaayo og gamit ang matag bahin niini!",
     "A tall coconut palm tree with a curved slender trunk, feathery fronds, and clustered coconuts."),
    ("4", ["pollination-g4"],
     "Gusto nako makita ang sunflower!",
     "Ania ang sunflower o mirasol! Ang dako nga 'nawong' niini dili usa lang ka bulak kondili gatusan ka gagmay nga bulak nga nagdikit-dikit, mao nga paborito kini sa mga buyog. Samtang bata pa ang sunflower, mosunod pa gani ang nawong niini sa adlaw!",
     "A sunflower (mirasol) with a ring of long pointed petals around a wide round seed-filled center on a tall stem."),
    ("5", ["electromagnet-coil-wire-g7"],
     "Unsa man ang hitsura sa pako nga tanom? Kanang itanom ha, dili kanang puthaw.",
     "Ah, ang tanom nga pako! Ania siya — tag-as ug morag balhibo ang mga dahon niini nga gitawag og fronds. Lahi kini sa ubang tanom kay wala kini bulak ug liso; pinaagi sa gagmay nga spores kini mokaylap.",
     "A fern frond (pako) with many small paired leaflets along an arching central stem."),
    ("5", ["living-plant-adaptations-g5", "what-is-a-desert-g4"],
     "Ipakita ra gud ang cactus!",
     "Ania ang cactus! Baga ug morag tangke sa tubig ang punoan niini, ug ang mga tunok niini mga dahon gyud diay nga nag-usab og porma aron dili mausik ang tubig. Mao nga bisan sa pinakauga nga disyerto, buhi gihapon kini.",
     "A cactus with a thick stem and sharp spines instead of leaves, adapted to dry conditions."),
    ("6", ["living-fungi-g6"],
     "Picture sa uhong palihug!",
     "Ania ang uhong! Bisan morag tanom kini tan-awon, dili kini tanom — fungus kini nga dili maghimo og kaugalingong pagkaon, mao nga kasagaran nimo kining makita nga motubo sa gabok nga kahoy nga gikuhaan niini og sustansya.",
     "A mushroom growing on a fallen log."),
    ("5", ["mangroves-g5"],
     "Unsa man ang hitsura sa bakhaw?",
     "Ania ang bakhaw! Sayon kini mailhan tungod sa mga gamot niini nga nag-arko ug nakausli sa tubig nga morag mga tiil. Ang maong mga gamot mao ang mosalo sa kusog nga mga balod mao nga protektado ang atong baybayon.",
     "Mangrove trees with arching prop roots standing in coastal water."),
]

with open(OUT, "w") as f:
    for grade, fids, msg, ans, tag in ROWS:
        row = {"grade": grade, "messages": [
            {"role": "user", "content": grounded(fids, msg)},
            {"role": "assistant", "content": f"{ans}\n\n[image: {tag}]"},
        ]}
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
print(f"wrote {len(ROWS)} rows -> {OUT}")
