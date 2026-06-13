#!/usr/bin/env python3
"""Assemble tagalog-a-pos-1.jsonl (Family A positives, set 1 — 22 rows).

Row specs reference bank fact IDs; the grounding block is composed here with the
fact tl-text copied verbatim from rag/bank/science-facts.jsonl, so the validator's
verbatim check passes by construction. Assistant answers + tag descs are authored
inline below.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "tagalog-a-pos-1.jsonl")

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

# (grade, [fact ids], student msg, assistant answer (no tag), tag desc)
ROWS = [
    # --- animals & prehistoric life (>=2 t-rex/dino) ---
    ("4", ["living-dinosaurs-g4", "earth-fossils-g6"],
     "Pakita mo naman ang T-rex! Gusto ko makita kung gaano siya kalaki.",
     "Sige! Ang Tyrannosaurus rex ay isa sa pinakamalalaking karnivoro na dinosaur — halos kasintaas ng dalawang palapag na bahay at may ngiping kasinghaba ng saging. Kahit napakalaki ng ulo at panga nito, maliliit lang ang dalawang braso nito. Heto ang hitsura niya:",
     "A Tyrannosaurus rex dinosaur standing upright with huge open jaws, tiny arms, and a long balancing tail."),
    ("5", ["earth-water-cycle-g4"],
     "May picture ka ba ng dinosaur na T-rex? Yung mabangis talaga.",
     "Meron! Ang T-rex ay namuhay mga 66 milyong taon na ang nakalipas at kilala sa napakalakas nitong kagat — mas malakas pa kaysa sa buwaya ngayon. Tingnan mo kung gaano siya kabangis:",
     "A fierce Tyrannosaurus rex dinosaur showing its sharp teeth and powerful jaws."),
    ("4", ["living-dinosaur-extinction-g5", "living-dinosaurs-g4"],
     "Ano ang hitsura ng triceratops?",
     "Ang triceratops ay isang dinosaur na kumakain ng halaman. Madali siyang makilala dahil may tatlo siyang sungay sa mukha at malapad na parang kalasag (frill) sa likod ng ulo niya. Ito ang hitsura niya:",
     "A triceratops dinosaur with three horns on its face and a wide bony neck frill."),
    ("5", ["living-shark-g5", "shark-smell-blood-g5"],
     "Gusto ko makita ang hammerhead shark!",
     "Astig na pating ang hammerhead! Ang hugis-martilyong ulo nito ay hindi lang dekorasyon — dahil magkalayo ang mga mata nito, mas malawak ang nakikita nito sa paligid habang naghahanap ng pagkain. Heto siya:",
     "A hammerhead shark with a wide flat hammer-shaped head, an eye at each end, and a tall dorsal fin."),
    ("3", ["butterfly-metamorphosis-g3"],
     "May picture ka ba ng paru-paro?",
     "Oo naman! Ang paruparo ay may makukulay na pakpak na may maliliit na kaliskis — at bago ito naging paruparo, higad muna ito na nagbago ng anyo. Tingnan mo:",
     "A butterfly resting on a flower with its wings spread open."),
    ("4", ["living-frog-g4", "living-life-cycle-g4"],
     "Pakita mo naman ang palaka. Paano ba siya kumain?",
     "Heto ang palaka! Mabilis na mangangaso ito — may mahaba at malagkit itong dila na biglang inilalabas para hulihin ang mga lamok at langaw. Sa isang kisap-mata lang, huli na ang insekto!",
     "A frog catching a fly with its long sticky tongue."),
    ("6", ["matter-mass-volume-weight-g5"],
     "Ano po ang hitsura ng blue whale? Pakita naman po.",
     "Heto po siya! Ang blue whale ang pinakamalaking hayop na nabuhay kailanman sa Earth — mas malaki pa ito kaysa sa kahit anong dinosaur, at umaabot ito ng mga 30 metro ang haba. Mammal po ito, hindi isda, kaya umaahon ito para huminga.",
     "An enormous blue whale with a long streamlined body and broad tail flukes, swimming."),
    ("5", ["eagle-predator-g4", "eagle-eyesight-g5"],
     "Gusto ko pong makita ang agila!",
     "Heto po ang agila! Isa itong ibong mandaragit na may napakatalas na mata — kaya nitong mabanaag ang maliit na hayop kahit napakataas nito sa himpapawid. Ang Philippine eagle pa nga ay isa sa pinakamalalaking agila sa buong mundo.",
     "A Philippine eagle (agila) in side view, with a strong hooked beak and sharp talons."),
    ("5", ["val-heart-rate"],
     "Picture ng pugita please!",
     "Heto ang pugita! Kakaibang hayop ito — may walo itong braso na puno ng suction cups, tatlong puso, at wala itong buto kaya nakakalusot ito sa masisikip na butas.",
     "An octopus with eight curling arms covered in suction cups."),
    ("4", ["sea-turtle-return-beach-g5", "sea-turtle-hatchlings-sea-g4"],
     "Gusto kong makita ang pawikan!",
     "Heto ang pawikan! Halos buong buhay nito ay nasa dagat, at ang mga palikpik nitong parang sagwan ang ginagamit nitong panlangoy. Espesyal na hayop ito sa Pilipinas kaya inaalagaan natin ang mga tabing-dagat na pinangingitlugan nito.",
     "A green sea turtle swimming in the sea with its flipper paddles."),
    # --- human body parts ---
    ("6", ["living-circulatory-g6"],
     "Ano ang hitsura ng puso natin sa loob? Pwede mo bang ipakita?",
     "Heto ang loob ng puso! May apat itong silid o chambers — dalawa sa itaas at dalawa sa ibaba — at sunud-sunod silang pumipiga para itulak ang dugo papunta sa buong katawan. Kasinlaki lang ito ng iyong kamao pero hindi ito tumitigil sa trabaho buong buhay mo.",
     "A cross-section of the heart showing its four chambers, with arrows tracing the blood flow."),
    ("5", ["living-respiratory-g6"],
     "Pakita mo naman kung ano ang itsura ng baga natin.",
     "Heto ang baga! Dalawa ito sa loob ng dibdib mo at parang espongha ang lambot. Tuwing humihinga ka, pumapasok dito ang hangin para makuha ng katawan ang oxygen. Makikita mo rin sa larawan kung bakit dapat itong ingatan laban sa usok.",
     "Healthy human lungs compared side by side with lungs darkened by smoke."),
    ("7", ["faq-why-we-sleep"],
     "Ano po ang hitsura ng utak? May larawan po ba kayo?",
     "Meron po! Ang utak ang control center ng buong katawan — may mga bahagi itong namamahala sa pag-iisip, paggalaw, paningin, at memorya. Kulubot ang ibabaw nito para mas marami ang magkasyang brain cells sa loob ng bungo.",
     "A side view of the brain divided into regions that control thinking, movement, and balance."),
    ("6", ["why-two-eyes-g4"],
     "Pakita mo nga po kung ano ang nasa loob ng mata natin.",
     "Heto po ang loob ng mata! Ang ilaw ay pumapasok sa pupil, ibinubuo ng lens, at tumatama sa retina sa likod — doon ito ginagawang signal na ipinapadala sa utak para makakita tayo. Parang maliit na kamera ang bawat mata mo!",
     "Parts of the human eye: a cross-section of the round eyeball showing the dark pupil opening and the back lining."),
    ("6", ["living-digestive-g6", "living-digestion-enzymes-g6"],
     "Pakita mo naman kung ano ang nangyayari sa pagkain pagdating sa sikmura.",
     "Tingnan mo ito! Sa sikmura, hinahalo at minamasa ang pagkain kasama ng digestive juices hanggang maging parang malapot na sabaw ito. Ganyan sinisimulang tunawin ng katawan ang kinain mo para makuha ang sustansya.",
     "A cutaway stomach churning food with digestive juices into a soupy mixture."),
    ("3", ["crocodile-bite-g5"],
     "May picture ka ba ng mga ngipin natin?",
     "Meron! Iba-iba ang hugis ng mga ngipin natin dahil iba-iba ang trabaho nila — may pangkagat sa harap, may pampunit na matulis, at may pampadurog na pipi sa likod. Tingnan mo sila:",
     "A row of teeth showing incisors, canines, premolars, and molars and their different shapes."),
    # --- plants & trees ---
    ("4", ["coconut-tree-of-life-g4"],
     "Pakita mo naman ang puno ng niyog!",
     "Heto ang puno ng niyog! Matangkad ito, walang sanga, at nasa tuktok lahat ng dahon at bunga nito. Hindi nga kataka-takang tawagin itong 'tree of life' — ang daming gamit ng bawat parte nito!",
     "A tall coconut palm tree with a curved slender trunk, feathery fronds, and clustered coconuts."),
    ("4", ["pollination-g4"],
     "Gusto ko makita ang sunflower!",
     "Heto ang sunflower o mirasol! Ang malaking 'mukha' nito ay hindi iisang bulaklak kundi daan-daang maliliit na bulaklak na magkakadikit, kaya paborito ito ng mga bubuyog. Habang bata pa ang sunflower, sumusunod pa ang mukha nito sa araw!",
     "A sunflower (mirasol) with a ring of long pointed petals around a wide round seed-filled center on a tall stem."),
    ("5", ["electromagnet-coil-wire-g7"],
     "Ano ang hitsura ng pako na halaman? Yung tanim po, hindi yung bakal.",
     "Ah, ang halamang pako! Heto siya — mahahaba at parang balahibo ang dahon nito na tinatawag na fronds. Kakaiba ito sa ibang halaman dahil wala itong bulaklak at buto; sa pamamagitan ng maliliit na spores ito kumakalat.",
     "A fern frond (pako) with many small paired leaflets along an arching central stem."),
    ("5", ["living-plant-adaptations-g5", "what-is-a-desert-g4"],
     "Pakita mo naman ang cactus!",
     "Heto ang cactus! Makapal at parang tangke ng tubig ang tangkay nito, at ang mga tinik nito ay mga dahon talaga na nag-iba ng anyo para hindi masayang ang tubig. Kaya kahit sa pinakatuyong disyerto, buhay na buhay pa rin ito.",
     "A cactus with a thick stem and sharp spines instead of leaves, adapted to dry conditions."),
    ("6", ["living-fungi-g6"],
     "Picture ng kabute please!",
     "Heto ang kabute! Kahit mukha itong halaman, hindi ito halaman — fungus ito na hindi gumagawa ng sariling pagkain, kaya madalas mo itong makikitang tumutubo sa bulok na kahoy na kinukuhanan nito ng sustansya.",
     "A mushroom growing on a fallen log."),
    ("5", ["mangroves-g5"],
     "Ano ang hitsura ng bakawan?",
     "Heto ang bakawan! Madali itong makilala dahil sa mga ugat nitong nakaarko at nakausli sa tubig na parang mga paa. Ang mga ugat na iyan ang sumasalo sa malalakas na alon kaya protektado ang ating baybayin.",
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
