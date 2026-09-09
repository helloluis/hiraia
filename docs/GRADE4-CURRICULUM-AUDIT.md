# Grade 4 curriculum audit and implementation

Completed on unified, 2026-09-09. This is the requested Grade 4 reporting checkpoint. Grades 3 and 5 are already implemented; Grade 6 is the next unaudited grade. No APK was rebuilt, installed or published for this change.

## Improvements

| Area | Before | After |
|---|---|---|
| Calendar sequencing | 15 broad topics, exhausting their inventories | 33 focused lessons covering all 33 competencies |
| Core coverage | Tags did not establish specific instructional coverage | 108 explicit teaching/quiz coverage slots |
| Content variety | Unbounded topic pools | 20/30-card targets, core anchors and rotating additional examples |
| Category mapping | 46 Grade 4 labels without this semantic crosswalk | Every label mapped as direct, supporting or enrichment |
| Existing content recovery | Graph axes/plotting and twisting cards lacked competency assignments | Three reviewed tag corrections restore their lesson access |
| Content gaps | Survey methods, practical diagrams and numerous missing questions | Seven trilingual teaching/activity cards and 20 questions |
| Continuity | Broad-topic progress | Profile/grade-specific lesson plans resume after restart; legacy keys migrate |

New teaching cards cover: checking sources about inventions; surveying, classifying and communicating environmental findings with an open mind; making a Philippine habitat table; food-chain arrow direction; sand/silt/clay/loam comparison; observing a shadow stick; and plotting constant speed on a distance–time graph.

The new quizzes also use existing habitat, life-cycle, rigid/soft-object, soil-investigation and weather-instrument cards. Content was added where inspection found an objective or assessment gap, rather than duplicating the full fact bank.

## Specific quality fixes

- `dcard-04689` now belongs to graph construction (axis labels), `dcard-04696` to plotting time/distance points, and `dcard-01407` to force-induced shape changes. `docs/grade4-tag-corrections.json` records the prior decisions and inspected source text.
- Graph teaching explicitly says **distance–time**: rising straight lines show constant speed and horizontal lines show stationary objects. The new plotting exercise includes coordinates and labeled axes, avoiding confusion with a speed–time graph.
- Secondary-source slots now require an actual reliable reference or discussion. A card saying the Sun is an energy “source,” or mentioning recording tape, no longer satisfies source-checking skills.
- The human-life-cycle slot no longer matches an adult frog merely because its text contains “adult.”
- The required food-chain card explains arrows from food to eater. A misleading “energy ends at the top animal” card is excluded from the required pool.
- An oven-drying biomass instruction is excluded from this Grade 4 first-pass pool. Existing seed-number/depth comparisons support the guided soil experiment instead.
- Chemical bonds and mixtures are enrichment rather than standalone required lessons in the reference guide. Supporting adaptation, environmental and water-cycle labels are not blanket proof that all their facts satisfy Grade 4 objectives.

Scoped exclusions do not edit the wider discovery bank. The compiler's additional pools still require a matching competency and honor those exclusions; category overlap alone is insufficient.

## Richness and repeat visits

**1,762 unique core facts** expand to **3,039 unique facts** with the additional pools—1,277 facts that would be inaccessible under the narrow core filters alone. The pre-audit chronological inventory was 3,031 facts; the net increase is eight. The principal improvement is bounded, coherent access to the existing richness, rather than a large new inventory.

| Visits to every lesson | Simulated unique facts viewed |
|---|---:|
| 1 | 754 |
| 3 | 1,692 |
| 5 | 2,178 |
| 10 | 2,670 |
| 20 | 2,858 |

The first-pass simulation reaches 754 distinct facts, approximately 4 hours 11 minutes at 20 seconds per fact, excluding quizzes, recaps and practical activities. A separate exhaustive revisit test confirms every eligible fact is eventually reachable. These are simulations, not measured student engagement.

Five lesson pools finish before their targets rather than padding with repeat facts:

| Lesson | Available card entries | Target |
|---|---:|---:|
| Survey Our Environment | 4 | 30 |
| Group Living Things by Habitat | 27 | 30 |
| Measure Distance and Time | 4 | 20 |
| Distance–Time Graphs | 6 | 30 |
| Track a Shadow | 24 | 30 |

All required slots in these short lessons have teaching and quiz candidates. More examples and quiz variety remain useful future additions; counts alone do not prove mastery.

## Validation and limits

All **44 targeted tests** pass: Grades 3/4/5 coverage, complete real-feed walks, restoration after every card, eventual reserve access, fact deduplication, Calendar selection, quiz/profile isolation, remediation and quiz/recap cadence. Mobile TypeScript and all three manifest checks pass. Grade 3 and Grade 5 revisit measurements remain unchanged.

This audit uses the app's August 2023 MATATAG Science Grades 3–10 extract. It does not verify later curriculum revisions. Structural slots, regex matches and attached questions are not an exhaustive editorial review of every fact, translation or illustration. Diagram-making and practical investigation prompts still require teacher review; the application does not verify that a child performed those tasks.

Reproduce with `pnpm --filter @hiraia/mobile qa:grade4`, `python3 rag/pipeline/compile-lessons.py --grade 4 --check`, and `pnpm --filter @hiraia/mobile qa:content-reach`.

Review artifacts: `rag/pipeline/grade4-lessons.authoring.json`, `docs/grade4-subcategory-crosswalk.json`, `docs/grade4-tag-corrections.json`, `docs/grade4-lesson-coverage.json`, and `docs/content-reach.json`. Stable lesson and coverage-slot IDs support batched editorial review.
