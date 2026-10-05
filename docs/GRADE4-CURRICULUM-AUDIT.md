# Grade 4 curriculum audit and implementation

## Pilot review — 2026-10-05: Revised K-12, Term 2, weeks 4–9

Implementation follow-up: the scoped fixes are now part of the [Grades 3–10 Term 2 audit](TERM2-PILOT-AUDIT.md), with an explicit [translation handoff](TERM2-PILOT-CEBUANO-HANDOFF.md). The findings and counts below describe the pre-fix snapshot. The new sequence adds six-action coverage, measurement and graph activities, a labelled offline graph, factual corrections and explicit candidate selection. Native-language review and teacher-observed practical work remain separate.

This follow-up supersedes the earlier structural coverage claim **for pilot readiness in this block**. All six objectives have mapped lessons, but mapped coverage is not sufficient instructional coverage. Review the fixes below before relying on this block for the Grade 4 pilot. This review changes no learner content.

Reference: [official Grade 4 Budgets of Work page](https://sites.google.com/deped.gov.ph/lsguide/budgets-of-work/grade-4), archived as `rag/sources/curriculum-guides/three-term-2026/grade-4-science.pdf`, with extracted text and provenance alongside it. The official objective order is rigid/soft objects, shape changes, measurement, speed, graphs, then changing motion. The stable G4-F codes below are existing app identifiers, not new official codes.

Inventory from `grade4Lessons.generated.json`, the app pool, Grade 4 supplements, and built `cards.db`; counts are distinct facts per lesson and overlap across lessons. “Core” means compiler-selected, not editorially approved. All reviewed non-supplement English bodies match the built database; `g4-core-uniform-graph` is supplied separately through the runtime supplement.

| Objective / lesson | Eligible / core facts | Core facts with quizzes | Assessment |
|---|---:|---:|---|
| Rigid/soft, predict movement and shape (`g4:rigid-soft`) | 48 / 31 | 2 | Useful comparisons and activity prompts exist; assessment is thin. |
| Push/pull/stretch/bend/twist/squeeze (`g4:change-shape`) | 79 / 61 | 33 | Stretching, bending and squeezing have examples; twisting is only a list and recognition question. |
| Measure distance/time (`g4:distance-time`) | 18 / 17 | 10 | Equipment vocabulary exists; no complete measurement procedure identified in this pool. |
| Speed (`g4:speed`) | 60 / 41 | 22 | Substantial explanation/question inventory; needs a focused, practical first pass. |
| Construct/label stationary, uniform, fast/slow graphs (`g4:speed-graphs`) | 10 / 9 | 7 | One numerical plotting exercise; insufficient diagram and construction practice. |
| Pushes/pulls change speed/direction (`g4:change-motion`) | 66 / 49 | 42 | Many relevant examples, but some core explanations need factual correction. |

### Pilot priorities and reproducible evidence

1. **Correct factual errors in both cards and attached quizzes.** `ffct-24623` says a stretched rubber band “stores force”; its correct answer and explanation repeat this in the language variants. Elastic deformation stores energy, not force ([OpenStax, potential energy](https://openstax.org/books/college-physics/pages/7-4-conservative-forces-and-potential-energy)). `ffct-22440` says an object moves wherever it is pushed/pulled, without accounting for an already moving object slowing under an opposing force. Its quiz explanation repeats that generalization. `ffct-24137` makes the unqualified claim that friction always opposes an object's motion; narrow the explanation to sliding on a stationary surface. Friction can accelerate an object, as the bank's own conveyor-belt example `ffct-28152` illustrates.
2. **Replace false core matches with reviewed instructional selections.** In `rag/pipeline/grade4-lessons.authoring.json`, graph fast/slow matches `steep|fast|slow`, admitting cheetah (`ffct-09588`) and ostrich (`ffct-01381`) trivia and animal quizzes. Stationary matches `horizontal`, so the axes-only `dcard-04689` counts toward stationary teaching. Measurement regexes admit Bolt's sprint time (`ffct-26505`), Mariana Trench depth (`ffct-34671`), tern migration (`ffct-03784`) and lightning/thunder distance facts. These do not teach children to measure a moving object with simple equipment. The compiler prefers quiz-bearing candidates; adding questions alone cannot repair relevance.
3. **Complete the highlighted shape-change objective.** The sole twist-slot candidate is `dcard-01407`, a list of ways to change solids; its question only recognizes “Twisting it.” Add a concrete before/action/after example and a guided prediction/observation activity. Existing stretch/bend/squeeze examples include `dcard-05165`, `dcard-07936` and `dcard-07932`. Push and pull are not separately required slots, so their presence in individual texts does not ensure coverage in a selected lesson run. Require all six actions explicitly. Move advanced examples such as Hooke's law, spring constants and I-beam engineering out of the initial Grade 4 teaching sequence.
4. **Supply actual graph construction practice and suitable diagrams.** `g4-core-uniform-graph` gives points (0,0), (1,2), (2,4), (3,6), labels and units, but has no illustration; its quiz tests recognition of constant speed. Add stationary and slower/faster data sets, a labelled grid with units/scales, and plotting/comparison questions. Visual inspection of `packages/images/assets-png/general/graph-line-distance-time.png` found an unlabelled rising/falling zigzag with no units, scale or stationary section; it is unsuitable for its distance–time teaching caption and misleading if interpreted as cumulative distance travelled. `cards-png/ffct-24152.png` shows axis names but no scales/units. `cards-png/ffct-24145.png` does show a useful qualitative rise and plateau, but not measured plotting practice. This was inspection of these three relevant assets, not all illustrations.
5. **Bridge facts to observable classroom skills.** Build a short teacher-guided sequence: predict how a soft/rigid object changes, apply an action and record the result; mark a toy car's start/finish, measure distance, time the crossings, repeat and record values; plot the observations and compare stationary/slow/fast cases. Existing `ffct-39306` already suggests an object/shape-before/force/shape-after table. Instrument cards `dcard-12262`, `dcard-01252`, `ffct-25503` and `dcard-11468` can support measurement. Keep the distinction between reading/answering in the app and physically performing/measuring the task.

Validation: `compile-lessons.py --grade 4 --check` passed with `GAPS []`. The four Grade 4/calendar/default/review test files passed using `node --import tsx --test` (the normal `tsx` CLI could not create its IPC socket in the sandbox).

The present audit inspects lesson candidates and attached question content; it does not establish student mastery, a native-speaker language review, every possible randomized feed, the installed pilot APK's identity, or full image-pack availability. Mechanical coverage tests establish runnable lessons and slot candidates, not semantic relevance or factual correctness. Update the public coverage description accordingly if it is used to claim readiness for this pilot block.

## Historical implementation report — 2026-09-09

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
