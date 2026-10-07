# Cebuano translation audit handoff — Term 2 pilot changes

7 October follow-up: [local Cebuano alignment is complete](CEBUANO-CURRICULUM-ALIGNMENT-20261007.md)
on `codex/cebuano-curriculum-alignment-20261007`. It includes the explicit source
re-review for `ha-g5-0043` requested below. Historical publication filenames in this
document describe earlier releases; the latest aligned vectors are prepared but
unpublished. Native-language certification remains pending.

5 October 2026. This handoff concerns Grades 3–10, Term 2, all blocks overlapping weeks 4–9. Read `docs/TERM2-PILOT-AUDIT.md` and `docs/term2-pilot-audit.json` for curriculum scope and exact selected IDs. **New/changed Cebuano is a draft for your review, not certified native usage.** Tagalog also needs language review; the English scientific distinctions below are the intended meaning.

## Coordination and source of truth

- Preserve unrelated changes in this shared checkout. Use IDs/fields, not line numbers or broad replacement. The pool is one line; retain `json.dumps(doc, ensure_ascii=False)` with default separators.
- Existing scientific corrections live in **`rag/pipeline/pilot-content-corrections.json`**. Review `fact.bis`, `question.q.bis`, each `question.o[*].bis` and `question.e.bis`. Update this file first: pool/quiz regeneration reapplies it. Editing only generated cards or the raw bank would be overwritten.
- New cards and extra questions live in **`packages/mobile/src/data/gradeNLessonSupplement.json`**. Review `title.bis`, `fact.bis`, question/option/explanation fields; questions are keyed by **factId**, which may differ from card ID. Existing IDs remain stable.
- `term2-pilot-review.json` changes membership only, not translations. It explicitly selects quiz candidates separately from teaching cards. Do not restore keyword-only candidates to compensate for language edits.
- Use corpus/dictionary evidence, as required by AGENTS.md. English scientific vocabulary in a Philippine classroom is valid. Preserve exact-substring emphasis; never infer grammatical errors solely from rarity.

## Existing scientific corrections (all language versions changed)

| Card ID | Fact ID | Intended correction |
|---|---|---|
| `ffct-24623` | `chinese-garter-jump-g4` | Elastic deformation stores energy, not force. |
| `ffct-22440` | `force-direction-matters-g4` | A net force changes velocity; motion need not immediately follow the applied force. |
| `ffct-23371` | `force-has-direction-g4` | A net force changes velocity; motion need not immediately follow the applied force. |
| `ffct-24137` | `force-friction-direction-opposes-g5` | Limit the opposing-motion claim to sliding relative to a stationary surface. |
| `ffct-27000` | `fwg-pulley-work-1558` | A single fixed pulley does not multiply force; distinguish arrangements. |
| `ffct-23049` | `pulley-does-not-create-energy-g6` | A single fixed pulley does not multiply force; distinguish arrangements. |
| `ffct-28763` | `ocean-waves-energy-g6` | Water motion in surface waves is not purely up/down or exactly stationary. |
| `ffct-16663` | `same-group-similar-behavior-g9` | The valence rule needs main-group scope and the helium exception. |
| `ffct-35237` | `oceanic-vs-continental-crust-g10` | Density, not unqualified total weight, explains the comparison of crust types. |
| `ffct-30846` | `greenhouse-effect-melts-ice-g8` | Distinguish land ice from floating sea ice in sea-level rise. |
| `ffct-30851` | `greenhouse-sun-energy-source-g6` | Greenhouse gases interact with outgoing infrared, not just retain incoming sunlight. |

Each row also changes the quiz question, options, correct-answer index (now 0) and explanation. Check negation, initial conditions, and direction particularly carefully. The grounding-bank version must convey the same corrected science.

## New cards and their questions

| File | ID / fact ID | Teaching target |
|---|---|---|
| `grade4LessonSupplement.json` | `g4-pilot-shape-actions` | Push, Pull and Twist |
| `grade4LessonSupplement.json` | `g4-pilot-measure-motion` | Measure a Toy Car |
| `grade4LessonSupplement.json` | `g4-pilot-graph-compare` | Plot Three Motions |
| `grade4LessonSupplement.json` | `g4-pilot-motion-course` | Change a Ball’s Motion |
| `grade5LessonSupplement.json` | `g5-pilot-life-cycle-comparison` | Compare Life Cycles |
| `grade5LessonSupplement.json` | `g5-pilot-friction-test` | Compare Sliding Friction |
| `grade6LessonSupplement.json` | `g6-pilot-machine-tradeoffs` | Test a Machine’s Trade-off |
| `grade7LessonSupplement.json` | `g7-pilot-net-force-motion` | Force Changes Velocity |
| `grade6LessonSupplement.json` | `g6-pilot-water-wave-test` | Observe Water Waves |
| `grade8LessonSupplement.json` | `g8-pilot-periodic-history` | How the Table Developed |
| `grade8LessonSupplement.json` | `g8-pilot-elements-1-10` | Element Names and Symbols |
| `grade8LessonSupplement.json` | `g8-pilot-elements-11-20` | Element Names and Symbols |
| `grade8LessonSupplement.json` | `g8-pilot-shell-position` | Read an Electron Pattern |
| `grade9LessonSupplement.json` | `g9-pilot-dating-evidence` | Read Rock Evidence |
| `grade9LessonSupplement.json` | `g9-pilot-space-evidence` | Tools for Space Research |
| `grade10LessonSupplement.json` | `g10-pilot-climate-evidence` | Compare Climate Evidence |
| `grade9LessonSupplement.json` | `g9-pilot-conservation-categories` | Read the Dated Categories |

The conservation card intentionally preserves national **2017** plant-list examples, rather than asserting current universal categories. Keep scientific names and the distinction between national and global assessments. The graph labels A/B/C and data pairs must agree with the diagram; do not translate or reorder numbers.

## Changed existing supplement / added questions

| File | Card ID | Question key (fact ID) | Change |
|---|---|---|
| `grade4LessonSupplement.json` | `dcard-06180` | `rigid-objects-g4` | question |
| `grade4LessonSupplement.json` | `dcard-06181` | `soft-objects-g4` | question |
| `grade4LessonSupplement.json` | `dcard-05165` | `stretching-a-rubber-band-g4` | question |
| `grade4LessonSupplement.json` | `dcard-07936` | `bending-objects-g4` | question |
| `grade5LessonSupplement.json` | `dcard-04083` | `mammal-life-cycle-g5` | question |
| `grade5LessonSupplement.json` | `dcard-10698` | `chicken-and-human-cycles-g4` | question |
| `grade6LessonSupplement.json` | `dcard-06247` | `what-a-wave-is-g6` | question |
| `grade8LessonSupplement.json` | `dcard-04887` | `quiet-volcanoes-g8` | question |
| `grade8LessonSupplement.json` | `ffct-38829` | `lava-flow-distance-and-shape-g8` | question |
| `grade3LessonSupplement.json` | `g3-core-compare-moving-balls` | `g3-core-compare-moving-balls` | body-and-question |

The Grade 3 comparison card’s body **and** question were rewritten. The other rows above add questions while retaining existing card bodies; explanations reuse those bodies, so review both occurrences if you change their wording.

## Selection / illustration changes without new Cebuano prose

- All 205 scoped slots now have explicit teaching/question selections. The report contains the entire candidate list for your scoped translation audit. Removed candidates remain elsewhere in discovery; exclusion is not a claim that every omitted translation is wrong.
- Grade 4 shape changes now require push and pull separately, in addition to stretch, bend, twist and squeeze. The old generic twisting list is no longer the only example.
- `ffct-24547` now points to `ffct-24145` (qualitative rise/plateau). Original image bytes are preserved.
- `g4-pilot-graph-compare` uses the new `pilot-distance-time` diagram in `packages/mobile/assets/curriculum/`. Axis labels use English science terms and SI symbols; explanations in all languages refer to the same data. Source SVG and `scripts/render-curriculum-graphs.mjs` reproduce the PNG.

## After translation edits

1. If a correction-row translation changes, update `pilot-content-corrections.json`, then run `python3 rag/pipeline/content_corrections.py` and `python3 rag/pipeline/gen-cards-questions.py`. This updates the card pool, corresponding grounding rows and quiz-bank rows. Preserve a copy of `science-facts.jsonl` **before** changing it for the vector refresh.
2. If grounding text changed, regenerate the affected LaBSE vectors with the existing fp32 raw-CLS recipe. `rag/scripts/refresh-changed-vectors.py --before <previous-bank> --report <report.json>` verifies the baseline, ID order, unchanged controls and quantization scale. Never simply change the vector bankHash to silence a mismatch.
3. Run `python3 rag/pipeline/build-cards-db.py`. It also refreshes Tala’s append-only card catalogue. Supplemental-only prose changes do not enter SQLite, but catalogue freshness must still be checked if cards/questions were added.
4. Regenerate/check `compile-lessons.py --grade N` for Grades 3–10 as needed. Explicit IDs preserve membership when translation changes; coverage reports include English examples. After bank/vector/manifest changes, regenerate `packages/mobile/scripts/build-lesson-similarity.py` using Python with NumPy; its hashes must match the final inputs.
5. Regenerate/check the website competency catalogue using `pnpm --filter @hiraia/web competencies:generate` and `competencies:check`.
6. Run the Grade 3–10 lesson tests, `term2-pilot.test.mts`, `three-term-curriculum.test.mts` and type checks. The formal regression gate is still mandatory before any APK build or human device testing.

The pre-build translation gate flagged `quiz-04646` because its correct option is the three-word science term **Elastic potential energy**. This term is intentionally retained in both languages; the two prose distractors are translated. The reviewed exception is recorded in `rag/bank/quiz-legit-english.json`.

Rebuilding the assessment registry also removed the old exact-text teaching link from `ha-g5-0043` to `ffct-24137`: its historical authoring snapshot predates the friction correction. The question remains a source-checked draft; this build does not silently transfer the earlier review to rewritten text. Re-review the snapshot in `rag/assessment-authoring/batches/012-grade5-forces-and-circuits.json` before restoring that exposure link. No assessment prose or review status was changed by the rebuild.

Before publishing after any further grounding edits, upload the refreshed vectors under a new bank-hash filename and update the filename, byte count and MD5 in `packages/mobile/src/config/edition.ts`. The pilot uses `vectors-labse-fbd8f7e58c9e.i8.bin`.

No content IDs were reused and no old catalogue entries were pruned. Build/publication evidence is recorded separately from this translation handoff.

## Pre-build grounding follow-up

The model gate exposed an additional grounding-only fact: `chloroplast-organelle-closeup-g7` described food as made from sunlight and caused a photosynthesis answer to omit water. Its three bodies now distinguish sunlight as energy from water and carbon dioxide as materials, and state that oxygen is released. Review `fact.bis` in the final entry of `pilot-content-corrections.json`. This fact has no teaching-card or quiz-bank counterpart; no new card ID was invented. The language draft follows the existing `living-photosynthesis-g5` wording. The three changed embeddings and unchanged controls are recorded in `docs/term2-pilot-photosynthesis-vector-refresh.json`.
