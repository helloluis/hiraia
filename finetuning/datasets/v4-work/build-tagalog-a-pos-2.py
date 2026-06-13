#!/usr/bin/env python3
"""Assemble tagalog-a-pos-2.jsonl (Family A positives, set 2 — 23 rows).

Same construction as build-tagalog-a-pos-1.py: grounding fact texts are copied
verbatim from the bank by id. Subjects: space, volcanoes & weather, simple
machines & electricity, PH-specific, everyday science objects.
Off-topic (retrieval-hijack) grounding rows: 2, 5, 8, 12, 15, 19, 22.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
BANK = os.path.join(ROOT, "rag", "bank", "science-facts.jsonl")
OUT = os.path.join(HERE, "tagalog-a-pos-2.jsonl")

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
    # --- space ---
    ("6", ["val-planets-order"],
     "Pakita mo naman ang planetang Saturn!",
     "Heto ang Saturn! Tanyag ito sa maliliwanag nitong mga singsing na gawa sa di-mabilang na piraso ng yelo at bato na umiikot dito. Ito ang pang-anim na planeta mula sa Araw.",
     "The planet Saturn with its bright rings around it."),
    ("5", ["living-food-chain-g5"],
     "Ano po ang hitsura ng ibabaw ng buwan? Gusto ko po makita.",
     "Heto po ang ibabaw ng buwan! Punong-puno ito ng mga malalaking butas na tinatawag na craters, na iniwan ng mga batong mula sa kalawakan na bumagsak doon. Dahil halos walang hangin at ulan sa buwan, hindi nabubura ang mga craters kahit bilyong taon na ang lumipas.",
     "A close view of a large round impact crater on the moon, with smaller craters around it."),
    ("6", ["faq-why-astronauts-float"],
     "Gusto ko makita ang astronaut na lumulutang sa kalawakan!",
     "Heto ang astronaut! Tandaan mo: may gravity pa rin sa kalawakan. Lumulutang sila dahil sila at ang kanilang spacecraft ay parehong tuloy-tuloy na 'nahuhulog' paikot sa Earth — free fall ang tawag dito — kaya pakiramdam nila ay wala silang bigat.",
     "An astronaut floating weightlessly in space outside the spacecraft."),
    ("6", ["action-reaction-rockets-g6"],
     "Pakita mo naman ang rocket habang lumilipad!",
     "Heto ang rocket sa pag-angat nito! Itinutulak nito pababa ang nagliliyab na gas nang napakalakas, at ang katumbas na tulak pabalik ang nagbubuhat dito paitaas — iyan ang action at reaction.",
     "A rocket launching upward with flames and smoke below it."),
    ("4", ["how-bees-make-honey-g4"],
     "May picture ka ba ng buong solar system?",
     "Meron! Heto ang ating solar system — nasa gitna ang Araw, at umiikot dito ang walong planeta. Ang Earth natin ang pangatlo mula sa Araw.",
     "The solar system showing the sun in the center and the eight planets in order."),
    ("4", ["earth-solar-system-g4"],
     "Ano ang hitsura ng planetang Mars?",
     "Heto ang Mars! Tinatawag itong 'red planet' dahil mapulang-kayumanggi ang lupa nito — may halong kalawang o rust kasi ito. Ito rin ang planetang pinaka-ineexplore ng mga robot na rover ngayon.",
     "The planet Mars as a round globe with a polar ice cap and dark surface patches."),
    # --- volcanoes & weather ---
    ("6", ["earth-ph-volcanoes-g6"],
     "Pakita mo naman ang Bulkang Mayon!",
     "Heto ang Bulkang Mayon sa Albay! Sikat ito sa buong mundo dahil sa halos perpekto nitong hugis-kono — bihira ang bulkang ganyan kabilog at kasimetriko ang gilid. Aktibo pa rin itong bulkan hanggang ngayon.",
     "Mayon volcano with its near-perfect cone shape."),
    ("5", ["mango-one-big-seed-g4"],
     "May larawan ka ba ng Taal volcano?",
     "Meron! Ang Taal ay isa sa pinakamaliliit na aktibong bulkan sa mundo, pero kakaiba talaga ito: isa itong bulkan na nasa gitna ng lawa. Tingnan mo:",
     "Taal volcano, a small volcano island sitting inside a lake."),
    ("6", ["faq-thunder-after-lightning"],
     "Pakita mo naman ang kidlat!",
     "Heto ang kidlat! Isa itong napakalaking pagputok ng static electricity mula sa mga ulap — mas mainit pa ito sandali kaysa sa ibabaw ng Araw. Kaya nga sinusundan ito ng dagundong ng kulog.",
     "A bright lightning bolt striking down from dark storm clouds."),
    ("5", ["rainbow-colors-g4"],
     "Gusto ko makita ang bahaghari!",
     "Heto ang bahaghari! Nabubuo ito kapag ang liwanag ng araw ay bumaluktot sa loob ng mga patak ng ulan at humiwa-hiwalay sa mga kulay nito. Kaya madalas mo itong makita pagkatapos ng ulan habang may araw.",
     "A rainbow arching over a green field."),
    ("5", ["why-ph-many-typhoons-g6"],
     "Ano ang hitsura ng bagyo kapag tiningnan mula sa itaas?",
     "Heto ang bagyo mula sa kalawakan! Mukha itong umiikot na puting spiral ng mga ulap, at sa pinakagitna ay may maliit na butas na tinatawag na mata (eye) — kakatwa, doon mismo kalmado at halos walang hangin.",
     "A typhoon seen from space as a giant spiral of clouds with an eye at the center."),
    # --- simple machines & electricity ---
    ("5", ["val-human-teeth"],
     "Pakita mo kung paano gumagana ang seesaw.",
     "Heto ang seesaw! Isa itong lever: ang upuan ay isang mahabang bara na umaangat-bumababa sa isang tuntungan sa gitna na tinatawag na fulcrum. Kapag mas mabigat ang isang bata, kailangang umupo siya nang mas malapit sa gitna para magbalanse sila.",
     "Two kids balancing on a seesaw in a playground."),
    ("4", ["faq-why-magnet-sticks"],
     "May picture ka ba ng magnet na may dumidikit na bagay?",
     "Meron! Heto ang magnet na bumubuhat ng pako. Hinihila ng magnet ang mga bagay na may bakal o iron — kaya kapit na kapit ang pako kahit hindi sila magkadikit noong una.",
     "A magnet picking up an iron nail."),
    ("5", ["circuit-complete-loop-g5"],
     "Pakita mo naman kung ano ang itsura ng simpleng circuit.",
     "Heto ang simpleng circuit! May baterya, mga kawad o wire, at isang bombilya. Kapag sarado at buo ang ikot ng daanan, dadaloy ang kuryente at iilaw ang bombilya — putulin mo ang daanan at mamamatay agad ito.",
     "Building a simple circuit: a battery, two wires, and a small bulb connected so the bulb lights up."),
    ("5", ["val-temperature-scales"],
     "Ano ang hitsura ng pulley? Pakita mo po.",
     "Heto po ang pulley! Isa itong gulong na dinadaanan ng lubid. Kapag hinila mo pababa ang lubid, umaangat ang kabilang dulo — pinapadali nito ang pagbuhat, tulad ng pag-igib ng tubig mula sa balon.",
     "A pulley with a rope raising a bucket of water from a well."),
    # --- Philippine-specific ---
    ("3", ["carabao-national-animal-g3"],
     "Gusto ko makita ang kalabaw!",
     "Heto ang kalabaw! Matibay na katulong ito ng mga magsasaka sa pag-aararo ng bukid. Mahilig din itong lumublob sa putik para magpalamig dahil kaunti lang ang pawis nito.",
     "A carabao grazing on grass in a field."),
    ("7", ["jeepney-stop-passengers-lurch-g7"],
     "Pakita mo naman ang jeepney.",
     "Heto ang jeepney! Makukulay at puno ng disenyo ang ating pambansang sasakyan. Sa loob nito mo rin mararamdaman ang science — kapag biglang preno, sumusulong pa ang katawan mo dahil sa inertia.",
     "A colorful decorated jeepney."),
    ("5", ["banaue-rice-terraces-g5"],
     "Ano po ang hitsura ng Banaue Rice Terraces?",
     "Heto po ang Banaue Rice Terraces! Parang malalaking hagdan na inukit ng mga ninuno natin sa gilid ng bundok para mapagtaniman ng palay ang matarik na lupa. Libu-libong taon na ang ilan sa mga ito!",
     "The Banaue rice terraces carved like giant steps into the mountainside."),
    ("4", ["why-we-yawn-g3"],
     "May picture ka ba ng mangga?",
     "Meron! Heto ang mangga — ang pambansang prutas ng Pilipinas. Sa loob ng matamis nitong laman ay may iisang malaking buto, na pwedeng tumubo bilang bagong puno ng mangga.",
     "A mango (mangga) fruit with its golden yellow skin."),
    ("4", ["tarsier-big-eyes-g4", "tarsier-smallest-primate-g4"],
     "Pakita mo naman ang tarsier!",
     "Heto ang tarsier o mawmag! Kasinglaki lang ito ng palad mo pero napakalaki ng mga mata nito para makakita sa dilim. Dahil hindi nito magalaw ang mga mata, iniikot na lang nito ang buong ulo para tumingin sa paligid.",
     "A Philippine tarsier with huge round eyes clinging to a branch."),
    # --- everyday science objects ---
    ("4", ["matter-made-of-particles-magnify-g4"],
     "Ano ang hitsura ng magnifying glass?",
     "Heto ang magnifying glass! May bilog itong lens na salamin na mas makapal sa gitna at may hawakan. Binabaluktot nito ang liwanag kaya lumalaki ang itsura ng tinitingnan mo — perpekto para sa maliliit na bagay tulad ng langgam.",
     "A magnifying glass with a round lens and a handle."),
    ("5", ["pollination-g4"],
     "Pakita mo po kung ano ang itsura ng thermometer.",
     "Heto po ang thermometer! May manipis itong tubo na may likido sa loob. Kapag umiinit, lumalawak ang likido at umaakyat ito sa tubo — kaya ang taas ng likido ang nagsasabi ng temperatura sa iskala.",
     "Reading a liquid thermometer with its scale of numbers."),
    ("6", ["fme-magnetism-g4"],
     "May larawan ka ba ng compass?",
     "Meron! Heto ang compass. Ang karayom nito ay isang maliit na magnet na malayang umiikot, kaya humahanay ito sa magnetic field ng Earth at laging itinuturo ang hilaga — kaya hindi ka maliligaw.",
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
