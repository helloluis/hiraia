# Grade 6 curriculum audit and implementation

Completed on unified, 2026-09-09. This is the requested Grade 6 reporting checkpoint; Grade 7 remains unaudited. No APK was built, installed or published for this change.

## Improvements

| Area | Before | After |
|---|---|---|
| Calendar sequencing | 18 broad topics with topic-exhaustion sequencing | 37 focused lessons in curriculum order |
| Coverage | Topic tags alone | All 37 numbered competencies represented by 127 teaching/quiz slots |
| Category mapping | 42 labels without this semantic crosswalk | All 42 mapped as direct, supporting or enrichment |
| Lesson length | Exhaust the topic pool | 20/30-card targets with natural endings for smaller pools |
| Existing content | Propagation, variables and eclipse-model cards missing appropriate assignments | Seven reviewed tag repairs |
| Gaps | Missing practical models and assessments | 12 trilingual teaching/activity cards and 25 questions |
| Content quality | Keyword coincidences and observed misleading examples | Tighter objective filters and 18 scoped exclusions |
| Persistence | Broad-topic progress | Profile/grade-specific saved plans, legacy-key migration and return-visit reserves |

The four quarters contain 9 matter lessons, 8 living-things lessons, 10 force/motion/energy lessons and 10 Earth/space lessons. Stable lesson IDs and objective IDs support batched follow-up reviews.

## What was repaired

1. **Curriculum crosswalk:** every Grade 6 label has an explicit role. Musculoskeletal/integumentary, digestive and nervous-system shelves are enrichment. Supporting planetary, atmospheric and ecosystem labels do not automatically qualify every card for a required objective; matching competency tags remain mandatory.
2. **Bounded sequence:** learners move through focused lessons without exhausting hundreds of facts in a large pool. Every planned run includes quiz-bearing core coverage, with rotating additional examples and source-fact deduplication.
3. **Content recovery:** cutting and grafting facts keep their plant-reproduction assignments and now also serve the propagation investigation. Layering, budding, independent/dependent variables and an eclipse model gain precise missing assignments. Prior tag/exclusion decisions are recorded in `grade6-tag-corrections.json`.
4. **Practical teaching gaps:** new cards cover a state-change flowchart; a labeled circulation route; a controlled dissolving experiment; a replicated propagation comparison; checking ecology sources; reading a wave reference; rope/spring models; a globe day/night model; an eruption timeline; regional Philippine seasons; physical versus chemical identity; and an orbital model of seasons and yearly constellations. These are text instructions for making models, not newly drawn illustrations.
5. **Assessment gaps:** 25 questions cover those additions and existing picking, variable-control, repeated-trial, layering, budding, lever, reflection, eclipse, hazard-map and community-source cards. All have English, Tagalog and Cebuano text and run offline. Existing spaced/single/checkpoint quizzes, shuffled answers and encouraging recaps are preserved.
6. **Semantic corrections:** “resources” no longer counts as consulting a source, “reference pitch” no longer counts as reference reading, and “because” no longer matches a use requirement. Propagation-method slots require an actual method explanation rather than a list of method names. Regional climate coverage requires regional evidence rather than a generic wet/dry-season claim. A required physical-change card explains that reversibility is a clue rather than the definition.
7. **Quality and continuity checks:** scoped exclusions reject the observed misleading science/safety/cultural claims from both core and related pools. The sleep-pressure regression check follows plant competency codes instead of depending on an old display title. Existing student histories and reviewed Grade 3/4/5 lesson inventories are retained.

`grade6-scoped-exclusions.json` records each exclusion and rationale. This is a targeted sample review, not a full fact-by-fact rewrite of the discovery bank.

## Richness and repeat visits

**2,743 unique core facts** expand to **4,188 reachable facts** with additional examples. That preserves **1,445 facts beyond the narrow core filters**. The old Grade 6 chronological pool had 4,190 facts; the new pool has two fewer after new content, recovered assignments and scoped exclusions. The benefit is coherent, bounded access to existing richness, not inflating card counts.

| Visits to every lesson | Simulated unique facts viewed |
|---|---:|
| 1 | 821 |
| 3 | 1,800 |
| 5 | 2,370 |
| 10 | 3,444 |
| 20 | 3,981 |

The first pass presents **826 cards covering 821 distinct facts**. At 20 seconds per presentation, that is **4 hours 35 minutes 20 seconds**, excluding quizzes, recaps and practical work. Shared objectives can cause a small amount of reinforcement across lessons. A separate exhaustive revisit test confirms that all eligible reserve facts are eventually reachable; the 207 not reached after 20 full visits are not permanently inaccessible.

## Remaining content-depth limitations

These five pools finish early rather than repeating cards to fill a quota:

| Lesson | Available card entries | Target |
|---|---:|---:|
| Design a Fair Test | 8 | 20 |
| Compare Plant Propagation | 8 | 30 |
| Living and Nonliving Factors | 26 | 30 |
| Explore Water Waves | 26 | 30 |
| Learning About Community Sky Knowledge | 18 | 20 |

Every required slot has instructional and quiz candidates, but several practical/source-reading slots have just one quiz anchor. More examples and questions would improve repeat-visit variety, especially fair tests, propagation investigations and community sky knowledge. An attached quiz does not necessarily assess every skill mentioned by its teaching card. The app cannot verify performance of a hands-on investigation or certify mastery from these structural counts.

## Validation

- **48 targeted tests pass:** Grades 3/4/5/6 coverage, real-feed walks, restore after each card, eventual reserve reach, deduplication, all visible Calendar entries, quiz persistence/profile isolation, remediation and quiz/recap cadence.
- Mobile TypeScript passes. Manifest checks for previously audited Grades 3/4/5 remain unchanged; Grade 6 has zero reported coverage gaps.
- Grade 3, Grade 4 and Grade 5 content-reach simulations are exactly unchanged.
- The APK build script now checks Grade 6's authored manifest before a future build.

Reproduce with `pnpm --filter @hiraia/mobile qa:grade6`, `python3 rag/pipeline/compile-lessons.py --grade 6 --check`, and `pnpm --filter @hiraia/mobile qa:content-reach`.

## Evidence and limits

The curriculum baseline is the app's **August 2023 MATATAG Science Grades 3–10 extract**, `rag/sources/curriculum-guides/matatag-elementary-competencies.json`. This work does not certify alignment with later curriculum revisions or individually approve every fact, translation or image. Teacher/language review remains appropriate for the new activity wording.

For regional weather, [PAGASA's Philippine climate reference](https://www.pagasa.dost.gov.ph/index.php/information/climate-philippines) and [its climate-type discussion](https://bagong.pagasa.dost.gov.ph/information/climate-change-in-the-philippines) support the distinction between broad national seasons and regional rainfall patterns. The new planning card directs students to local forecasts rather than treating dates as guarantees.

Volcano lessons direct learners to [PHIVOLCS monitoring and records](https://volcano.phivolcs.dost.gov.ph/), [official hazard maps](https://gisweb.phivolcs.dost.gov.ph/gisweb/earthquake-volcano-related-hazard-gis-information), and [preparedness materials](https://www.phivolcs.dost.gov.ph/volcano-preparedness/). No current alert, exact next-eruption date or universal evacuation radius is hardcoded into the additions. Community sky-knowledge slots emphasize permission, attributed accounts and differences between communities; this is not an ethnographic verification of all existing cultural claims.

Review artifacts: `rag/pipeline/grade6-lessons.authoring.json`, `docs/grade6-subcategory-crosswalk.json`, `docs/grade6-tag-corrections.json`, `docs/grade6-scoped-exclusions.json`, `docs/grade6-lesson-coverage.json`, and `docs/content-reach.json`.
