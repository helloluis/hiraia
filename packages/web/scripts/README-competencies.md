# Public competency map

`/competencies` shows the Philippine app's current curriculum lessons. The reference
baseline is **DepEd MATATAG Science, Grades 3–10, August 2023**. This is a content
inventory for that edition; it is not a claim about a school's present rollout,
complete instruction, practical assessment, or learner mastery.

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

The only generated output is `public/competencies/ph-matatag.json`. It is imported
by the server page and offered as a download. Mobile runtime code, full card prose,
models, embeddings, the 16 MB card index, and the APK database are not web imports.
Generation requires the tracked repository inputs and the web package's existing
TypeScript dependency; it requires no API, model, network access or APK database.

## Source and counting rules

- `mobile/src/data/lessonPlan.ts` identifies the audited grades and imported lesson
  manifests. These replace the older generated CG-topic outline in the actual app.
  The page preserves the lesson order, title translations, quarter, and codes.
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
- Domains and their grade-specific quarter rotation come from the shared curriculum
  module. Topic titles offer English, Tagalog and Cebuano; source statements stay
  in English because reviewed translations do not exist in this mapping.

The generator validates source codes, grade/quarter assignments, card existence,
objective membership and question references. The output records SHA-256 hashes
for every consumed source file. It also lists any source competencies without an
included lesson, rather than filling gaps with inferred matches.

As of 1 October 2026 the snapshot contains **308 topics, 324 competencies, and 1,035
authored objectives** across Grades 3–10. All 23 source inputs matched committed
`HEAD` when generated. The public map does not depend on another thread's mobile
internationalization or new foundation-exam changes.

Before publishing a selective web change from a shared checkout, compare the
provenance inputs to the intended app revision. Do not ship a generated catalogue
whose source files will be absent or different on the deployment checkout.

Peru's national competency hierarchy is a separate research artifact. Publishing
another country's reference map must distinguish reference targets from learning
materials Hiraia actually provides; never relabel Philippine lessons as equivalent
coverage without an explicit, reviewed crosswalk.
