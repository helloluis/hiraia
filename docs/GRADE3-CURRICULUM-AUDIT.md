# Grade 3 curriculum audit and implementation

Completed on unified, 2026-09-09. This is the Grade 3 checkpoint in the requested grade-by-grade rollout. Grade 4 is next; Grades 6–10 remain unaudited by this workflow. Grade 5's existing implementation is preserved.

## Before and after

| Area | Before | After |
|---|---|---|
| Calendar | 13 broad topics; exhaust eligible content | 29 focused lessons, in competency order |
| Required coverage | Tags did not prove named skills were taught | All 34 competencies represented by 99 explicit coverage slots |
| Run length | Potentially hundreds of cards in one topic | Authored 20/30-card targets; thin pools finish early |
| Repeat visits | No bounded reserve strategy | Core teaching/quiz anchors plus rotating relevant examples |
| Category audit | Grade labels alone could suggest coverage | All 39 Grade 3 subcategory labels mapped as direct, supporting or enrichment |
| Tag corrections | Four usable facts were excluded or had only module provenance | Hand-lens, scissors, cardboard and movement-measurement facts restored to appropriate competencies |
| Missing content | Guided activities and quiz gaps | Six trilingual teaching/activity cards and 22 questions added |
| Persistence | Broad-topic cursor | Exact lesson run saved per profile/grade; valid runs resume after restart |

The added teaching cards cover a balloon as a science tool, modeling clay, guided paper-folding exploration, observing/predicting/measuring plant growth, comparing moving balls, and observing earth materials around school. Questions also use existing teaching cards rather than duplicating the library.

The core checks reject substring false matches: `oil` no longer matches `soil`, `round` no longer matches `ground`, and `join` does not treat construction joints as an explanation of joining materials. Guided-activity slots need instructions, not just a sentence mentioning an investigation. A misleading living/non-living absolute statement and two ambiguous traffic-signal explanations are excluded from the required pools. These scoped exclusions do not constitute corrections to the wider discovery bank.

Chemical reaction rates and inherited traits are enrichment rather than standalone required Grade 3 lessons in the app's reference guide. Supporting labels such as sense organs, states of matter and heat sources do not certify every fact under those labels as required Grade 3 material. Additional examples still need an actual matching competency; category or keyword overlap alone is insufficient.

## Content reach

There are **2,997 unique facts in the core candidate pools** and **4,741 unique facts across the core and additional pools**. The additional pools preserve access to 1,744 facts beyond the narrow core filters. Compared with the pre-audit chronological inventory (4,734 facts), this is a modest net increase of seven, not a doubling of the old inventory: the main improvement is coherent bounded sequencing while retaining richness.

| Visits to every Grade 3 lesson | Simulated unique facts viewed |
|---|---:|
| 1 | 654 |
| 3 | 1,726 |
| 5 | 2,401 |
| 10 | 3,289 |
| 20 | 4,364 |

These are deterministic planner simulations, not measured student engagement. The first pass covers 654 unique facts—about 3 hours 38 minutes at 20 seconds per fact, excluding quizzes, recaps and hands-on activities. The reachability test continues revisits until each lesson's eligible fact inventory is exhausted; no eligible fact is permanently stranded by the planner.

Four lessons have fewer candidates than their target. They end early instead of padding with repeated facts:

| Lesson | Available card entries | Target |
|---|---:|---:|
| Ask and Try | 4 | 20 |
| Observe, Predict, Measure | 23 | 30 |
| Investigate Living Things | 6 | 30 |
| Where Did It Move? | 6 | 20 |

These short pools are future opportunities for more examples, not missing competencies: all their required slots have teaching and quiz candidates. Existing short-topic quiz limits still apply.

## Validation and limits

- All 40 targeted tests pass across Grades 3 and 5, Calendar selection, complete chronological walks, save/restore, fact deduplication, eventual reserve reachability, profile/grade quiz isolation, remediation, and quiz/recap cadence.
- Mobile TypeScript and both manifest checks pass. The APK build checks both audited grades.
- Grade 5 still reaches the same 3,787 unique facts, with unchanged revisit simulation results.
- The source is the app's August 2023 MATATAG Science Grades 3–10 extract, not a verification of subsequent curriculum revisions. Filters and candidate counts are structural evidence, not certification of every card, translation, illustration or student's mastery. Practical activities still require teacher review/supervision.
- No APK has been built, installed or published for this audit.

## Reproduce or review

- `pnpm --filter @hiraia/mobile qa:grade3`
- `python3 rag/pipeline/compile-lessons.py --grade 3 --check`
- `pnpm --filter @hiraia/mobile qa:content-reach`

Artifacts: `rag/pipeline/grade3-lessons.authoring.json`, `docs/grade3-subcategory-crosswalk.json`, `docs/grade3-tag-corrections.json`, `docs/grade3-lesson-coverage.json`, and `docs/content-reach.json`. The corrections file preserves prior tag/exclusion decisions with the inspected English source text. Review can be batched by stable lesson or coverage-slot ID.
