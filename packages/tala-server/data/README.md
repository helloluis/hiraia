# Tala curriculum data — source status

This is a starter catalogue, **not the V1.0 curriculum-completeness gate**.

## Included

`packs/` contains 322 extracted Science competencies: Grade 3 (34), 4 (33), 5 (40),
6 (35), 7 (45), 8 (44), 9 (46), 10 (45). These are extracted directly from the
archived DepEd **2026 Three-Term Budgets of Work for Learning Competencies** PDFs,
including term-level content and performance standards. Each competency records
the source document, edition, URL and **1-based physical PDF page** on which its
text starts. Printed footer numbers can differ (the PDFs have an extra leading
page); some competencies continue onto the following physical page.
`science-provenance.json` records the upstream archive paths, SHA-256 hashes,
source links and per-term counts. The extractor joins layout whitespace, preserves
source wording/capitalisation/punctuation, and removes only bullets, week-column
labels and page furniture. No model-authored competencies are included.

The records remain teacher-self-checkable, not staff certified. Apparent source
oddities (for example a repeated category or lowercase initial verb) are preserved.
Official competency codes are null: the older `G4-M-1`-style identifiers are local
Hiraia identifiers, not official DepEd codes. Individual published weights remain
null. The pacing engine uses sourced week ranges as an **official** time-allotment
signal, divided equally among the competencies sharing that range. Equal division
is an explicit engine heuristic, not a published individual duration.

Version `science-bow-2026` is mapped to `2026-2027`, following the repository's
2026 three-term schedule and dated source archive. It is **not** asserted to apply
to `2027-2028`; `versionFor` returns null for that year until current applicability
is established. Previously tagged versions remain individually addressable.

## Reference assessment

- `docs/grade*-subcategory-crosswalk.json`: local mappings, not official text.
- `docs/GRADE*-CURRICULUM-AUDIT.md` and the Grades 3–10 summary: local audit reports,
  useful provenance leads, not source documents for competency text.
- `packages/shared/src/curriculum/`: domain/scheduling metadata and the 2026 BOW
  source manifest, not a complete verbatim competency bank.
- `packages/web/scripts/build-competencies.mjs`: publishes authored student lessons;
  its output is not a teacher curriculum guide. Its source references led to the
  archived PDFs used here.
- The older `matatag-*-competencies.json` extracts were inspected as cross-checks,
  but their text is not copied into these packs or silently relabelled as 2026 text.

## Rebuild and verify

From this worktree, with Python 3, `pypdf`, Node and the repository Prettier installed:

```sh
python3 packages/tala-server/scripts/curriculum/import_science.py --reference-root /home/b11/code/hiraia
python3 packages/tala-server/scripts/curriculum/import_science.py --reference-root /home/b11/code/hiraia --check
python3 packages/tala-server/scripts/curriculum/build-fixtures.py
python3 packages/tala-server/scripts/curriculum/build-title-review.py
python3 packages/tala-server/scripts/curriculum/build-title-review.py --check
pnpm --filter @hiraia/tala-server type-check
pnpm --filter @hiraia/tala-server test
```

The reference checkout is read-only. Changed PDF hashes stop the importer. Review
extraction changes, bump dataRevision, and preserve published competency identities
before publishing updates. No publication is performed by these scripts. Pack
`bytes` is the exact UTF-8 file size. Server startup validates identity, count,
bytes, source fields and all contract schemas.

## Fixtures and calendars

`fixtures/` has synthetic Mathematics packs for Grades **2, 3, 4, 5**, supporting
both the G2+G4 demo and four-group tests. Every competency begins `SAMPLE DATA ONLY`,
and every version begins `fixture-`. The curriculum module includes them automatically in local and staging environments.
Production excludes them from the index, pack routes and curriculum service, even
if the old `includeFixtures` option is supplied. Direct `loadCurriculumData()`
still defaults to real packs only. Apps must mark the associated class
`isSample: true`; the shared `buildSampleClass` factory does this. These are not a curriculum claim.

`calendars/deped-2026-2027.json` and `deped-2027-2028.json` are both
`provisional: true`. Dates are editable **sample defaults**, not dates copied from
a verified DepEd order. No holidays/exams have been invented. Obtain and cite each
year's official school-calendar order, then replace the sample dates and empty day
list through a versioned data update. The three-term structure follows the locally
archived 2026 Science BOW, not an assumed four-quarter calendar.

## Official guides still needed for the V1.0 scope (§6.3.1)

Each listed grade × area needs the applicable official guide/BOW, edition and page
extraction. The PRD labels the area/rollout list **verify**; confirm the scope against
current orders before claiming coverage. Only the Science 2026 BOW rows above exist.

| Grade(s) | Guides still to obtain and extract |
| --- | --- |
| K | Kindergarten curriculum |
| 1 | Language; Reading and Literacy; Mathematics; Makabansa; GMRC |
| 2 | Language; Reading and Literacy; Mathematics; Makabansa; GMRC; Filipino; English |
| 3 | Language; Reading and Literacy; Mathematics; Makabansa; GMRC; Filipino; English |
| 4, 5, 6 (each) | Filipino; English; Mathematics; Araling Panlipunan; Music and Arts; Physical Education and Health; EPP/TLE; GMRC/Values Education |
| 7, 8, 9, 10 (each) | Filipino; English; Mathematics; Araling Panlipunan; Music and Arts; Physical Education and Health; EPP/TLE; GMRC/Values Education |
| 11 and 12 (each, core only) | Effective Communication / Mabisang Komunikasyon; Life and Career Skills; General Mathematics; General Science; Pag-aaral ng Kasaysayan at Lipunang Pilipino — confirm the strengthened SHS core set actually in force |
| 3–10 Science for 2027–2028 (each) | Obtain the applicable guide/order or verified carry-forward of the archived 2026 BOW; extract any changes and retain the old version |

Also outstanding: verify the 2026–2027 grade rollout against official orders,
verify the 2027–2028 rollout, official calendar orders for both years, official
individual time allotments if supplied, and cross-version competency mappings when
new guides arrive. Unloaded combinations use the PRD's own-objectives fallback;
fixture availability must never be counted as official coverage.

<!-- BEGIN GENERATED TITLE REVIEW -->
## Topic title review (data revision 2)

Short titles are UI labels only; competency text and source citations are unchanged.
Official labels are complete headings or a colon suffix of 1–4 words. Derived Science
labels use the explicit noun-phrase candidate table in `scripts/curriculum/topic_titles.py`:
choose the first phrase found in the competency, otherwise the domain fallback. All
fixture labels are derived and retain “Sample”. The table below lists **every** derived
label for human review; it is not a claim that these labels are DepEd wording.

Week ranges come from merged Week-column cells and are repeated for each competency
within that cell. Physical source pages for the week cells are recorded separately in
`science-provenance.json` → `sources[].weekCells`. Four cells span headings: G5 T3
Static Electricity/Circuits (1–2), Landforms/Weathering (3–5), G10 T1 Chemical
Reactions/Acids (1), and G10 T3 Electricity/Renewable Energy (10–11). These were
visually checked against the PDFs. Fixture weeks are unknown and remain omitted.

Payload sizes below measure compact pack-file JSON and gzip at default level 6.
PRD §14.1 limits compressed responses to 100 KiB; tests also enforce a 512 KiB raw
sanity ceiling. The existing pack `bytes` field remains the formatted JSON file size.
Every Science competency keeps its full document title, edition, page and URL.
The real-route tests gzip the exact HTTP response text with node:zlib defaults.

| Pack | Official titles | Derived titles | With week data | Raw JSON bytes | Gzip bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| science-bow-2026:10:science | 37 | 8 | 45 | 103897 | 5756 |
| science-bow-2026:3:science | 25 | 9 | 34 | 54127 | 3865 |
| science-bow-2026:4:science | 18 | 15 | 33 | 59793 | 4481 |
| science-bow-2026:5:science | 28 | 12 | 40 | 71135 | 4909 |
| science-bow-2026:6:science | 27 | 8 | 35 | 69573 | 4940 |
| science-bow-2026:7:science | 31 | 14 | 45 | 98747 | 5733 |
| science-bow-2026:8:science | 33 | 11 | 44 | 88744 | 5266 |
| science-bow-2026:9:science | 16 | 30 | 46 | 106152 | 6071 |
| fixture-demo-v1:2:mathematics | 0 | 12 | 0 | 6675 | 610 |
| fixture-demo-v1:3:mathematics | 0 | 12 | 0 | 6675 | 610 |
| fixture-demo-v1:4:mathematics | 0 | 12 | 0 | 6675 | 611 |
| fixture-demo-v1:5:mathematics | 0 | 12 | 0 | 6675 | 611 |

| Competency ID | Derived title | Source competency text |
| --- | --- | --- |
| science-bow-2026.science.g10.t1.3 | Chemical Reactions | Describe important types of chemical reactions (combination, decomposition, single replacement, double replacement). |
| science-bow-2026.science.g10.t1.4 | Chemical Reactions | Explain how important types of chemical reactions, such as combustion, acids on metals, acids on carbonates, photosynthesis, and respiration, relate to or impact the natural and built environments using information from secondary sources. |
| science-bow-2026.science.g10.t2.1 | Carrying Capacity | Discuss the factors that limit the ecosystem's carrying capacity, such as adequate food, shelter, water, and mates. |
| science-bow-2026.science.g10.t2.2 | Carrying Capacity | Explain that the ecosystem's population growth slows down as it gets closer to the carrying capacity. |
| science-bow-2026.science.g10.t3.16 | Electricity Generation and Distribution | Describe how high voltage electricity from power plants is generated and safely distributed to industries, businesses, and homes, including the role of substations (grid stations), and electric meters. |
| science-bow-2026.science.g10.t3.17 | Electricity Generation and Distribution | Describe and explain the need for safety precautions in handling household electrical devices. |
| science-bow-2026.science.g10.t3.18 | Electricity Generation and Distribution | Describe the similarities and differences between electric motors and electric generators. |
| science-bow-2026.science.g10.t3.19 | Electricity Generation and Distribution | Collaborate in a class discussion to identify ways to reduce the use of electrical energy in Filipino houses and communities and explain what local and global benefits can be achieved. |
| science-bow-2026.science.g3.t1.1 | Everyday Science | Identify objects, activities, or natural events observed in their local environment that can be explained by science. |
| science-bow-2026.science.g3.t1.2 | Everyday Science | Participate in guided science activities by asking questions and tinkering with materials. |
| science-bow-2026.science.g3.t1.3 | Everyday Science | Describe the uses of various science equipment and materials used in simple activities, such as a ruler, hand lens, scissors, balloons, modeling clay, and cardboard. |
| science-bow-2026.science.g3.t1.10 | Science Process Skills | Use the skills of observing, predicting, and measuring in performing simple guided science activities. |
| science-bow-2026.science.g3.t2.1 | Living and Non-Living Things | Observe and describe the difference between living and non-living things and give examples of each that can be found in the local environment. |
| science-bow-2026.science.g3.t2.2 | Living and Non-Living Things | Describe the characteristics of living things: they grow, respond, and reproduce. |
| science-bow-2026.science.g3.t2.5 | Basic Needs | Identify the basic needs of all living things, such as air, food, water, and shelter. |
| science-bow-2026.science.g3.t2.6 | Basic Needs | Observe examples and explain how living things depend on one another and on the environment to meet their basic needs. |
| science-bow-2026.science.g3.t2.7 | Basic Needs | Recognize that there is a need to protect and conserve the environment for living things to survive. |
| science-bow-2026.science.g4.t1.8 | Plant and Animal Systems | Describe in simple terms how the following human body systems work: muscular, skeletal, digestive, circulatory, and respiratory. |
| science-bow-2026.science.g4.t1.9 | Plant and Animal Systems | Observe the root and shoot system in plants and describe why they are important. |
| science-bow-2026.science.g4.t1.10 | Habitats | Use a drawing or diagram to classify some Philippine animals and plants, based on their habitat: some live on land (terrestrial), live in water (aquatic) or fly in the air (aerial). |
| science-bow-2026.science.g4.t1.11 | Habitats | Make a list or draw up a table with examples of animals and plants in a particular habitat, such as a garden, rice field, seashore, and mangrove swamp. |
| science-bow-2026.science.g4.t2.2 | Animal Diets | Use information from secondary sources to group animals according to the food they eat. Some are: a.  plant eaters (herbivores), b.  meat eaters (carnivores), and c.  plant and meat-eaters (omnivores) |
| science-bow-2026.science.g4.t2.4 | Movement | Participate in guided activities to discover and predict how rigid and soft objects can be moved and/or changed in shape. |
| science-bow-2026.science.g4.t2.5 | Forces | Determine how forces can change the shape of objects such as when they are pushed, pulled, stretched, bent, twisted, or squeezed. |
| science-bow-2026.science.g4.t2.6 | Movement | Measure accurately the distance and time when things move using simple equipment. |
| science-bow-2026.science.g4.t2.7 | Movement | Identify how far an object moves in a given time is called speed. |
| science-bow-2026.science.g4.t2.8 | Movement | Construct and label simple graphs of different speeds including stationary and uniform speeds, both fast and slow. |
| science-bow-2026.science.g4.t2.9 | Movement | Participate in guided activities to demonstrate that pushes and pulls can be used to change the speed and direction of an object including making it go faster, turn it to a different direction, slow it down, and stop it. |
| science-bow-2026.science.g4.t2.10 | Magnets | Carry out guided investigations to identify the properties of magnets, including how they affect other magnets and objects made of different materials. |
| science-bow-2026.science.g4.t2.11 | Magnets | Identify examples of how objects can affect other objects even when they are not in contact with each other, such as magnets attracting other objects, light from the sun affecting our eyes, and skin, and loud noises hurting our ears. |
| science-bow-2026.science.g4.t3.1 | Sound | Identify that energy is something that can cause change including light, sound, and heat energy. |
| science-bow-2026.science.g4.t3.2 | Sound | Observe and identify sources and uses of light, sound, and heat energy at school, at home and in the local community. |
| science-bow-2026.science.g5.t1.3 | States of Matter | Describe the properties of solids, liquids, and gases in terms of shape and volume: a.  solids: definite shape and volume b.  liquids: no definite shape; definite volume c.  gases: no definite shape or volume; |
| science-bow-2026.science.g5.t1.4 | States of Matter | Identify objects at home and in the classroom as solid, liquid or gas. |
| science-bow-2026.science.g5.t1.5 | States of Matter | Use measuring cylinders or beakers to measure volume using units, such as milliliters (mL), and liters (L). |
| science-bow-2026.science.g5.t1.6 | States of Matter | Describe how changes in temperature cause matter to change in state, such as solid to liquid to gas. |
| science-bow-2026.science.g5.t2.4 | Life Cycles | Identify which groups of animals reproduce by giving birth to live young, such as mammals, and which reproduce by laying eggs, such as birds and reptiles. |
| science-bow-2026.science.g5.t2.5 | Life Cycles | Use information from secondary sources to describe examples of how some animals have changed to better suit their environment, such as mimicry or camouflage. |
| science-bow-2026.science.g5.t2.6 | Life Cycles | Compare the life cycles of mammals from birth to adulthood, birds from egg to a mature organism, and plants from seed to a young plant, and then to a mature plant. |
| science-bow-2026.science.g5.t3.2 | Simple Circuits | Assemble and draw a simple circuit using batteries, wires, switch, and bulb and/or toy motor or buzzer. |
| science-bow-2026.science.g5.t3.3 | Simple Circuits | Design and construct a simple electrical circuit to identify what materials will conduct electricity and use it to identify materials from the environment that will and will not conduct electricity. |
| science-bow-2026.science.g5.t3.4 | Simple Circuits | Make a simple electromagnet and observe and record its properties. |
| science-bow-2026.science.g5.t3.10 | Water Cycle | Explain the role of the water cycle in the environment. |
| science-bow-2026.science.g5.t3.11 | Water Cycle | Construct a model to communicate some of the key processes in the water cycle. |
| science-bow-2026.science.g6.t1.1 | Changes of State | Describe changes of state for solids, liquids, and gases as melting, evaporation, freezing, condensation using diagrams and flowcharts. |
| science-bow-2026.science.g6.t1.2 | Heat Energy | Explain the role of heat energy in change of state processes. |
| science-bow-2026.science.g6.t2.2 | Living Things Interactions | Use information from secondary sources to describe that living things interact with each other in the natural environment, such as through competition, or predation. |
| science-bow-2026.science.g6.t2.3 | Biotic and Abiotic Factors | Describe living things, such as animals and plants, as biotic factors and light, water, temperature, and soil type, as abiotic factors of an ecosystem. |
| science-bow-2026.science.g6.t2.4 | Biotic and Abiotic Factors | Explain how interaction between living things and interactions between living and non-living things may bring good or harm to the living things involved. |
| science-bow-2026.science.g6.t2.8 | Water and Sound Waves | Identify that waves carry energy from a source to a receiver. |
| science-bow-2026.science.g6.t2.9 | Water and Sound Waves | Carry out investigations with water waves in a ripple tank, a big tub of water or improvised ripple tank and observe and describe the features of the waves including their: a.  shape, such as crests and troughs b.  size, such as width and height c.  patterns of movement, such as how they bend, or reflect off walls |
| science-bow-2026.science.g6.t2.10 | Amplitude | Research using secondary sources to identify how the properties of waves are described using scientific terms such as amplitude, frequency, wavelength, and velocity. |
| science-bow-2026.science.g7.t1.1 | Particle Model | Recognize that scientists use models to explain phenomena that cannot be easily seen or detected; |
| science-bow-2026.science.g7.t1.2 | Particle Model | Describe the Particle Model of Matter as “All matter is made up of tiny particles with each pure substance having its own kind of particles.” |
| science-bow-2026.science.g7.t1.3 | Particle Model | Describe that particles are constantly in motion, have spaces between them, attract each other, and move faster as the temperature increases (or with the addition of heat). |
| science-bow-2026.science.g7.t1.4 | Particle Model | Use diagrams and illustrations to describe the arrangement, spacing, and relative motion of the particles in each of the three states (phases) of matter. |
| science-bow-2026.science.g7.t1.5 | Changes of State | Explain the changes of state in terms of particle arrangement and energy changes: a.  solid → liquid → vapor b.  vapor → liquid → solid |
| science-bow-2026.science.g7.t1.6 | Scientific Investigations | Follow appropriate steps of a scientific investigation which includes: a.  Aim or problem b.  Materials and equipment c.  Method or procedures d.  Results including data e.  Conclusion. |
| science-bow-2026.science.g7.t1.7 | Scientific Investigations | Make accurate measurements using standard units for physical quantities and organize the collected data when carrying out a scientific investigation. |
| science-bow-2026.science.g7.t2.11 | Displacement | Explain the difference between distance and displacement in everyday situations in relation to a reference point. |
| science-bow-2026.science.g7.t2.12 | Velocity | Distinguish between speed and velocity using the concept of vectors. |
| science-bow-2026.science.g7.t2.13 | Velocity | Describe uniform velocity and represent it using distance-time graphs. |
| science-bow-2026.science.g7.t3.13 | Sun and Earth | Explain how energy from the Sun interacts with the atmosphere. |
| science-bow-2026.science.g7.t3.14 | Sun and Earth | Make a physical model or use drawings to demonstrate how the tilt of the Earth relative to its orbit around the Sun affects the intensity of sunlight absorbed by different areas of Earth over a year. |
| science-bow-2026.science.g7.t3.15 | Sun and Earth | Explain, using models, how the tilt of the Earth affects the changes in the length of daytime at different times of the year. |
| science-bow-2026.science.g7.t3.16 | Solar Energy | Explain how solar energy contributes to the occurrence of land and sea breezes, monsoons, and the Intertropical Convergence Zone (ITCZ). |
| science-bow-2026.science.g8.t1.8 | Cycles in Nature | Using flow charts and labeled diagrams explain the role of plants and animals in the cycles of nature, such as the carbon, oxygen, and water cycles. |
| science-bow-2026.science.g8.t1.9 | Photosynthesis | Describe the process of photosynthesis and respiration, and identify its raw materials needed and products. |
| science-bow-2026.science.g8.t1.10 | Photosynthesis | Using information from secondary sources identify the different parts of the cell where photosynthesis and respiration occur. |
| science-bow-2026.science.g8.t1.11 | Photosynthesis | Plan a scientific investigation to verify the raw materials needed for photosynthesis. |
| science-bow-2026.science.g8.t1.12 | Atomic Model | Develop a timeline for the historical background of the development of the current Atomic Model that identifies tiny particles as atoms. |
| science-bow-2026.science.g8.t1.13 | Atomic Model | Draw the structure of an atom in terms of the nucleus and electron shells. |
| science-bow-2026.science.g8.t3.7 | Acceleration | Identify that forces cause objects to accelerate, and that acceleration of an object is its rate of change of velocity. |
| science-bow-2026.science.g8.t3.8 | Motion Graphs | Observe and describe examples of accelerating objects at school and in the local community, including objects that show uniform circular motion. |
| science-bow-2026.science.g8.t3.9 | Acceleration | Construct and annotate distance-time graphs and velocity-time graphs to represent uniform and non-uniform acceleration. |
| science-bow-2026.science.g8.t3.10 | Kinetic Energy | Describe kinetic energy as the movement of objects or particles, and potential energy as energy stored due to the position of objects or particles. |
| science-bow-2026.science.g8.t3.11 | Kinetic Energy | Identify examples of everyday situations that demonstrate: a.  kinetic energy being transformed to potential energy a.  potential energy being transformed to kinetic energy |
| science-bow-2026.science.g9.t1.1 | Force | Identify inertia as the tendency for an object to stay at rest or in motion unless acted on by an unbalanced net force. |
| science-bow-2026.science.g9.t1.2 | Force | Demonstrate in practical situations and describe that acceleration is a change in speed and/or direction as the result of a net force. |
| science-bow-2026.science.g9.t1.3 | Force | Investigate the relationship among force, acceleration, and mass. |
| science-bow-2026.science.g9.t1.4 | Force | Explain that when any two objects interact, there are equal but opposite forces exerted between them, which is evident in many practical situations and applications. |
| science-bow-2026.science.g9.t1.5 | Force | Observe and identify action-reaction pairs in everyday situations such as stepping off a boat, or a book on a table, and draw force diagrams to explain how the pairs affect the motion of objects. |
| science-bow-2026.science.g9.t1.6 | Electrical Circuits | Identify that electricity is a flow of electrons and show appreciation for the need to observe safe measures in handling electricity. |
| science-bow-2026.science.g9.t1.7 | Electrical Circuits | Participate in guided investigations to infer the relationship among current, voltage, and resistance in assembled series and parallel circuits with varying number of loads and battery. |
| science-bow-2026.science.g9.t1.8 | Electrical Circuits | Draw diagrams of and assemble series and parallel circuits, showing switch, battery, loads/resistors, ammeter, and voltmeter. |
| science-bow-2026.science.g9.t1.9 | Electrical Circuits | Collaborate in a class discussion to recognize the advantages and limitations of using series or parallel circuits. |
| science-bow-2026.science.g9.t1.10 | Electrical Circuits | Describe electromagnetic radiation (EMR) as energy that is created by the vibrations of electrically charged particles which allows it to travel through materials or space as transverse waves. |
| science-bow-2026.science.g9.t1.11 | Electromagnetic Waves | Compare the relative wavelengths and frequencies of different types of electromagnetic waves, including radio waves, microwaves, infrared, visible light, ultra-violet, x-rays, and gamma radiation. |
| science-bow-2026.science.g9.t1.12 | Electrical Circuits | Identify practical applications of electromagnetic radiation, such as radio waves used in telecommunications, and x-rays and gamma rays in medicine. |
| science-bow-2026.science.g9.t1.13 | Electrical Circuits | Gather information from secondary sources to explain the harmful effects that EMR can have on living things. |
| science-bow-2026.science.g9.t2.1 | Structure of the Earth | Describe how fossils can be used for dating the age of rocks and sediments. |
| science-bow-2026.science.g9.t2.2 | Geologic Time | Describe how relative and absolute dating techniques are used to determine the subdivisions of geologic time. |
| science-bow-2026.science.g9.t2.3 | Geologic Time | Explain how the geologic time scale helps to recount the history of the Earth. |
| science-bow-2026.science.g9.t2.4 | Structure of the Earth | Describe how seismic wave data has been used to develop a model for the internal structure and composition of the Earth. |
| science-bow-2026.science.g9.t2.5 | Structure of the Earth | Create a scale drawing to represent relative thicknesses of the layers of Earth's interior, including the crust, lithosphere, asthenosphere, mantle, outer core, and inner core. |
| science-bow-2026.science.g9.t2.6 | Solar System Origin | Distinguish among comets, meteoroids, asteroids, and dwarf planets, and describe how they help us to understand the nature and formation of the Earth and the Solar System. |
| science-bow-2026.science.g9.t2.7 | Solar System Origin | Gather information from secondary sources to discuss the regular occurrence of meteor showers. |
| science-bow-2026.science.g9.t2.13 | Philippine Ecosystems | Describe using labeled diagrams the biotic and abiotic features of tropical rainforests, swamps, estuaries, mangrove forests, and coral reefs. |
| science-bow-2026.science.g9.t2.14 | Philippine Ecosystems | Use information from secondary sources to describe the possible effects of human activities, such as deforestation, pollution, and introduction of invasive species, on living things in an ecosystem. |
| science-bow-2026.science.g9.t2.15 | Philippine Ecosystems | Plan to conduct a survey to explore the possibilities for minimizing the negative impacts of human activities on an ecosystem. |
| science-bow-2026.science.g9.t3.8 | Covalent Compounds | Identify the number of valence electrons of oxygen based on its position in the periodic table. |
| science-bow-2026.science.g9.t3.9 | Covalent Compounds | Explain the formation of ions as either the loss or gain of electrons to produce ionic bonds, using examples, such as the formation of sodium chloride. |
| science-bow-2026.science.g9.t3.10 | Ionic Compounds | Write the chemical formula and chemical names of some common ionic compounds, including sodium chloride (NaCl), magnesium oxide (MgO), potassium chloride (KCl) and magnesium chloride (MgCl2). |
| science-bow-2026.science.g9.t3.11 | Covalent Compounds | Explain the formation of covalent bonds using a molecule of water and a molecule of carbon dioxide. |
| science-bow-2026.science.g9.t3.12 | Covalent Compounds | Write the chemical formula and chemical name of some common covalent compounds, including water (H2O), carbon dioxide (CO2), and ammonia (NH3). |
| science-bow-2026.science.g9.t3.13 | Ionic Compounds | show by using models that ionic compounds form crystalline structures whereas covalent compounds form individual molecules. |
| science-bow-2026.science.g9.t3.15 | Chemical Bonding | Investigate the properties of ionic, covalent, and metallic substances, such as melting point, hardness, electrical and thermal conductivity. |
| fixture-demo-v1.mathematics.g2.t1.1 | Sample objects | SAMPLE DATA ONLY — Grade 2: describe and compare a small collection of objects. |
| fixture-demo-v1.mathematics.g2.t1.2 | Sample living things | SAMPLE DATA ONLY — Grade 2: describe and compare a small collection of living things. |
| fixture-demo-v1.mathematics.g2.t1.3 | Sample movement | SAMPLE DATA ONLY — Grade 2: describe and compare a small collection of movement. |
| fixture-demo-v1.mathematics.g2.t1.4 | Sample our surroundings | SAMPLE DATA ONLY — Grade 2: describe and compare a small collection of our surroundings. |
| fixture-demo-v1.mathematics.g2.t2.1 | Sample objects | SAMPLE DATA ONLY — Grade 2: describe and compare a small collection of objects. |
| fixture-demo-v1.mathematics.g2.t2.2 | Sample living things | SAMPLE DATA ONLY — Grade 2: describe and compare a small collection of living things. |
| fixture-demo-v1.mathematics.g2.t2.3 | Sample movement | SAMPLE DATA ONLY — Grade 2: describe and compare a small collection of movement. |
| fixture-demo-v1.mathematics.g2.t2.4 | Sample our surroundings | SAMPLE DATA ONLY — Grade 2: describe and compare a small collection of our surroundings. |
| fixture-demo-v1.mathematics.g2.t3.1 | Sample objects | SAMPLE DATA ONLY — Grade 2: describe and compare a small collection of objects. |
| fixture-demo-v1.mathematics.g2.t3.2 | Sample living things | SAMPLE DATA ONLY — Grade 2: describe and compare a small collection of living things. |
| fixture-demo-v1.mathematics.g2.t3.3 | Sample movement | SAMPLE DATA ONLY — Grade 2: describe and compare a small collection of movement. |
| fixture-demo-v1.mathematics.g2.t3.4 | Sample our surroundings | SAMPLE DATA ONLY — Grade 2: describe and compare a small collection of our surroundings. |
| fixture-demo-v1.mathematics.g3.t1.1 | Sample objects | SAMPLE DATA ONLY — Grade 3: describe and compare a small collection of objects. |
| fixture-demo-v1.mathematics.g3.t1.2 | Sample living things | SAMPLE DATA ONLY — Grade 3: describe and compare a small collection of living things. |
| fixture-demo-v1.mathematics.g3.t1.3 | Sample movement | SAMPLE DATA ONLY — Grade 3: describe and compare a small collection of movement. |
| fixture-demo-v1.mathematics.g3.t1.4 | Sample our surroundings | SAMPLE DATA ONLY — Grade 3: describe and compare a small collection of our surroundings. |
| fixture-demo-v1.mathematics.g3.t2.1 | Sample objects | SAMPLE DATA ONLY — Grade 3: describe and compare a small collection of objects. |
| fixture-demo-v1.mathematics.g3.t2.2 | Sample living things | SAMPLE DATA ONLY — Grade 3: describe and compare a small collection of living things. |
| fixture-demo-v1.mathematics.g3.t2.3 | Sample movement | SAMPLE DATA ONLY — Grade 3: describe and compare a small collection of movement. |
| fixture-demo-v1.mathematics.g3.t2.4 | Sample our surroundings | SAMPLE DATA ONLY — Grade 3: describe and compare a small collection of our surroundings. |
| fixture-demo-v1.mathematics.g3.t3.1 | Sample objects | SAMPLE DATA ONLY — Grade 3: describe and compare a small collection of objects. |
| fixture-demo-v1.mathematics.g3.t3.2 | Sample living things | SAMPLE DATA ONLY — Grade 3: describe and compare a small collection of living things. |
| fixture-demo-v1.mathematics.g3.t3.3 | Sample movement | SAMPLE DATA ONLY — Grade 3: describe and compare a small collection of movement. |
| fixture-demo-v1.mathematics.g3.t3.4 | Sample our surroundings | SAMPLE DATA ONLY — Grade 3: describe and compare a small collection of our surroundings. |
| fixture-demo-v1.mathematics.g4.t1.1 | Sample objects | SAMPLE DATA ONLY — Grade 4: describe and compare a small collection of objects. |
| fixture-demo-v1.mathematics.g4.t1.2 | Sample living things | SAMPLE DATA ONLY — Grade 4: describe and compare a small collection of living things. |
| fixture-demo-v1.mathematics.g4.t1.3 | Sample movement | SAMPLE DATA ONLY — Grade 4: describe and compare a small collection of movement. |
| fixture-demo-v1.mathematics.g4.t1.4 | Sample our surroundings | SAMPLE DATA ONLY — Grade 4: describe and compare a small collection of our surroundings. |
| fixture-demo-v1.mathematics.g4.t2.1 | Sample objects | SAMPLE DATA ONLY — Grade 4: describe and compare a small collection of objects. |
| fixture-demo-v1.mathematics.g4.t2.2 | Sample living things | SAMPLE DATA ONLY — Grade 4: describe and compare a small collection of living things. |
| fixture-demo-v1.mathematics.g4.t2.3 | Sample movement | SAMPLE DATA ONLY — Grade 4: describe and compare a small collection of movement. |
| fixture-demo-v1.mathematics.g4.t2.4 | Sample our surroundings | SAMPLE DATA ONLY — Grade 4: describe and compare a small collection of our surroundings. |
| fixture-demo-v1.mathematics.g4.t3.1 | Sample objects | SAMPLE DATA ONLY — Grade 4: describe and compare a small collection of objects. |
| fixture-demo-v1.mathematics.g4.t3.2 | Sample living things | SAMPLE DATA ONLY — Grade 4: describe and compare a small collection of living things. |
| fixture-demo-v1.mathematics.g4.t3.3 | Sample movement | SAMPLE DATA ONLY — Grade 4: describe and compare a small collection of movement. |
| fixture-demo-v1.mathematics.g4.t3.4 | Sample our surroundings | SAMPLE DATA ONLY — Grade 4: describe and compare a small collection of our surroundings. |
| fixture-demo-v1.mathematics.g5.t1.1 | Sample objects | SAMPLE DATA ONLY — Grade 5: describe and compare a small collection of objects. |
| fixture-demo-v1.mathematics.g5.t1.2 | Sample living things | SAMPLE DATA ONLY — Grade 5: describe and compare a small collection of living things. |
| fixture-demo-v1.mathematics.g5.t1.3 | Sample movement | SAMPLE DATA ONLY — Grade 5: describe and compare a small collection of movement. |
| fixture-demo-v1.mathematics.g5.t1.4 | Sample our surroundings | SAMPLE DATA ONLY — Grade 5: describe and compare a small collection of our surroundings. |
| fixture-demo-v1.mathematics.g5.t2.1 | Sample objects | SAMPLE DATA ONLY — Grade 5: describe and compare a small collection of objects. |
| fixture-demo-v1.mathematics.g5.t2.2 | Sample living things | SAMPLE DATA ONLY — Grade 5: describe and compare a small collection of living things. |
| fixture-demo-v1.mathematics.g5.t2.3 | Sample movement | SAMPLE DATA ONLY — Grade 5: describe and compare a small collection of movement. |
| fixture-demo-v1.mathematics.g5.t2.4 | Sample our surroundings | SAMPLE DATA ONLY — Grade 5: describe and compare a small collection of our surroundings. |
| fixture-demo-v1.mathematics.g5.t3.1 | Sample objects | SAMPLE DATA ONLY — Grade 5: describe and compare a small collection of objects. |
| fixture-demo-v1.mathematics.g5.t3.2 | Sample living things | SAMPLE DATA ONLY — Grade 5: describe and compare a small collection of living things. |
| fixture-demo-v1.mathematics.g5.t3.3 | Sample movement | SAMPLE DATA ONLY — Grade 5: describe and compare a small collection of movement. |
| fixture-demo-v1.mathematics.g5.t3.4 | Sample our surroundings | SAMPLE DATA ONLY — Grade 5: describe and compare a small collection of our surroundings. |
<!-- END GENERATED TITLE REVIEW -->
