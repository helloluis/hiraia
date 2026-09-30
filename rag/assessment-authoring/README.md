# Hiraia assessment authoring

**638 trilingual material-level drafts across Grades 3–10, plus 72 separate incoming-Grade-3 foundation drafts (710 total).** See the [dedicated foundation pool](foundation/README.md) for the new entry route. Read the [authoring handover](authoring-summary.md) for scope, counts, holds, coverage and validation. The selected-blueprint drafting pass is complete; language/classroom approval and production enablement are not.

Material-level question records live in `batches/*.json`; the separate entry pool lives in `foundation/living-materials.json` and `foundation/movement-surroundings.json`. Adjacent Markdown supports review. The material-level records adapt the newer merged `quiz-bank-v2.jsonl`; foundations retain their own explicit curriculum, factual and teaching-card provenance. They do not replace ordinary feed mini-quizzes.

[Question design contract](../../docs/ASSESSMENT-QUESTION-DESIGN-PLAN-20260928.md) · [Current integration status](STATUS.md) · [Targets](targets.md) · [Full-form simulations](form-simulation.md) · [Actual lesson coverage](exposure-link-audit.md)

| Batch | Grade | Items | Readable questions |
|---|---:|---:|---|
| 001 | 3 | 12 | [Grade 3 foundations: first twelve-item design batch](batches/001-grade3-foundations.md) |
| 002 | 3 | 20 | [Grade 3 materials: handling, reuse and metal properties](batches/002-grade3-materials.md) |
| 003 | 4 | 20 | [Grade 4 animal diets, feeding links and body functions](batches/003-grade4-living-things.md) |
| 004 | 3 | 20 | [Grade 3 movement, sound, light, earth materials and sky](batches/004-grade3-motion-light-sky.md) |
| 005 | 3 | 20 | [Grade 3 life processes, body parts and basic needs](batches/005-grade3-living-things.md) |
| 006 | 4 | 20 | [Grade 4 measurement, motion, magnets and energy](batches/006-grade4-motion-magnets-energy.md) |
| 007 | 4 | 20 | [Grade 4 soil, weather instruments and the Sun](batches/007-grade4-soil-weather-sun.md) |
| 008 | 3 | 4 | [Grade 3 reuse and sound: targeted rotation gaps](batches/008-grade3-rotation-gaps.md) |
| 009 | 4 | 20 | [Grade 4 material changes, inventions and investigation knowledge](batches/009-grade4-materials-and-investigation.md) |
| 010 | 5 | 20 | [Grade 5 matter, measurement and state changes](batches/010-grade5-matter-measurement.md) |
| 011 | 5 | 20 | [Grade 5 body systems, classification and adaptations](batches/011-grade5-living-things.md) |
| 012 | 5 | 20 | [Grade 5 forces, friction, gravity and circuits](batches/012-grade5-forces-and-circuits.md) |
| 013 | 5 | 20 | [Grade 5 land, rocks, water, weather and space](batches/013-grade5-earth-and-space.md) |
| 014 | 6 | 20 | [Grade 6: phase changes, mixtures, separation and fair-test knowledge](batches/014-grade6-matter-mixtures-investigation.md) |
| 015 | 6 | 20 | [Grade 6: circulation, plant propagation, classification and food-web roles](batches/015-grade6-living-things.md) |
| 016 | 6 | 20 | [Grade 6: simple-machine roles and wave properties](batches/016-grade6-machines-and-waves.md) |
| 017 | 6 | 22 | [Grade 6: volcanic materials, monitoring, seasons and sky patterns](batches/017-grade6-earth-and-space.md) |
| 018 | 7 | 20 | [Grade 7: particle models, solutions and investigation knowledge](batches/018-grade7-matter-and-investigation.md) |
| 019 | 7 | 20 | [Grade 7: microscope knowledge, cells, reproduction and biological organization](batches/019-grade7-cells-and-life-organization.md) |
| 020 | 7 | 20 | [Grade 7: forces, motion quantities, graph conventions and heat](batches/020-grade7-motion-and-heat.md) |
| 021 | 7 | 20 | [Grade 7: faults, earthquake effects, tsunami knowledge and atmospheric patterns](batches/021-grade7-earthquakes-and-weather.md) |
| 022 | 8 | 20 | [Grade 8: historical atomic models, particle properties and periodic-table knowledge](batches/022-grade8-atoms-and-periodic-table.md) |
| 023 | 8 | 20 | [Grade 8: digestive and plant systems, inheritance, classification and metabolic knowledge](batches/023-grade8-systems-and-inheritance.md) |
| 024 | 8 | 20 | [Grade 8: acceleration, work, energy transfer and light](batches/024-grade8-motion-energy-and-light.md) |
| 025 | 8 | 20 | [Grade 8: crust, volcanoes, tropical cyclones and tides](batches/025-grade8-earth-oceans-and-storms.md) |
| 026 | 9 | 20 | [Grade 9: chemical changes, bonding and compound formulas](batches/026-grade9-bonding-and-compounds.md) |
| 027 | 9 | 20 | [Grade 9: DNA, mutations, biodiversity and conservation](batches/027-grade9-genetics-and-biodiversity.md) |
| 028 | 9 | 20 | [Grade 9: Newton’s laws, circuits and electromagnetic applications](batches/028-grade9-forces-circuits-and-radiation.md) |
| 029 | 9 | 20 | [Grade 9: plate motion, geological time, Earth’s interior and space exploration](batches/029-grade9-earth-history-and-space.md) |
| 030 | 10 | 20 | [Grade 10: chemical reactions, equations, rates and heat](batches/030-grade10-reactions-and-rates.md) |
| 031 | 10 | 20 | [Grade 10: homeostasis, evolutionary evidence, biotechnology and population limits](batches/031-grade10-homeostasis-evolution-and-biotechnology.md) |
| 032 | 10 | 20 | [Grade 10: projectile motion, collisions, impulse and electric power](batches/032-grade10-momentum-and-electricity.md) |
| 033 | 10 | 20 | [Grade 10: plates, climate evidence and renewable energy](batches/033-grade10-plates-climate-and-energy.md) |

Five holds remain excluded; all native-speaker, teacher and student-pilot reviews are unperformed. The local evaluation APK is a separate, explicitly enabled preview. No public release authorization is implied.

Authoring scripts attach source snapshots, render review records and check structural/selection invariants. They do not generate questions or call a hosted model. Requested authorship model: Astra; the runtime model identifier was not independently recorded.
