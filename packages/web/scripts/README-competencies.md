# Public competency map

`/competencies` shows the Philippine app's current curriculum lessons. The reference
baseline is **DepEd Revised K-12 Curriculum, three-term Science budgets of work,
Grades 3–10 (2026)**. Grades 3–8 use the April 8 edition; Grades 9–10 use June 29.
This is a mapping of available content, not proof of practical assessment or mastery.

## Generate and check

From the repository root:

```sh
pnpm --filter @hiraia/web competencies:generate
pnpm --filter @hiraia/web competencies:check
pnpm --filter @hiraia/web type-check
pnpm --filter @hiraia/web build
```

The normal web build runs the read-only catalogue check first. Regenerate after
changing a relevant app lesson, its card/quiz inventory, or a source extraction.
Review the generated diff before publishing. A stale file blocks the build.

The only generated output is `public/competencies/ph-revised-k12.json`. It is imported
by the server page and offered as a download. Mobile runtime code, full card prose,
models, embeddings, the 16 MB card index, and the APK database are not web imports.
Generation requires the tracked repository inputs and the web package's existing
TypeScript dependency; it requires no API, model, network access or APK database.

The Term 2 pilot and full-year audit select required teaching and questions
explicitly across Grades 3–10. The 8 October reading expansion adds separately
reviewed examples; topic counts include those examples, while direct competency
counts still use only authored objective cards. Provenance includes both core
reviews, their corrections/English lock and `lesson-examples-review.json`.
Unselected cards remain in discovery. See `docs/CURRICULUM-FEED.md` and
`docs/FULL-YEAR-CURRICULUM-AUDIT.md` for evidence and assessment boundaries.

## Source and counting rules

- `mobile/src/data/lessonPlan.ts` identifies the audited grades and imported lesson
  manifests. These replace the older generated CG-topic outline in the actual app.
  The page preserves the lesson order, title translations, term, week ranges, and codes.
- `TOPIC_MIN_CARDS` in `mobile/src/data/cards.ts` is read through TypeScript's syntax
  tree. Only topics meeting the app's admission floor are included.
- The two `rag/sources/curriculum-guides/matatag-*-competencies.json` files supply
  source statements. `G3-M-1`-style codes are Hiraia identifiers, not DepEd codes.
- A competency is counted only when an admitted lesson explicitly assigns cards to
  authored objectives for that competency. Broad card tags, keyword matches,
  enrichment tags, and readiness/foundation exam targets do not create coverage.
- Topic card counts are distinct `lesson.cardIds`, including related examples.
  Direct competency counts are the union of that competency's authored unit cards.
  These count card IDs, not deduplicated prose or underlying source facts.
- Practice question counts use distinct underlying fact IDs that have a question.
  Competency question counts use its authored `unit.quizCardIds`; topic counts
  include every question-bearing card in the topic. These are the app's short
  practice questions, not its separate longer exams.
- Resources may appear in several objectives, topics or grades. Do not sum the
  displayed row counts to infer a unique corpus size.
- Historical domain assignments come from the shared curriculum module; a term
  can cover several domains. Topic titles offer English, Tagalog and Cebuano; source statements stay
  in English because reviewed translations do not exist in this mapping.

The generator validates source codes, historical grade/quarter assignments and current term placement, card existence,
objective membership and question references. The output records SHA-256 hashes
for every consumed source file. It also lists any source competencies without an
included lesson, rather than filling gaps with inferred matches.

As of 5 October 2026 the revised map has **309 topics and 322/322 listed BOW
competencies** across Grades 3–10. Two additional Grade 6 wave objectives remain
supporting content and are explicitly excluded from the BOW coverage count.

## Three-term migration (5 October 2026)

`packages/shared/src/curriculum/three-term-2026.json` is the shared, reviewed
competency-to-term/week crosswalk. Its source records include the official URLs,
PDF edition dates and SHA-256 digests. The individual original PDFs and text extractions are retained under
`rag/sources/curriculum-guides/three-term-2026/`. `sources.json` records their provenance; each PDF was verified after copying.
`shared/src/curriculum/scheduleLessons.ts` supplies the same lesson ordering and
term splits to mobile and this generator. Its bytes are included in provenance.

Existing card IDs, objective IDs and historical quarter metadata are preserved.
The original Grade 5 adaptations lesson keeps its key for plant adaptations;
animal adaptations use `g5:adaptations:term2`. Seen cards and objective history
remain keyed by their unchanged IDs. Unchanged lessons retain exact saved runs;
a run spanning the split may be replanned against its retained seen history.

The source has overlapping week ranges; these remain as printed. Grade 3 Term 3
has headings inconsistent with their competencies, so the app retains its accurate
reviewed topic titles. Grade 8's printed “Father information” typo is not copied
into the learner text. Grade 6 G6-F-7/G6-F-9 are supporting prerequisites for the
wave-model objective, not newly claimed official targets.

The homepage demo is rebuilt with `python3 packages/web/scripts/build-demo-q1-packs.py`
and `python3 packages/web/scripts/sync-demo-title-topics.py .`. The old `q1` file
names remain internal compatibility names; selection and ordering now follow Term 1.
The demo is a sample of available cards, not a complete term course. No facts,
translations or quizzes are rewritten by this migration.

Before publishing a selective web change from a shared checkout, compare the
provenance inputs to the intended app revision. Do not ship a generated catalogue
whose source files will be absent or different on the deployment checkout.

Peru's national competency hierarchy is a separate research artifact. Publishing
another country's reference map must distinguish reference targets from learning
materials Hiraia actually provides; never relabel Philippine lessons as equivalent
coverage without an explicit, reviewed crosswalk.

## Production validation on 1 October 2026

The competency generator check, Next.js production build and TypeScript checks passed for the deployed page. The production build also reported a pre-existing ESLint configuration failure: inherited type-aware rules have no TypeScript project information. A read-only trial adding project service removes that exception but reveals missing resolver/plugin setup and a wider existing lint backlog. This task does not claim a clean repository lint run, and does not suppress the affected rules. Restore the shared lint configuration and triage the resulting backlog as a separate repository maintenance change.
