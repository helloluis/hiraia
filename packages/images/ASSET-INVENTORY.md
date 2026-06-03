# Hiraia Pre-Built Asset Inventory

**Goal:** Build a library of hundreds of reusable SVG assets — from primitive shapes to stick figures, animals, plants, apparatus, and composite diagrams — grounded in what is **actually taught in Philippine grade-school (elementary) science**.

**Grounding sources** (verified against primary documents):
- DepEd **K-12 Science Curriculum Guide**, August 2016 (revised) — competency codes `S3..–S10..`.
- DepEd **MATATAG Science CG 2023** (Grades 3–10; detailed quarter-level CGs published for Grades 4 & 7).
- **MATATAG Kindergarten CG** + Makabansa (K–G2 science is embedded, not a standalone subject).
- Existing in-repo curriculum scaffold: `packages/shared/src/curriculum/index.ts`.

**Scope:** Science is a standalone subject only from **Grade 3**; K–G2 science is embedded in Makabansa/English/Math ("use senses to describe body parts, plants, animals, weather"). This inventory covers **Grades 3–10** — **Part A** is elementary (K–G6, the original "grade school" spine); **Part B** is Junior High School (G7–10). Many items are reusable across multiple grades.

**Domain → quarter mapping (both curricula, identical):** Q1 Matter · Q2 Living Things · Q3 Force/Motion/Energy · Q4 Earth & Space.

---

## ⛔ Hard exclusion — reproductive health

Per project directive, **nothing** about human reproduction is included anywhere in this inventory:
- Human reproductive system / organs (2016 codes `S5LT-IIa-1`, `S5LT-IId-4`)
- Puberty, menstrual cycle (`S5LT-IIb-2`, `S5LT-IIc-3`)
- Sex education / Comprehensive Sexuality Education

These are Grade 5 topics in the 2016 CG and are deliberately **omitted**.

## ✅ Confirmed included — life cycles & plant reproduction

The curriculum's word "reproduce" otherwise refers to **plant/animal life cycles and pollination**, which are core Grade 4–6 science (`S5LT-IIe-5`, `S5LT-IIf-6`, `S5LT-IIg-7`, `S6LT-IIg-h-4`). **Decision: include all** of these (they are not reproductive *health*):
- Animal life cycles: butterfly, frog, mosquito, chicken
- Plant life cycle (seed → seedling → mature → flower → fruit), seed germination
- Flower cross-section / "reproductive parts" of a plant, pollination
- Spore-bearing & cone-bearing plant reproduction

JHS extends this with **mitosis/cell division** (G7), **DNA/genetics/Punnett squares** (G8–10) — all included; only *human reproductive anatomy* is excluded.

---

## Conventions

- **ID** — kebab-case; becomes the asset filename (`<id>.svg` + `<id>.json`).
- **Subject folder** — `biology` · `chemistry` · `physics` · `earth-science` · `general`.
- **Grade** — primary band (K2 / G3 / G4 / G5 / G6); many reusable beyond.
- **Tier** — build complexity: **T1** primitive/symbol · **T2** single object/icon · **T3** composite figure/diagram/scene.
- **Status** — ✅ already exists · ⚠️ flagged (gray area) · blank = to build.
- **Code** — DepEd competency code where directly attributable.

---

# Part A — Elementary (Kindergarten – Grade 6)

## 1. Building blocks — shapes, symbols & science-process visuals  (`general`, T1)

| ID | Name | Grade | Code | Notes |
|----|------|-------|------|-------|
| arrow-single | Single direction arrow → | G3+ | — | process/flow |
| arrow-double | Bidirectional arrow ↔ | G3+ | — | |
| arrow-curved | Curved/turn arrow | G4 | — | change direction |
| arrow-cycle | Circular cycle arrows | G4+ | — | life cycle, water cycle |
| sign-plus | Plus sign + | G3+ | — | "A + B = C" |
| sign-equals | Equals sign = | G3+ | — | |
| label-callout | Label tag + leader line | G3+ | — | for labeling diagrams |
| zoom-callout | Magnified-detail zoom circle | G3+ | — | hand-lens detail |
| chart-data-table | Blank observation table (grid) | G3+ | — | rows/cols + tally |
| tally-marks | Tally-mark block | G3+ | — | |
| graph-bar | Simple bar graph (axes + bars) | G4+ | — | |
| graph-pictograph | Pictograph (icons-as-counts) | G3+ | — | |
| graph-line-distance-time | Distance–time / speed line graph | G4+ | `S5FE-IIIa-1` | "label simple graphs of speed" |
| diagram-flowchart | Flowchart frame (boxes + arrows) | G4+ | — | changes of state, cycles |
| diagram-venn | Two-circle Venn | G3+ | — | compare/contrast |
| diagram-tchart | T-chart compare frame | G3+ | — | |
| icon-method-question | Sci-method: Question | G3+ | — | step-icon set |
| icon-method-hypothesis | Sci-method: Hypothesis (idea bulb) | G3+ | — | |
| icon-method-experiment | Sci-method: Experiment | G3+ | — | |
| icon-method-observe | Sci-method: Observe/Data | G3+ | — | |
| icon-method-conclude | Sci-method: Conclusion | G3+ | — | |
| icon-observe-eye | "Observe" eye icon | G3+ | — | |
| icon-clipboard | Checklist / clipboard | G3+ | — | |

## 2. Human figure & body (external)  (`general` / `biology`, T2–T3)

| ID | Name | Grade | Code | Notes |
|----|------|-------|------|-------|
| figure-stick-male | Male stick figure | K2+ | — | |
| figure-stick-female | Female stick figure | K2+ | — | |
| figure-stick-child | Child stick figure | K2+ | — | |
| figure-adult-generic | Generic adult outline | K2+ | — | |
| body-outline-front | Body silhouette (labeling) | G3 | — | external parts only |
| body-parts-labeled | Labeled external body parts | G3 | — | head/arms/legs/etc. composite |
| head-face-front | Simple head/face front view | K2 | — | |
| face-emotions | Faces: happy/sad | K2 | — | GMRC "feelings" |
| hand-palm | Hand (palm + fingers) | K2 | — | counting, touch |
| foot | Foot / footprint | K2 | — | |
| tooth | Single tooth | G3 | — | dental health |

## 3. Five senses  (`biology`, T2)

| ID | Name | Grade | Code | Notes |
|----|------|-------|------|-------|
| sense-eye | Eye (sight) | G3 | `S3LT-IIa-b-1` | |
| sense-ear | Ear (hearing) | G3 | `S3LT-IIa-b-1` | |
| sense-nose | Nose (smell) | G3 | `S3LT-IIa-b-1` | |
| sense-tongue | Tongue/mouth (taste) | G3 | `S3LT-IIa-b-1` | |
| sense-skin-hand | Skin/hand (touch) | G3 | `S3LT-IIa-b-1` | |
| sense-pair-sight | Eye → object seen | G3 | — | pairing icon |
| sense-pair-sound | Ear → sound waves | G3 | — | |
| sense-pair-smell | Nose → aroma lines | G3 | — | |

## 4. Human body systems & organs  (`biology`, G6, T3) — *no reproductive system*

| ID | Name | Grade | Code | Notes |
|----|------|-------|------|-------|
| system-skeletal | Skeleton / bones | G4/G6 | `S6LT-IIa-b-1` | |
| system-muscular | Muscles | G4/G6 | `S6LT-IIa-b-1` | |
| system-integumentary | Skin (layers), hair, nails | G6 | `S6LT-IIc-d-2` | |
| system-digestive | Digestive tract (mouth→intestines, liver) | G4/G6 | `S6LT-IIc-d-2` | |
| system-respiratory | Nose, trachea, lungs, diaphragm | G4/G6 | `S6LT-IIc-d-2` | |
| system-circulatory | Heart + blood vessels | G4/G6 | `S6LT-IIc-d-2` | |
| system-nervous | Brain, spinal cord, nerves | G6 | `S6LT-IIc-d-2` | |
| organ-heart | Heart (single organ) | G4 | — | |
| organ-lungs | Lungs | G4 | — | |
| organ-brain | Brain | G6 | — | |
| organ-stomach | Stomach | G4 | — | |
| organ-kidneys | Kidneys (excretory) | G6 | — | optional |
| torso-composite | Torso "systems together" | G6 | `S6LT-IIc-d-2` | |

## 5. Animals (Philippine)  (`biology`, T2)

**Mammals:** carabao-kalabaw, cow-baka, goat-kambing, pig-baboy, dog-aso, cat-pusa, monkey-unggoy, horse-kabayo, bat-paniki, tarsier *(endemic)*
**Birds:** chicken-manok (hen), rooster, chick, duck-itik, maya, eagle-agila *(Phil. eagle)*, owl-kuwago, dove-kalapati
**Reptiles:** snake-ahas, lizard-butiki, gecko-tuko, turtle-pagong, monitor-bayawak, crocodile-buwaya
**Amphibians:** frog-palaka, toad
**Fish:** tilapia, milkfish-bangus, catfish-hito, goldfish-generic
**Insects:** butterfly-paruparo, bee-bubuyog, ant-langgam, mosquito-lamok, housefly-langaw, dragonfly-tutubi, grasshopper-tipaklong, beetle, moth-gamugamo, cockroach-ipis
**Arachnids:** spider-gagamba (+ web)
**Crustaceans:** shrimp-hipon, crab-alimango
**Molluscs:** snail-kuhol, clam-shell
**Annelids:** earthworm-bulate

*(~45 single-animal assets; grade refs `S3LT-IIc-d-3..7`, MATATAG G2 LC3 "classify Philippine animals", G2 LC7 "food chain using PH living things")*

## 6. Animal parts & young  (`biology`, T2)

| ID | Name | | ID | Name |
|----|------|--|----|------|
| part-wing | Wing | | part-feather | Feather |
| part-fin | Fin | | part-scale | Scale |
| part-beak | Beak | | part-shell | Shell |
| part-claw | Claw/talon | | part-antenna | Antenna |
| part-tail | Tail | | part-gill | Gill |
| part-fur | Fur/hair | | egg-generic | Egg |
| nest | Nest | | animal-young | Young (calf/piglet/chick) |

## 7. Plants (Philippine)  (`biology`, T2)

**Crops/food:** rice-palay, corn-mais, coconut-niyog, banana-saging, mango-mangga, eggplant-talong, tomato-kamatis, kangkong, sweet-potato-kamote, mungbean-munggo
**Trees/ornamentals/flowers:** narra *(national tree)*, gumamela, santan, sampaguita *(national flower)*, bougainvillea, rose-rosas, acacia, bamboo-kawayan
**Non-flowering/lower:** fern-pako, mushroom-kabute, grass-damo, moss, algae-lumot, water-lily
**Plant-part diagram set:** plant-root-system, plant-stem, plant-branch, plant-leaf (+venation), plant-flower, plant-seed, plant-fruit, plant-bud, plant-seedling, plant-whole-labeled ✅ *(leaf exists)*

*(~35 assets; codes `S3LT-IIe-f-8..10` plant external parts)*

## 8. Life cycles & plant reproduction  (`biology`, T3) — ⚠️ FLAGGED

| ID | Name | Grade | Code | Status |
|----|------|-------|------|--------|
| lifecycle-butterfly | Butterfly (egg→larva→pupa→adult) | G4/G5 | `S5LT-IIe-5` | ⚠️ |
| lifecycle-frog | Frog (egg→tadpole→froglet→frog) | G4/G5 | `S5LT-IIe-5` | ⚠️ |
| lifecycle-mosquito | Mosquito (egg→larva→pupa→adult) | G5 | `S5LT-IIe-5` | ⚠️ |
| lifecycle-chicken | Chicken (egg→chick→hen) | G4 | — | ⚠️ |
| lifecycle-plant | Plant (seed→seedling→mature→fruit) | G4/G5 | `S5LT-IIg-7` | ⚠️ |
| seed-germination | Seed germination sequence | G5 | `S5LT-IIg-7` | ⚠️ |
| flower-cross-section | Flower parts cross-section | G5 | `S5LT-IIf-6` | ⚠️ |
| pollination | Pollination diagram | G5 | `S5LT-IIf-6` | ⚠️ |
| plant-spore-bearing | Fern/moss with spores | G6 | `S6LT-IIg-h-4` | ⚠️ |
| plant-cone-bearing | Pine + cone | G6 | `S6LT-IIg-h-4` | ⚠️ |

## 9. Ecosystems, habitats & food webs  (`biology`/`earth-science`, T3)

**Habitats/settings:** forest-kagubatan, rice-field-palayan, ocean-dagat, seashore-beach, mangrove-bakawan, river-ilog, pond-lawa, lake, mountain-bundok, garden-hardin, farm-bukid, backyard, classroom, kitchen, house-bahay-kubo, coral-reef, rainforest, estuary, intertidal-zone
**Habitat zones:** habitat-terrestrial, habitat-aquatic, habitat-aerial *(MATATAG G4 Q2)*
**Food relationships:** foodchain-arrow-set, foodweb-diagram, role-producer, role-consumer, role-herbivore, role-carnivore, role-omnivore, role-scavenger, role-decomposer
**Other:** biotic-vs-abiotic, microbe-bacteria *(MATATAG G5 microorganisms)*, basic-needs-icons (air/water/food/sunlight/shelter), living-vs-nonliving

*(codes `S3LT-IIi-j` basic needs; `S5LT-IIh-8..10` estuary/intertidal; `S6LT-IIi-j-5..6` rainforest/reef/mangrove)*

## 10. Matter & materials  (`chemistry`, T2–T3)

| ID | Name | Grade | Code |
|----|------|-------|------|
| state-solid-examples | Solids (rock, wood, ice, coin) | G3 | `S3MT-Ia-b-1` |
| state-liquid-examples | Liquids (water/juice/oil in container) | G3 | `S3MT-Ia-b-1` |
| state-gas-examples | Gases (balloon, bubbles, steam) | G3 | `S3MT-Ia-b-1` |
| state-sort-chart | Solid/liquid/gas sorting chart | G3 | `S3MT-Ic-d-2` |
| changes-of-state | Ice→water→steam diagram | G3/G6 | `S3MT-Ih-j-4` |
| mixture-homogeneous | Solution (juice, salt water) | G6 | `S6MT-Ia-c-1` |
| mixture-heterogeneous | Halo-halo, salad, sand+water | G6 | `S6MT-Ia-c-1` |
| solution-solute-solvent | Dissolving diagram | G6 | `S6MT-Ia-c-1` |
| separate-filtering | Funnel + filter paper | G6 | `S6MT-Id-f-2` |
| separate-evaporation | Evaporation dish + heat | G6 | `S6MT-Id-f-2` |
| separate-decantation | Decanting (two beakers) | G6 | `S6MT-Id-f-2` |
| separate-sieving | Sieve/strainer | G6 | `S6MT-Id-f-2` |
| separate-magnet | Magnet pulling iron filings | G6 | `S6MT-Id-f-2` |
| change-rusting-nail | Rusting nail (chemical) | G5 | `S5MT-Ic-d-2` |
| change-burning-paper | Burning paper (chemical) | G5 | `S5MT-Ic-d-2` |
| change-rotting-fruit | Rotting/decaying fruit | G5 | `S5MT-Ic-d-2` |
| change-melting-ice | Melting ice (physical) | G5 | `S5MT-Ic-d-2` |
| recycle-bins-5r | Segregation/recycle bins (5 R's) | G5 | `S5MT-Ie-g-3` |
| biodegradable-vs-not | Biodegradable vs non- | G4 | MATATAG G4 Q1 |
| co2-molecule | CO₂ molecule | — | ✅ |
| water-molecule | H₂O molecule | — | ✅ |

**Everyday matter objects (T2):** glass-of-water, ice-cube, steam-vapor, water-drop, rock-stone, pebbles, balloon, ball, toy-car, candle-flame, matchstick, mirror

## 11. Force, motion & energy  (`physics`, T2–T3)

| ID | Name | Grade | Code |
|----|------|-------|------|
| force-push-arrow | Push arrow on object | G3 | `S3FE-IIIa-b-1` |
| force-pull-arrow | Pull arrow on object | G3 | `S3FE-IIIa-b-1` |
| force-shape-change | Stretch/bend/squeeze | G4 | MATATAG G4 Q3 |
| machine-lever | Lever / seesaw | G6 | `S6FE-IIIg-i-3` |
| machine-pulley | Pulley + rope + load | G6 | `S6FE-IIIg-i-3` |
| machine-wheel-axle | Wheel-and-axle | G6 | `S6FE-IIIg-i-3` |
| machine-inclined-plane | Ramp / inclined plane | G6 | `S6FE-IIIg-i-3` |
| machine-wedge | Wedge (axe/knife) | G6 | `S6FE-IIIg-i-3` |
| machine-screw | Screw / bolt | G6 | `S6FE-IIIg-i-3` |
| magnet-bar | Bar magnet (N/S) | G4 | MATATAG G4 Q3 |
| magnet-horseshoe | Horseshoe magnet | G4 | MATATAG G4 Q3 |
| magnet-attract-repel | Poles attract/repel | G4 | MATATAG G4 Q3 |
| magnet-iron-filings | Iron-filing field pattern | G4 | MATATAG G4 Q3 |
| magnetic-test-objects | Paperclips/nails vs plastic | G4 | MATATAG G4 Q3 |
| circuit-dry-cell | Battery / dry cell | G5 | `S5FE-IIIf-6` ✅ |
| circuit-bulb | Bulb + socket | G5 | ✅ (lightbulb) |
| circuit-wire | Connecting wire | G5 | — |
| circuit-switch | Switch (knife switch) | G5 | ✅ |
| circuit-complete | Complete circuit | G5 | `S5FE-IIIf-6` |
| circuit-incomplete | Incomplete/open circuit | G5 | `S5FE-IIIf-6` |
| circuit-series-parallel | Series vs parallel | G5 | `S5FE-IIIf-6` |
| electromagnet | Nail + coil + cell | G5 | `S5FE-IIIi-j-9` |
| conductor-insulator | Metal vs plastic/wood | G5 | `S5FE-IIIc-3` |
| light-source-set | Sun/candle/flashlight/bulb | G3 | `S3FE-IIIg-h` |
| light-opaque-translucent-transparent | Light transmission | G5 | `S5FE-IIIe-5` |
| light-reflection-mirror | Reflection off mirror | G5 | — |
| shadow-formation | Object + light → shadow | G4 | MATATAG G4 Q4 |
| sound-source-set | Drum/bell/guitar/speaker | G3 | `S3FE-IIIg-h` |
| sound-waves | Sound wave ripples | G4 | — |
| heat-source-set | Sun/stove/fire/iron | G3 | `S3FE-IIIi-j-3` |
| heat-by-color | Black vs white under sun | G5 | `S5FE-IIId-4` |
| energy-forms-icons | Light/sound/heat/elec/mech | G6 | `S6FE-IIIc-f-2` |
| energy-transformation | Transformation chain | G6 | `S6FE-IIIc-f-2` |
| gravity-fall | Object falling (gravity) | G6 | `S6FE-IIIa-b-1` |
| friction-surfaces | Rough vs smooth + ball | G6 | `S6FE-IIIa-b-1` |
| spring-rubberband | Spring / rubber band | G4 | — |
| electric-appliances | Fan, flashlight (energy use) | G3 | — |

## 12. Earth & space  (`earth-science`, T2–T3)

| ID | Name | Grade | Code |
|----|------|-------|------|
| landform-mountain | Mountain | G3 | `S3ES-IVa-b-1` |
| landform-hill | Hill | G3 | `S3ES-IVa-b-1` |
| landform-plain-valley | Plain / valley | G3 | `S3ES-IVa-b-1` |
| water-river | River | G3 | `S3ES-IVa-b-1` |
| water-lake-pond | Lake / pond | G3 | `S3ES-IVa-b-1` |
| water-ocean | Ocean / sea | G3 | `S3ES-IVa-b-1` |
| soil-sandy | Sandy soil | G4 | MATATAG G4 Q4 |
| soil-clay | Clay soil | G4 | MATATAG G4 Q4 |
| soil-silt | Silt soil | G4 | MATATAG G4 Q4 |
| soil-loam | Loam soil | G4 | MATATAG G4 Q4 |
| soil-profile | Soil layers cross-section | G4 | — |
| soil-water-test | Soil + funnel water-holding | G4 | MATATAG G4 Q4 |
| rock-types | Igneous/smooth/layered rocks | G5 | — |
| mineral-crystal | Mineral / crystal | G5 | — |
| weathering-rock-to-soil | Rock breaking → soil | G5 | `S5FE-IVa-1` |
| soil-erosion | Erosion scene + control | G5 | `S5FE-IVb-2` |
| weather-symbol-set | Sunny/cloudy/rainy/stormy/windy | G3 | `S3ES-IVe-f-3` |
| weather-sun | Sun | G3 | ✅ (sun) |
| weather-cloud | Cloud (white + rain) | G3 | — |
| weather-rain | Rain / raindrops | G3 | — |
| weather-lightning | Lightning bolt | G3 | — |
| weather-rainbow | Rainbow | G3 | — |
| weather-wind | Wind (motion lines) | G3 | — |
| weather-typhoon | Typhoon/bagyo spiral | G5 | `S5FE-IVd-4` |
| weather-chart | Daily weather chart | G3 | `S3ES-IVg-h-5` |
| instrument-thermometer | Thermometer | G4 | MATATAG G4 Q4 |
| instrument-barometer | Barometer | G4/G5 | MATATAG G4 Q4 |
| instrument-anemometer | Anemometer | G4/G5 | MATATAG G4 Q4 |
| instrument-wind-vane | Wind vane | G4 | MATATAG G4 Q4 |
| instrument-rain-gauge | Rain gauge | G4 | MATATAG G4 Q4 |
| seasons-wet-dry | PH wet vs dry season | G6 | `S6ES-IVc-3` |
| water-cycle | Water cycle | G4/G5 | MATATAG G5 |
| the-sun | Sun (ball of hot gas + rays) | G4 | MATATAG G4 Q4 |
| sun-earth-size | Sun vs Earth size compare | G4 | MATATAG G4 Q4 |
| sundial-gnomon | Shadow stick / sundial | G4 | MATATAG G4 Q4 |
| sky-day-night | Day vs night sky | G3 | `S3ES-IVg-h-6` |
| moon-phases | Moon phases set | G5 | `S5FE-IVg-h-7` |
| sun-earth-moon-model | Sun–Earth–Moon model | G5 | `S5FE-IVg-h-8` |
| stars-constellations | Constellation star maps | G5 | `S5FE-IVi-j-9` |
| solar-system | Sun + 8 planets ordered | G6 | `S6ES-IVg-h-6` ✅ partial |
| planet-set | Individual planets | G6 | `S6ES-IVg-h-6` |
| earth-globe | Earth / globe | G6 | ✅ (earth) |
| earth-rotation | Rotation → day/night | G6 | `S6ES-IVe-f-5` |
| earth-revolution | Revolution around sun | G6 | `S6ES-IVe-f-5` |
| earthquake-fault | Fault line + shaking | G6 | `S6ES-IVa-1` |
| volcano-cross-section | Volcano (magma/vent/crater) | G6 | `S6ES-IVa-2` |
| volcano-erupting | Erupting volcano + ash | G6 | `S6ES-IVa-2` |
| disaster-gobag | Emergency go-bag kit | G5/G6 | — |
| safety-duck-cover-hold | Earthquake safety | G6 | — |

## 13. Lab & measurement tools  (`general`, T2)

ruler, meter-stick, weighing-scale, beam-balance, triple-beam-balance, spring-balance, lab-thermometer, clinical-thermometer, graduated-cylinder, beaker, measuring-cup, measuring-spoons, stopwatch, analog-clock, funnel, dropper-pipette, test-tube, test-tube-rack, magnifying-glass, microscope (+ slide, cover-slip), petri-dish, jar-cup, plastic-bottle, basin-pail, sieve-strainer, stirring-rod, tongs, tray

**Safety gear:** goggles, lab-apron, gloves, face-mask, first-aid-kit, warning-caution-icons

*(codes: equipment list tagged in 2016 CG; magnifying glass is the core elementary tool, microscope introduced G7)*

---

# Part B — Junior High School (Grades 7–10)

JHS is diagram-heavy (the CG explicitly mandates "labelled diagrams, free-body diagrams, models, Punnett squares"), so most items are **T3 composites**. Many spiral across grades and the 2016 vs MATATAG CGs place some topics in different grades — build once, tag both. **Operative CG:** G7 has a detailed MATATAG CG; G8–10 still run on the 2016 K-12 CG (`S8../S9../S10..` codes).

> ⛔ Excluded throughout: human reproductive system, fertilization, puberty, menstrual cycle, reproductive hormones (e.g. 2016 `S10LT-IIIa-33..IIIc-35`; MATATAG G7 Q2 fertilization). Mitosis, DNA, genetics, evolution, and ecological/non-human content are retained.

## 14. JHS Chemistry / Matter  (`chemistry`, mostly T3)

| ID | Name | Grade | Code |
|----|------|-------|------|
| particle-model-states | Solid/liquid/gas particle arrangements | G7/G8 | `S8MT-IIIa` |
| changes-of-state-cycle | Melt/freeze/evap/condense/sublime/deposit | G7 | — |
| solute-solvent-solution | Dissolving + dilute/concentrated/saturated | G7 | `S7MT-Ic-2` |
| substance-vs-mixture-particles | Element/compound/mixture particle boxes | G7 | `S7MT-Ie-f` |
| separation-distillation | Distillation apparatus | G7 | — |
| acid-base-litmus | Red/blue litmus + acid/base examples | G7 | `S7MT-Ii-6` |
| ph-scale | pH scale 0–14 color gradient | G7 | `S7MT-Ii-6` |
| metals-nonmetals-metalloids | Sample icons + PT staircase zones | G7 | `S7MT-Ij-7` |
| atom-bohr-model | Bohr model (nucleus + shells) | G8/G9 | `S8MT-IIIe` |
| subatomic-particles | Proton/neutron/electron key | G8 | `S8MT-IIIe` |
| atomic-model-timeline | Dalton→Thomson→Rutherford→Bohr | G8 | `S8MT-IIIf` |
| electron-shell-filling | Shells 2,8,8 / valence electrons | G8 | — |
| quantum-orbitals | s-sphere, p-dumbbell, electron cloud | G9 | `S9MT-IIa-21` |
| electron-configuration | 1s 2s 2p box notation | G9 | `S9MT-IIa-22` |
| periodic-table-full | Full PT grid (7×18) | G8 | `S8MT-IIIg` |
| periodic-table-cell | Single element tile | G8 | — |
| element-symbols-first20 | H,He,Li,…,Ca symbol set | G8 | — |
| periodic-trends | Reactivity/size trend arrows | G8 | `S8MT-IIIi` |
| bond-ionic | Electron transfer + NaCl lattice | G8/G9 | `S9MT-IIa-13` |
| bond-covalent | Shared pairs (H₂, O₂, N₂) | G8/G9 | `S9MT-IIb-14` |
| bond-metallic | Cations in electron sea | G9 | `S9MT-IIc-d-15` |
| lewis-dot-structures | Electron-dot diagrams | G9 | — |
| molecule-models | Ball-and-stick / space-filling | G9 | — |
| vsepr-shapes | Linear/bent/tetrahedral | G9 | — |
| carbon-bonding | Tetravalent C; chains/rings | G9 | `S9MT-IIg-17` |
| hydrocarbons | Methane/ethane/benzene structural | G9 | `S9MT-IIh-18` |
| functional-groups | -OH, -COOH icons | G9 | — |
| mole-concept-map | Mole↔mass↔particles triangle | G9 | `S9MT-IIi-19` |
| gas-laws-boyle | Syringe + P–V hyperbola | G10 | `S10MT-IVa-b-21` |
| gas-laws-charles | Balloon heated + V–T line | G10 | `S10MT-IVa-b-21` |
| biomolecules | Carb/lipid/protein/nucleic-acid | G10 | `S10MT-IVc-d-22` |
| phospholipid-bilayer | Membrane bilayer | G10 | — |
| chemical-equation-balanced | Reactants→products + coefficients | G10 | `S10MT-IVe-g-23` |
| conservation-of-mass | Balance equal before/after | G10 | — |
| reaction-rate-factors | Temp/conc/surface-area/catalyst | G10 | `S10MT-IVh-j-24` |

## 15. JHS Biology / Living Things  (`biology`, mostly T3)

| ID | Name | Grade | Code |
|----|------|-------|------|
| microscope-labeled | Compound microscope parts | G7 | `S7LT-IIa-1` |
| cell-animal-organelles | Animal cell (full organelles) | G7 | `S7LT-IId-4` |
| cell-plant-organelles | Plant cell (wall, chloroplast, vacuole) | G7 | `S7LT-IId-4` |
| cell-comparison | Plant vs animal side-by-side | G7 | `S7LT-IIe-5` |
| mitosis-stages | Interphase→…→cytokinesis | G7 | MATATAG G7 Q2 |
| levels-of-organization | Cell→tissue→…→biosphere | G7 | `S7LT-IIc-3` |
| food-pyramid-trophic | Energy/biomass pyramid | G7/G10 | `S7LT-IIh` |
| ecological-interactions | Predation/symbiosis icons | G7 | — |
| digestive-system-detailed | Mouth→intestines + liver/pancreas | G8/G9 | `S8LT-IVa` |
| respiratory-system-detailed | Trachea/bronchi/alveoli | G8/G9 | `S9LT-Ia-b-26` |
| circulatory-system-detailed | 4-chamber heart + double loop | G8/G9 | `S9LT-Ic-27` |
| gas-exchange-alveolus | O₂/CO₂ at alveolus–capillary | G9 | `S9LT-Ia-b-26` |
| plant-transport-xylem-phloem | Root→stem→leaf transport | G8 | MATATAG G8 Q1 |
| photosynthesis-detailed | Chloroplast inputs/outputs | G8/G9 | `S9LT-Ig-j-31` |
| respiration-cellular | Mitochondrion glucose+O₂→energy | G8/G9 | `S9LT-Ig-j-31` |
| punnett-square | 2×2 allele grid | G8/G9 | `S8LT-IVf` |
| dominant-recessive | Tall/short pea trait icons | G8 | — |
| incomplete-dominance | Red×white→pink flower | G9 | `S9LT-Id-28` |
| blood-type-codominance | ABO chart | G9 | — |
| sex-linked-inheritance | X/Y trait carrier (genetics only) | G9 | `S9LT-Id-29` |
| pedigree-chart | Square/circle family tree | G8/G9 | — |
| chromosome-gene | Chromosome with gene loci | G8 | — |
| taxonomic-hierarchy | Domain→…→Species ladder | G8 | `S8LT-IVg` |
| six-kingdoms | Kingdom representative icons | G8 | `S8LT-IVg` |
| carbon-oxygen-cycle | Carbon & oxygen cycle diagrams | G8 | MATATAG G8 Q1 |
| neuron | Cell body/dendrites/axon/synapse | G10 | `S10LT-IIIc-36` |
| reflex-arc | Stimulus→receptor→response | G10 | — |
| homeostasis-feedback | Feedback-loop diagram | G10 | `S10LT-IIIc-36` |
| dna-double-helix | Backbone + base pairs A-T/G-C | G10 | `S10LT-IIId-37` |
| dna-replication | Replication fork | G10 | — |
| transcription-translation | DNA→mRNA→ribosome→protein | G10 | `S10LT-IIId-37` |
| mutation-types | Substitution/insertion/deletion | G10 | `S10LT-IIIe-38` |
| evolution-evidence | Fossils + homologous limbs | G10 | `S10LT-IIIf-39` |
| natural-selection | Peppered moth / finch beaks | G10 | `S10LT-IIIf-39` |
| phylogenetic-tree | Branching tree of life | G10 | `S10LT-IIIg-40` |
| population-growth-curve | J-curve / S-curve + carrying capacity | G10 | `S10LT-IIIh-41` |
| extinction-timeline | Geologic eras + extinct species | G9 | `S9LT-Ie-f-30` |

## 16. JHS Physics / Force, Motion & Energy  (`physics`, mostly T3)

| ID | Name | Grade | Code |
|----|------|-------|------|
| distance-vs-displacement | Path length vs straight arrow | G7 | `S7FE-IIIa` |
| speed-vs-velocity | Scalar vs vector | G7 | `S7FE-IIIa` |
| motion-graphs | Distance-time / velocity-time | G7/G8 | `S7FE-IIIb` |
| free-body-diagram | Box + labeled force arrows | G7 | MATATAG G7 Q3 |
| balanced-unbalanced-forces | Tug-of-war vs net force | G7 | — |
| wave-transverse | Sine: crest/trough/amplitude/λ | G7 | `S7LT-IIIc` |
| wave-longitudinal | Compression/rarefaction (slinky) | G7 | `S7LT-IIIc` |
| sound-pitch-loudness | Frequency/amplitude compare | G7 | `S7LT-IIId` |
| light-ray-reflection | Incident/reflected/normal | G7/G10 | `S7LT-IIIf` |
| light-refraction | Bending through water/glass | G7/G10 | `S7LT-IIIg` |
| prism-dispersion | White light → spectrum | G7/G10 | — |
| heat-conduction | Heat through metal rod | G7/G8 | `S7LT-IIIh` |
| heat-convection | Current loops in fluid | G7/G8 | `S7LT-IIIh` |
| heat-radiation | Sun/fire heat rays | G7/G8 | `S7LT-IIIh` |
| charging-methods | Friction/contact/induction | G7 | `S7LT-IIIj` |
| newtons-first-law | Inertia (seatbelt) | G8/G9 | `S8FE-Ia-15` |
| newtons-second-law | F = ma | G8/G9 | `S8FE-Ia-16` |
| newtons-third-law | Action–reaction pairs | G8/G9 | `S8FE-Ib-19` |
| work-force-distance | Person pushing box | G8 | `S8FE-Ic-20` |
| kinetic-potential-energy | Moving vs raised object | G8 | `S8FE-Id-22` |
| energy-transformation-pe-ke | Falling ball / pendulum | G8/G9 | — |
| circuit-schematic-symbols | Battery/resistor/bulb/switch symbols | G8 | `S8FE-If` |
| circuit-series-parallel-schematic | Series vs parallel | G8 | — |
| ohms-law | V = IR triangle | G8 | — |
| projectile-motion | Parabolic arc + components | G9 | `S9FE-IVa-34` |
| momentum-collision | Carts before/after, Newton's cradle | G9 | `S9FE-IVb-36` |
| roller-coaster-energy | PE↔KE along track | G9 | `S9FE-IVc-39` |
| simple-machines-jhs | Lever/pulley/inclined (quantified) | G9 | `S9FE-IVd-40` |
| energy-efficiency-sankey | Input/useful/wasted heat | G9 | `S9FE-IVf-44` |
| power-generation-grid | Plant→towers→transformer→home | G9 | `S9FE-IVh-j-46` |
| power-plant-types | Hydro/geothermal/wind/nuclear | G9 | — |
| em-spectrum | Radio→…→gamma band | G10 | `S10FE-IIa-b-47` |
| visible-light-roygbiv | Color band | G10 | — |
| mirrors-concave-convex | Curved mirror ray diagrams | G10 | `S10FE-IIg-50` |
| lenses-converging-diverging | Lens ray diagrams | G10 | `S10FE-IIg-51` |
| optical-instruments | Camera/eye/magnifier | G10 | — |
| magnetic-field-lines | Bar magnet + compass | G10 | `S10FE-IIi-53` |
| electromagnetic-induction | Magnet through coil + galvanometer | G10 | `S10FE-IIi-53` |
| electric-motor-generator | Coil/magnets/commutator | G10 | `S10FE-IIj-54` |
| solenoid-right-hand-rule | Coil + current + field | G10 | — |

## 17. JHS Earth & Space  (`earth-science`, mostly T3)

| ID | Name | Grade | Code |
|----|------|-------|------|
| atmosphere-layers | Tropo→exosphere cross-section | G7 | `S7ES-IVf` |
| greenhouse-effect | Trapped-heat diagram | G7 | `S7ES-IVg` |
| land-sea-breeze | Day/night convection over coast | G7 | `S7ES-IVd` |
| monsoon-habagat-amihan | Seasonal wind arrows | G7 | MATATAG G7 Q4 |
| earth-tilt-seasons | 23.5° axis, 4 orbital positions | G7 | `S7ES-IVh` |
| sun-angle-latitude | Direct vs slanted rays | G7 | — |
| solar-eclipse | Sun–Moon–Earth + umbra | G7 | `S7ES-IVj-11` |
| lunar-eclipse | Sun–Earth–Moon shadow | G7 | `S7ES-IVj-11` |
| fault-types | Normal/reverse/strike-slip | G7/G8 | `S8ES-IIa` |
| focus-epicenter | Underground focus + surface epicenter | G7/G8 | `S8ES-IIa` |
| seismic-waves | P/S wave rings | G8 | `S8ES-IIb` |
| seismograph | Instrument + seismogram | G8 | — |
| tsunami-formation | Quake → wave to shore | G7/G8 | `S8ES-IIc` |
| earth-layers | Crust/mantle/outer-inner core | G8/G10 | MATATAG G8 Q3 |
| plate-boundaries | Divergent/convergent/transform | G8/G10 | `S10ES-Ia-j` |
| continental-drift-pangaea | Jigsaw continents | G8/G10 | — |
| mantle-convection | Convection currents drive plates | G8/G10 | — |
| ring-of-fire-map | Volcanoes/quakes/belts distribution | G8/G10 | `S10ES-Ia-j` |
| volcano-types | Shield/cinder/stratovolcano | G8/G9 | `S9ES-IIIa-25` |
| volcano-cross-section-jhs | Magma/conduit/crater/pyroclastic | G8/G9 | `S9ES-IIIa-27` |
| geothermal-energy | Plant over magma + steam | G9 | `S9ES-IIIa-27` |
| typhoon-structure | Eye/eyewall/bands + rotation | G8 | `S8ES-IId` |
| par-map-track | PH Area of Responsibility + path | G8 | — |
| tides-spring-neap | Sun–Earth–Moon tidal bulges | G8 | MATATAG G8 Q3 |
| comet-meteor-asteroid | Tail/streak/belt rock | G8 | `S8ES-IIg` |
| climate-factors | Latitude/altitude/currents icons | G9 | `S9ES-IIIe-30` |
| el-nino-la-nina | Pacific ocean-temp diagrams | G9 | `S9ES-IIIf-31` |
| climate-zones-map | Tropical/temperate/polar bands | G9 | — |
| constellations-jhs | Orion/Big Dipper star maps | G9 | `S9ES-IIIg-32` |
| star-chart-seasonal | Constellations by season | G9 | `S9ES-IIIi-34` |

### Optional — SHS-adjacent astronomy (NOT in the G9–10 JHS CG)

Stars/galaxies/Big Bang/star-life-cycle are **Senior High** (Earth/Physical Science), not JHS. Build only as enrichment: `big-bang-expansion`, `galaxy-types`, `star-life-cycle`, `hr-diagram`, `telescope`.

---

## Summary

| # | Category | ~Count | Tier mix |
|---|----------|--------|----------|
| 1 | Building blocks / symbols | 23 | T1 |
| 2 | Human figure & body | 11 | T2–T3 |
| 3 | Five senses | 8 | T2 |
| 4 | Body systems & organs | 13 | T3 |
| 5 | Animals (PH) | ~45 | T2 |
| 6 | Animal parts & young | 16 | T2 |
| 7 | Plants (PH) | ~35 | T2 |
| 8 | Life cycles & plant repro ⚠️ | 10 | T3 (flagged) |
| 9 | Ecosystems & food webs | ~35 | T3 |
| 10 | Matter & materials | ~33 | T2–T3 |
| 11 | Force, motion & energy | ~38 | T2–T3 |
| 12 | Earth & space | ~52 | T2–T3 |
| 13 | Lab & measurement tools | ~34 | T2 |
| | **Part A subtotal** | **~353** | (elementary, 10 exist) |
| 14 | JHS Chemistry / Matter | ~36 | T3 |
| 15 | JHS Biology / Living Things | ~37 | T3 |
| 16 | JHS Physics / FME | ~41 | T3 |
| 17 | JHS Earth & Space | ~30 | T3 |
| | **Part B subtotal** | **~144** | (JHS) |
| | **Grand total** | **~497** | (G3–10; 10 exist) |

## Suggested build batching (for the later parallel-agent phase)

1. **Wave 1 — T1 primitives & symbols** (cat. 1): shared building blocks the figure renderers can compose. ~23 assets.
2. **Wave 2 — T2 single objects** (cat. 3, 5, 6, 7, 13 + everyday objects): the bulk of Part A; highly parallelizable, one agent per asset or small batch. ~180 assets.
3. **Wave 3 — T3 elementary composites & scenes** (cat. 2, 4, 8, 9, 10–12 diagrams): life cycles, body systems, circuits, food webs, water cycle, solar system, volcano. ~140 assets.
4. **Wave 4 — JHS composites** (cat. 14–17): cells/organelles, periodic table, bonding, body systems in depth, Punnett squares, DNA, Newton's laws, ray diagrams, plate tectonics, eclipses. ~144 assets. Highest visual complexity — best authored after the elementary style is locked.

Each asset ships as `<id>.svg` + `<id>.json` metadata (matching the existing `AssetMetadata` schema: id, name, description, subject, grades, tags, curriculum, source=`hiraia`, license=`CC0`, viewBox).

## Curriculum-priority items

Most explicitly/repeatedly named in the actual G3–4 competencies — prioritize: the four soil types (sandy/clay/silt/loam), distance–time/bar graphs, weather instruments + weather chart, magnets, food chains/flowcharts, and "classify Philippine animals/plants" (drives the PH animal & plant sets).
