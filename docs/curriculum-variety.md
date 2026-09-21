# Curriculum example variety

Implemented in `packages/mobile/src/data/lessonPlan.ts` and `lessonVariety.ts`.

Calendar lessons still use their approved grade/topic pools, with 20- or 30-card
targets and the existing subcategory intersection. Required objective/quiz anchors
retain their editorial order and unseen preference. Optional examples now vary on
each newly planned visit rather than walking the same fixed list. Selection still
rotates related/core groups at the existing two-to-one cadence, and tries every
unseen pool before using optional repeats. Source-fact IDs prevent two versions of
the same fact appearing in one run. No content or curriculum assignments change.

Each new plan gets a random seed. Its exact cards, order, completion state and seed
are stored through the existing profile-specific lesson-run persistence. Valid old
saves without a seed also resume unchanged. A new visit can vary even after the
whole pool has been read; an unfinished visit never reshuffles on a page turn,
restart, language change, or similarity-data update.

## LaBSE diversity

The planner uses a bundled sparse graph built from the existing LaBSE English
source-fact vectors. Only pairs that share an approved lesson pool are compared.
For each fact, the artifact retains up to eight strongest neighbors with cosine
similarity at least 0.80. Runtime checks both directions of an edge. This cutoff is
an editorial diversity heuristic, not a calibrated duplicate/relevance classifier.

Within the next eligible example group, candidates receive a seeded random score
between 0 and 0.25, minus a redundancy penalty based on their strongest saved
similarity to any already selected card: `max(0, (cosine - 0.80) / 0.20)`.
The graph never admits, excludes or rewrites cards, never overrides coverage or
unseen priority, and does not determine grades or mastery. Some closely related
cards may be necessary to teach a concept, so this remains a soft preference.

The initial artifact is 1,403,977 bytes: 24,556 embedded source facts and 55,040
directed similarity links. Another 2,136 admitted source IDs lack vectors in the
bank and receive randomized selection without a semantic penalty. Missing edges
mean unknown similarity, not proven dissimilarity. A lesson revision mismatch
disables its semantic hints while leaving ordinary varied selection working.

This adds no model load, query embedding, network call or download requirement on
the phone. It works on the same lesson pools regardless of UI language. It does not
yet personalize a curriculum run around a student's free-text search, nor expand
the approved pools. Live LaBSE search continues through its separate existing path.

## Regeneration and checks

From the repository root, with Python and NumPy installed and the original bank
and vectors present:

```sh
python3 packages/mobile/scripts/build-lesson-similarity.py
python3 packages/mobile/scripts/build-lesson-similarity.py --check
```

The builder makes no inference/API calls. It verifies bank fingerprint, unique
source IDs, vector dimensions/file size, and cross-grade fact mappings. Its output
records hashes of the bank, vectors, metadata and all eight lesson manifests.
Regenerate after changing these inputs; do not edit the generated graph manually.

The `lesson-variety.test.mts` suite checks source hashes, all 308 lessons across
eight seeds, eligibility, objective/quiz coverage, source deduplication, exact old
and new save restoration, varied revisits, and unseen priority. A matched seeded
comparison over rich lessons found 1,266 saved cosine >=0.85 pairs with random-only
selection versus 415 with the diversity hints (about 67% fewer). That measures
embedding-based redundancy, not learning outcomes or independently judged quality.
The all-grade planner sweep took about 1.4 seconds for 2,464 plans on the development
machine; this is not an Android performance measurement.

No APK build, installation, public deployment or version bump is part of this change.
