# Subcategory regression map

Cross-grade support is defined at the finalized DepEd subcategory level. The student's
declared grade remains unchanged. When remediation is later activated, the feed can silently
serve cards from an earlier-grade prerequisite and show only an asterisk beside the declared
grade while that remediation is active.

`packages/mobile/src/data/subcategoryPrerequisites.json` is the reviewed source of truth. It
contains one or more prerequisite IDs for every Grade 4–10 leaf in
`rag/pipeline/deped-taxonomy.json`. Grade 3 is the foundation and intentionally has no outgoing
mapping. A valid link must point to a lower grade in the same science strand. Grade 4–10
coverage is complete: 296 mapped leaves across Matter, Living Things, Force/Motion/Energy,
and Earth/Space.

`subcategoryRegression.ts` exposes three runtime operations:

- Find the grade-local DepEd subcategories attached to a card while ignoring generic browsing
  categories.
- Read the authored prerequisite links for a subcategory.
- Resolve the closest prerequisite shelf with enough cards. If an intermediate shelf is empty,
  the resolver follows its own prerequisite until it finds a usable foundation.

The mapping is content-independent. Adding cards to a formerly empty subcategory requires no
mapping edit, and the resolver will begin using the nearer shelf automatically. Run this after
taxonomy generation or mapping changes:

    node packages/mobile/scripts/validate-subcategory-prerequisites.mjs
    node --import tsx --test packages/mobile/scripts/subcategory-regression.test.mts

The validator requires complete Grade 4–10 coverage, known IDs, a lower source grade, matching
strands, provenance for every choice, and presence of every finalized leaf in the generated
mobile taxonomy.

The review scheduler activates one remediation run when a student answers a strict majority of
a topic recap incorrectly. It chooses the subcategory occurring most often among the missed
questions, resolves its closest usable prerequisite, and queues up to six quiz-backed cards from
that shelf ahead of the ordinary feed. Those cards do not advance the declared-grade checkpoint
or topic recap windows.

After the lower-level cards, the app gives a three-question quick review. A strict-majority pass
closes remediation and resumes the held curriculum. A failure resets the same short run for
another attempt. Only one remediation can be active, its state survives restarts in the existing
profile- and grade-local review record, and it has no time-based expiry. The student's declared
grade is never mutated. The UI shows only `*` immediately after the footer grade while a run is
active; it does not announce or label the lower instructional grade.
