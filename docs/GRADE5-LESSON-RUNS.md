# Grade 5 required lesson runs

Implemented on unified, 2026-09-09. Reference: the app's August 2023 MATATAG Science curriculum extract. This does not certify alignment with any later revision.

## Content richness update

The required-objective pool is now separate from an additional-example pool. All examples still require a matching competency and pass the same scoped exclusions; the objective regex filters apply only to core coverage. Category labels alone do not add cards to Grade 5.

Each run begins with coverage/quiz anchors, then allocates remaining places roughly two related examples per core example, with fallback when a pool is thin. Category shelves rotate and use a stable mixed source order. Optional unseen facts in either pool take priority over optional repeats. Deduplication and seen history operate on source fact IDs, including known alternate card renderings. Related cards do not falsely count as evidence for a specific core objective; their quizzes still use the existing competency-based fallback and must come from cards actually viewed.

Compatible in-progress runs keep their exact order and completed cards when inventory expands. New visits benefit from the wider pools. This changes Grade 5's bounded planner; other grades retain their existing sequencing.

Run `pnpm --filter @hiraia/mobile qa:content-reach` to refresh `docs/content-reach.json`, which reports all grades' reachable inventories, out-of-Calendar shelves, and Grade 5 unique-fact growth after 1, 3, 5, 10 and 20 visits to each lesson. Counts are simulation results, not measured student engagement or editorial certification. The current Grade 5 pools reach 3,787 unique facts, up from 1,914 in the core-only pool. Simulated unique reach is 707 after one visit to each lesson, 2,234 after five, and 3,506 after twenty. The all-grade report also identifies 28,449 inventory facts outside chronological Calendar feeds; this is a relevance-review backlog, not an instruction to assign them all to Grade 5.

## The seven changes

1. **Required curriculum:** 29 focused Calendar lessons in curriculum order explicitly include all 40 Grade 5 competencies. The 42 distinct subcategory names remain browsing/classification labels; overlapping labels are consolidated into lessons and enrichment is not a required stop. These are not 29 newly invented curriculum competencies.
2. **Bounded first passes:** each lesson has an authored 20- or 30-card target based on its component objectives. The planner covers each of the 105 instructional slots, including quiz-bearing source cards, before adding examples round-robin. Thin pools finish early, without padding a run with duplicate facts. A revisit prefers unused cards and can repeat essential material when no unused substitute exists.
3. **Tag corrections:** organism dichotomous-key examples no longer satisfy rock identification. The existing Sun-at-the-center card now also serves solar-system structure, retaining its gravity tag. Required-pass exclusions cover misleading state-of-matter/classification statements and obsolete storm-signal ranges. Source cards remain in the wider discovery bank: this is not a full-bank factual correction pass.
4. **All existing labels:** eligibility uses actual competency assignments plus objective-specific English-text filters, not a requirement for a grade-prefixed category. Generic and grade-specific category labels are retained. Supplemental cards have valid grade-specific categories for activity/remediation tracking.
5. **Enrichment:** waste-management, constellation and light-interaction subcategories are recorded as enrichment; they do not become required Calendar lessons. Enrichment-only category memberships are excluded from the required candidate pools. The ordinary randomized discovery feed remains available.
6. **Actual content gaps:** 9 supplementary trilingual teaching cards and 26 questions fill gaps found during inspection. These include investigation steps, an erosion tray activity, organ functions, and animal/microorganism classification. The small additive content file works offline through the normal card/question accessors; it does not replace the other agent's content bank or require rebuilding its SQLite database.
7. **Aligned quizzes:** viewed cards carry lesson-objective identifiers into review history. New-question selection prefers distinct objectives even when cards share one competency code. Existing single/checkpoint/closing reviews, spaced repeats, option shuffling and short-topic limits remain in force. Quizzes are only drawn from viewed source cards.

## Progress and persistence

A lesson run stores its exact ordered card IDs, completed IDs, lesson key and manifest revision in the existing profile-scoped settings database. Lifetime card history selects reserve material; it does not mark a new run complete. Restart and grade changes restore the run. Explicit Calendar taps start a new pass. Legacy Grade 5 Calendar keys map to the first new lesson sharing an old competency; existing histories and awards are not deleted or transferred as proof of mastery of newly split lessons. Changed manifests invalidate incompatible plans without deleting lifetime history.

Current first-run presentation count is approximately **707 cards**, allowing short pools to finish early. At 20 seconds/card this is **3.93 hours of reading**, excluding quizzes, recaps and activities. A presentation count can include a fact revisited under another lesson; it is not a unique-fact count. The 20/30 targets sum to 720 before short-pool adjustments.

## Reproduce and extend

- Author lesson boundaries, objective filters and scoped exclusions in `rag/pipeline/grade5-lessons.authoring.json`.
- Maintain additive cards/questions in `packages/mobile/src/data/grade5LessonSupplement.json`.
- Correct source-fact competency assignments through `curriculumTagOverrides.json` or `curriculumTagExclusions.json`, then run `node packages/mobile/scripts/gen-curriculum-tags.mjs`.
- Compile with `python3 rag/pipeline/compile-grade5-lessons.py` from the repository root.
- Check with `pnpm --filter @hiraia/mobile qa:grade5`. APK builds also refuse stale or structurally incomplete manifests.
- Inspect `docs/grade5-lesson-coverage.json` for per-objective counts and sample evidence. Each lesson can be reviewed independently; the stable lesson/unit IDs make the editorial review batchable.

## Evidence and limits

The headless tests drive the real card-selection code through all 29 lessons, serialize/restore after every card, check reserve selection, verify all required slots have teaching/quiz candidates, and cover Calendar navigation, profile/grade review isolation, short-topic quiz spacing, remediation and recaps. All 36 targeted tests and the mobile TypeScript check passed.

The report is a structural coverage check backed by targeted content inspection. A regex match or an attached MCQ is not proof of complete teaching or of mastery. Existing candidate prose and illustrations have not all been manually reviewed here. In particular, required labeled diagrams, practical investigations and models still need teacher review; a text card or multiple-choice answer cannot certify that a child performed those tasks. The 105 slots are our implementation decomposition of 40 competencies, not official additional competencies.

Storm-signal exclusions were checked against [PAGASA's current TCWS table](https://www.pagasa.dost.gov.ph/learning-tools/tropical-cyclone-wind-signal) on 2026-09-09. The older ranges remain a follow-up correction for the wider discovery bank.

No APK was built, installed or published as part of this change.
