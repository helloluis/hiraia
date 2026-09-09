# Grade 7 curriculum audit and implementation

Completed on unified, 2026-09-09. This is the requested Grade 7 reporting checkpoint; Grade 8 remains unaudited. No APK was rebuilt, installed or published for this change.

## Improvements

| Area | Before | After |
|---|---|---|
| Calendar | 16 broad topics with topic-exhaustion sequencing | 45 focused lessons in curriculum order |
| Coverage | Broad competency tags | All 45 competencies represented by 142 teaching/quiz objectives |
| Categories | 46 Grade 7 labels | All 46 mapped as direct, supporting or enrichment |
| Lesson length | Exhaust each topic inventory | 20/30-card targets; short pools end naturally |
| Existing content | Missing precise assignments | Eight reviewed assignment repairs |
| Gaps | Practical teaching and assessment gaps | 16 trilingual teaching/activity cards and 39 questions |
| Semantic quality | Word coincidences and misleading sampled claims | Tighter objective patterns and 15 scoped exclusions |
| Continuity | Broad-topic saved keys | Profile/grade-specific lesson runs, restoration and legacy-key migration |

There are 12 matter lessons, 10 living-things lessons, 11 force/motion/energy lessons, and 12 Earth/space lessons. The compiler now selects the verified junior-high curriculum extract for Grade 7; previously it only read the elementary extract. Other junior-high grades are not enabled by this change.

## Seven work areas completed

1. **Curriculum mapping.** Every existing Grade 7 subcategory has an explicit role. Charging, general sound/waves and natural-resource shelves are enrichment. Supporting labels such as atmospheric layers, light and ecosystem components do not by themselves establish required competency coverage. Stable lesson/objective IDs make future review batchable.
2. **Coherent bounded runs.** Core quiz-bearing objectives are included before optional examples. The existing planner rotates through additional shelves, prefers unseen facts, deduplicates source facts and preserves valid saved runs. Learners can revisit without having exhausted every large pool on the first visit.
3. **Recover existing facts.** Measurement-table facts, ITCZ explanations, an aquatic energy pyramid, normal/reverse fault explanations and a physical fault model now have precise missing assignments. Numbered existing assignments are preserved. Prior decisions are recorded in `grade7-tag-corrections.json`.
4. **Fill genuine teaching gaps.** New cards teach particle diagrams; accurate measurement tables; solubility versus dissolving speed; limits of litmus; safe microscope handling; observation versus reference knowledge; a cells-to-biosphere diagram; a trophic pyramid; researching thermoelectric devices; an earthquake cross-section; tsunami natural warnings; solvent-versus-solution concentration calculations; uniform-motion graph interpretation; official local fault maps; particle arrangement during phase changes; and balanced/unbalanced force diagrams.
5. **Fill assessment gaps.** The 39 new questions include the 16 new teaching cards and 23 existing cards. They cover investigation steps, pure substances, scientific model limitations, microscope storage, biological organization, energy transfer, forces, fault types, sunlight models and ITCZ. All new content is available offline in English, Tagalog and Cebuano.
6. **Correct semantic traps.** “Coverslip” no longer counts as storage. Generic rock “blocks” no longer establish a model-making activity. An official warning system is not mistaken for natural tsunami signs. Source-reading objectives require a reference article rather than any use of “source.” Calculation requires worked arithmetic. Required caveat cards explain that a distance–time graph alone does not establish direction, litmus cannot identify every salt, and some organelles are hard to distinguish in classroom preparations. Particle arrangement and balanced versus unbalanced force objectives are explicitly separated.
7. **Validate continuity and richness.** Runtime registration, grade-scoped persistence, build-time manifest validation, Calendar and feed tests, and content-reach reporting now include Grade 7. Grade 3–6 manifests and repeat-visit measurements remain unchanged.

The new diagrams are instructions for drawing or making a model; no new illustrations were generated. Existing single quizzes, checkpoint series, shuffled choices, closing reviews and encouraging recaps are retained.

## Content richness

**1,155 unique core facts** expand to **1,616 unique facts** with additional pools, preserving **461 facts beyond the narrow core filters**. The old chronological Grade 7 inventory contained 1,611 distinct facts. The net increase is five after additions, assignment recovery and scoped exclusions. The compiler lists 1,620 card candidates because multiple renderings can share a source fact; runtime counts deduplicate those facts.

| Visits to every lesson | Simulated unique facts viewed |
|---|---:|
| 1 | 994 |
| 3 | 1,467 |
| 5 | 1,577 |
| 10 | 1,616 |
| 20 | 1,616 |

The first pass presents **1,016 cards covering 994 distinct facts**. At 20 seconds per presentation, this is **5 hours 38 minutes 40 seconds**, excluding quizzes, recaps and practical activities. A separate exhaustive revisit test confirms every eligible reserve fact is reachable. These figures are simulations, not engagement measurements or estimates of mastery.

## Remaining depth limitations

Ten pools end before their authored targets rather than padding with repeated cards:

| Lesson | Available card entries | Target |
|---|---:|---:|
| Draw Three States of Matter | 23 | 30 |
| Measure and Organize Data | 6 | 30 |
| How Much Solute? | 26 | 30 |
| Meet the Compound Microscope | 26 | 30 |
| Compare Plant and Animal Cells | 22 | 30 |
| From Cells to the Biosphere | 24 | 30 |
| Heat Is Not Temperature | 16 | 20 |
| Classify Faults | 19 | 30 |
| Model Fault Movement | 24 | 30 |
| Model an Earthquake | 22 | 30 |

The most sparse pool is **Measure and Organize Data**, with six entries. Several practical/source-reading slots also have only one quiz anchor. These are priorities for additional examples and question variants. Attached quizzes do not necessarily assess every subskill described by a card, and the app cannot verify that a learner actually completed a microscope exercise, investigation or physical model.

The 15 scoped exclusions and their reasons are in `grade7-scoped-exclusions.json`. They apply to both core and additional Grade 7 lesson pools; the wider random/discovery bank was not rewritten. This is targeted curriculum and sample-quality work, not a complete editorial certification of every fact, translation or image.

## Verification

- **52 targeted tests pass**, including all audited grades, real-feed complete walks, restoration after every card, eventual reserve access, fact deduplication, every visible Calendar entry, quiz/profile persistence, remediation, and quiz/recap cadence.
- Mobile TypeScript passes.
- Grade 7 has zero missing teaching/quiz slots in the compiler report. Grades 3–6 manifest checks and content-reach simulations are unchanged.
- Future APK builds now check Grade 7's authored manifest.

Reproduce with `pnpm --filter @hiraia/mobile qa:grade7`, `python3 rag/pipeline/compile-lessons.py --grade 7 --check`, and `pnpm --filter @hiraia/mobile qa:content-reach`.

## References and limits

Curriculum baseline: the app's verified **August 2023 MATATAG Science Grades 3–10 junior-high extract**, `rag/sources/curriculum-guides/matatag-jhs-competencies.json`. This does not certify alignment with subsequent curriculum revisions. Teacher and language review is still appropriate for new practical instructions.

- [PHIVOLCS tsunami information](https://www.phivolcs.dost.gov.ph/introduction-to-tsunami/) and [NOAA tsunami alerts](https://www.weather.gov/safety/tsunami-alerts) support distinguishing natural from official warnings. The new card does not make waiting for an official alert a prerequisite to evacuating after natural warning signs.
- [PHIVOLCS GeoHazards](https://gisweb.phivolcs.dost.gov.ph/) provides official fault information. The new activity offers official printed maps and HazardHunterPH as alternatives; it does not depend on live FaultFinder availability or treat distance alone as a safety certificate.
- [USGS earthquake effects](https://www.usgs.gov/programs/earthquake-hazards/what-are-effects-earthquakes) and [magnitude/intensity explanation](https://pubs.usgs.gov/gip/earthq3/magnitude.html) support accounting for local conditions instead of treating magnitude as a fixed damage prediction.
- [DOE's thermoelectric research explanation](https://www.energy.gov/science/bes/articles/generating-light-darkness) supports the temperature-difference example in the secondary-source activity.
- [Nikon's cell-observation methods](https://www.healthcare.nikon.com/en/ss/cell-image-lab/knowledge/observation-method.html) document the importance of preparation and contrast. The classroom card asks learners to distinguish observed structures from reference knowledge instead of claiming all organelles will be clearly visible.

Review artifacts: `rag/pipeline/grade7-lessons.authoring.json`, `docs/grade7-subcategory-crosswalk.json`, `docs/grade7-tag-corrections.json`, `docs/grade7-scoped-exclusions.json`, `docs/grade7-lesson-coverage.json`, and `docs/content-reach.json`.
