# Grade 8 curriculum audit and implementation

Completed on unified, 2026-09-09. This is the requested Grade 8 reporting checkpoint; Grade 9 remains unaudited. No APK was rebuilt, installed or published for this change.

## Improvements

| Area | Before | After |
|---|---|---|
| Calendar | 19 broad topic pools | 44 bounded lessons in curriculum order |
| Coverage | Broad competency labels | All 44 competencies represented through 133 teaching/quiz objectives |
| Categories | 47 Grade 8 labels | Every label mapped as direct, supporting or enrichment |
| Quarter handling | Supplemental cards assumed matter/life/physics/Earth order | Quarter derived from actual curriculum codes |
| Content gaps | Practical examples and assessment missing | 18 trilingual teaching/activity cards and 32 questions |
| Existing content | Precise lithosphere explanation lacked assignment | One reviewed tag repair |
| Quality | Sampled misleading claims remained in lesson pools | 25 scoped exclusions and tighter core filters |
| Build safeguards | Coverage could pass while Calendar hid a tiny lesson | Compiler requires at least three distinct facts per lesson and correct quarters |

Grade 8 follows **Q1 Life Science (11 lessons), Q2 Matter (10), Q3 Earth Science (12), Q4 Force/Motion/Energy (11)**. Runtime weighting now reads the shared curriculum outline; the compiler reads each competency’s quarter from the verified guide and rejects incorrectly placed lessons. This also removes the domain-order assumption that would otherwise complicate Grades 9–10.

## Seven work areas completed

1. **Curriculum crosswalk:** all Grade 8 labels have explicit roles. Electrical circuits/safety, charging-related electrical quantities, comets/meteors/asteroids and phase-change shelves are enrichment here. Supporting earthquake and ecological labels still require an actual competency match before entering a required lesson.
2. **Bounded sequence:** authored 20/30-card targets retain quiz-bearing core anchors and rotating additional examples. Smaller pools finish naturally. Valid saved lesson runs, lifetime history and legacy Calendar-key migration are retained.
3. **Recover suitable existing content:** `ffct-35681` correctly defines the lithosphere as crust plus rigid uppermost mantle divided into plates; it is restored to G8-E-6. Prior decisions and source text are recorded in `grade8-tag-corrections.json`.
4. **Teaching additions:** digestive route and interconnected body-system diagrams; hypothetical single-gene inheritance ratios; carbon/oxygen/water cycle arrows; cell-process reference reading; atomic-model timeline through the quantum model; aluminum-27 shell diagram and particle calculation; crust/plate comparisons; volcanic settings; global plate patterns; typhoon-source reading and terrain effects; two worked motion-graph examples; supervised light-ray tracing; Philippine hydropower and tidal-energy source activities; and a supervised photosynthesis investigation plan.
5. **Assessment additions:** 32 questions cover the 18 new cards plus 14 existing facts on human classification, subatomic symbols, helium, table groups, storm coordinates, dated disaster reports, acceleration, mechanical energy, taxonomic systems and experimental controls/results. English, Tagalog and Cebuano content works offline. Quiz option shuffling, existing single/checkpoint/closing reviews and encouraging recaps are preserved.
6. **Semantic quality:** source-reading slots require actual references—“does” no longer matches “DOE.” Seven valence electrons no longer satisfies the table’s period/group count. Bohr alone does not satisfy the current atomic-model objective. Helium’s exception is explicitly covered. Spring tides are distinguished from storm waves; mountain terrain is not a safety guarantee. Worked motion data distinguish uniform acceleration from uniform velocity and positive acceleration from increasing speed. Practical chemistry additions assign chemicals and heating to the teacher.
7. **Runtime verification and richness:** the full Calendar/feed test exposed a motion lesson hidden by the existing minimum of three cards. A substantive third card now makes the lesson visible, and the compiler blocks similar underfilled audited lessons. Runtime quarter weighting, complete lesson walks, persistence and eventual reserve access are tested.

New diagrams are text instructions for drawing or constructing models; no new illustration assets were generated. The existing Calendar minimum remains unchanged.

## Content richness and projected time

**1,262 unique core facts** expand to **1,691 unique reachable facts**, preserving **429 facts beyond narrow core filters**. The old chronological pool held 1,697 facts; the net change is six fewer after new content, one recovered assignment and scoped exclusions. The main improvement is more coherent access, not inflated inventory.

| Visits to every lesson | Simulated unique facts viewed |
|---|---:|
| 1 | 912 |
| 3 | 1,514 |
| 5 | 1,657 |
| 10 | 1,691 |
| 20 | 1,691 |

A first pass presents **930 cards containing 912 distinct facts**. At 20 seconds per card, this is **5 hours 10 minutes**, excluding quizzes, recaps and practical activities. A separate exhaustive revisit test confirms every eligible fact is reachable. These are simulations, not measured engagement or mastery.

## Remaining depth limitations

Eleven pools end before the authored target rather than padding with repeated facts:

| Lesson | Available card entries | Target |
|---|---:|---:|
| Trace Food’s Journey | 16 | 30 |
| Trace Nature’s Cycles | 29 | 30 |
| Where Cell Processes Happen | 19 | 20 |
| How Atomic Models Changed | 25 | 30 |
| Compare Subatomic Particles | 19 | 30 |
| Count Protons, Neutrons, Electrons | 22 | 30 |
| Compare Volcano Types | 15 | 30 |
| Map Earth’s Active Belts | 14 | 30 |
| Land, Sea, and Typhoon Strength | 19 | 20 |
| Draw Motion Graphs | 3 | 30 |
| Follow Energy in a Fall | 19 | 20 |

**Draw Motion Graphs is the highest-priority depth gap: three cards.** All its required objectives have teaching/quiz candidates, but more worked data sets and questions would improve practice substantially. Global plate patterns, volcano classification and digestion also need more examples. Several source-reading/practical objectives have only one quiz anchor.

An attached question does not assess every skill mentioned on a teaching card. The app does not verify that a child drew a graph, conducted an experiment, or understood every inference. This audit is targeted curriculum and sample-quality work; it is not exhaustive editorial approval of every translation, fact or illustration.

The 25 exclusions apply to both required and additional Grade 8 lesson pools. Wider random/discovery content remains unchanged; `grade8-scoped-exclusions.json` records individual reasons.

## Verification

- **57 targeted tests pass**, including Grades 3–8, all visible Calendar entries, complete feed walks, restore after each card, eventual reserve access, source-fact deduplication, quiz/profile isolation, remediation and quiz/recap cadence.
- The added quarter-order test exercises actual feed weights for every Grade 8 supplemental card, not just metadata.
- Mobile TypeScript passes. Previously audited grades have unchanged manifests and repeat-visit measurements.
- Grade 8 has zero reported missing teaching/quiz slots. The compiler validates quarter membership and a minimum of three distinct facts for every audited lesson.
- The future APK build guard includes Grade 8.

Reproduce with `pnpm --filter @hiraia/mobile qa:grade8`, `python3 rag/pipeline/compile-lessons.py --grade 8 --check`, and `pnpm --filter @hiraia/mobile qa:content-reach`.

## Evidence and limits

Curriculum baseline: the app’s verified **August 2023 MATATAG Science Grades 3–10 junior-high extract**, `rag/sources/curriculum-guides/matatag-jhs-competencies.json`. Alignment with later revisions is not certified. Teacher and language review remains appropriate for the new practical instructions.

[PAGASA’s cyclone explanation](https://www.pagasa.dost.gov.ph/information/about-tropical-cyclone) and [PAR explanation](https://www.pagasa.dost.gov.ph/learning-tools/philippine-area-of-responsibility) support source-based cyclone lessons. No live forecast, wind-signal threshold or guaranteed safe region is embedded in the new content.

[OpenStax’s atomic-structure chapter](https://openstax.org/books/physics/pages/22-1-the-structure-of-the-atom) and [quantum-theory discussion](https://openstax.org/books/chemistry-2e/pages/6-3-development-of-quantum-theory) support distinguishing a useful shell model from exact electron paths and extending the historical timeline past Bohr.

[DOE’s ocean-energy teaching reference](https://www.energy.gov/sites/prod/files/2014/06/f16/lesson300.pdf) supports distinguishing tidal range/barrage mechanisms from tidal-current resources. The source-reading task also asks students to consider environmental and community effects rather than treating renewable generation as impact-free.

Review artifacts: `rag/pipeline/grade8-lessons.authoring.json`, `docs/grade8-subcategory-crosswalk.json`, `docs/grade8-tag-corrections.json`, `docs/grade8-scoped-exclusions.json`, `docs/grade8-lesson-coverage.json`, and `docs/content-reach.json`.
