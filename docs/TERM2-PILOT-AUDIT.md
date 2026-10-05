# Term 2, weeks 4–9 — Grades 3–10 pilot content audit

5 October 2026. Scope: 65 official competencies, 64 existing lesson groups, 205 teaching/assessment slots after adding explicit push/pull shape-change slots. All eight downloaded Science BOW PDFs were used. Blocks overlapping the window are included in full: the PDFs do not assign individual objectives to exact weeks inside those blocks.

| Grade | Subject matter in the window | Reviewed cards¹ |
|---|---|---:|
| 3 | Week 4: animal/plant parts. Weeks 5–7: basic needs, dependence and conservation. Weeks 8–9: ways to move objects and movement factors (block continues to week 10). | 56 |
| 4 | Weeks 4–9: rigid/soft objects, six shape-changing actions, distance/time measurement, speed, graphs and changes in motion. | 33 |
| 5 | Weeks 4–6: animal reproduction, camouflage/mimicry and life cycles. Week 7: contact forces. Weeks 8–9: friction investigations. | 30 |
| 6 | Week 4: biotic/abiotic factors and interactions. Weeks 5–7: simple machines and lever tests. Weeks 8–9: water/sound waves and properties (block continues to week 10). | 62 |
| 7 | Week 4: biological organization. Week 5: trophic levels. Week 6: energy transfer. Weeks 7–9: measured, balanced/unbalanced forces and free-body diagrams. | 41 |
| 8 | Weeks 4–5: periodic table, electron structure and particle counts. Week 6: land/water distribution. Weeks 7–9: crust, plates and volcanoes (block continues to week 11). | 64 |
| 9 | Week 4: fossils, dating, geologic time and Earth’s interior. Weeks 5–6: small Solar System bodies and meteor showers. Week 7: space technologies. Weeks 8–9: biodiversity and conservation (block continues to week 10). | 75 |
| 10 | Weeks 4–6: traditional/modern biotechnology and debate. Weeks 7–8: climate evidence and greenhouse gases. Week 9: ENSO. | 45 |

¹ Unique selected cards per grade, across this window; not all cards in the library, teaching hours or demonstrated mastery. Cards may be shared between grades. The Grade 5 animal-adaptation runtime lesson is `g5:adaptations:term2`; plant adaptations remain in Term 1.

## What changed

- Replaced broad keyword-only selection in this window with explicit card and question selections in `rag/pipeline/term2-pilot-review.json`. Unselected cards remain in discovery. Other curriculum blocks keep their existing selection rules. Related/reserve cards cannot reintroduce an unreviewed match into these pilot lessons.
- Added 17 trilingual teaching cards with questions: shape-change actions, measurement, graph construction, motion changes, life-cycle comparison, friction investigation, machine trade-offs, water-wave observation, net-force direction, periodic-table history, two element-symbol sets, electron-shell placement, geological dating, space research, climate evidence and dated conservation classification. (The two element-symbol sets count separately.)
- Reworked the existing Grade 3 comparison activity to control variables and avoid attributing changes to size when material/mass also differs.
- Added nine focused questions to existing cards, including rigid/soft classification, stretching/bending, mammal/chicken cycles, wave sources, volcano activity and composition/shape.
- Corrected 11 existing fact bodies and their quizzes in all three languages and the corresponding grounding-bank rows: stored energy versus force; net force versus current motion; sliding friction; fixed/movable pulleys; water-particle motion; main-group valence exceptions; density versus total weight; land ice versus floating ice; outgoing infrared radiation.
- Replaced the misleading graph association on `ffct-24547` with the existing reviewed rise/plateau image. Added a new original distance–time diagram with numeric scales, units and stationary/slow/fast data. It is a small required Metro asset, independent of optional illustration downloads; source SVG and renderer are retained.
- Preserved existing card, fact, lesson and competency IDs. New material uses new `gN-pilot-*` IDs. Pipeline corrections prevent card/quiz regeneration from restoring the repaired claims.

## Review evidence and boundaries

The review read the BOW competency blocks, inspected the leading candidates and attached English questions per slot, then selected explicit examples and added missing activities/assessments. This is a focused curriculum sequence; it is not an exhaustive factual/language review of every reserve or discovery card. The machine-readable report lists the exact selected IDs and per-lesson counts.

Specific rejected matches included cheetah/ostrich speed trivia in graphing; sprint records, trench depth and thunder-delay estimates in equipment measurement; axes-only text counting as stationary motion; launch years substituting for explanations of space research; and undated conservation labels substituting for sourced classification.

Some source statements need scientific qualifications. Grade 5 contact-force direction is taught with initial conditions/net force, rather than asserting that every moving object follows any applied force. Grade 8 shared valence-electron counts are scoped to main groups with helium/transition-metal caveats. Exact BOW wording remains preserved in the reference PDFs.

Keep practical observations distinct from app responses. The app presents procedures and checks reasoning; a teacher must assess actual measurement, graph/diagram construction, investigations and debate. Offline explanatory cards do not make external research references available offline. Native Cebuano/Tagalog review remains required; this pass does not certify fluency.

## Sources and reproducibility

- Original PDFs/text and checksums: `rag/sources/curriculum-guides/three-term-2026/`; official [DepEd BOW index](https://sites.google.com/deped.gov.ph/lsguide/budgets-of-work).
- Scope/decisions: `rag/pipeline/term2-pilot-review.json`; exact changes and selected IDs: `docs/term2-pilot-audit.json`.
- Scientific correction references are attached to each row in `rag/pipeline/pilot-content-corrections.json` (OpenStax, NOAA, USGS). Conservation examples are explicitly dated; [DENR guidebook](https://forestry.denr.gov.ph/fmb_web/wp-content/uploads/2024/11/Guidebook-for-Most-Commonly-Illegally-Poached-Plant-EBOOK_compressed.pdf) and [DENR-hosted species inventory](https://eia.emb.gov.ph/wp-content/uploads/2023/02/TRENTO_ANNEX_2.16.2023.pdf) corroborate the 2017 plant categories.
- Handoff: [Cebuano audit change list](TERM2-PILOT-CEBUANO-HANDOFF.md).

## Validation

- All eight `compile-lessons.py --grade N --check` runs pass with no coverage gaps.
- Grade 3–10 lesson test files pass, including real feed traversal/resume and reserve reachability. The four focused pilot tests pass across 20 seeds per scoped lesson; known graph/measurement false matches remain excluded. Three-term and native-art resolver tests pass.
- Six lesson-variety tests pass after rebuilding the stale similarity artifact from the changed bank/vectors/manifests.
- All selected trilingual bodies and quiz fields are present; exact-substring emphasis, answer bounds and distinct answer options pass. All 11 corrections match the built card, quiz and grounding database rows.
- `build-facts-db.py --check` verifies all 53,022 grounding rows, ordinal alignment, postings and vector metadata. The 33 changed language vectors were refreshed using fp32 LaBSE raw CLS; 159,033 unchanged vectors were preserved. Nine unchanged controls have cosine agreement above 0.99945. Full provenance: `docs/term2-pilot-vector-refresh.json`.
- Tala’s append-only card catalogue check passes. Mobile and website TypeScript checks pass. The website catalogue was regenerated; its freshness check and three-term tests pass.
- New graph PNG visually inspected: labelled axes, units, numeric scales and data match the card. `git diff --check` passes (LFS clean filter disabled for the read-only check).

No APK, release or deployment is part of this change. The formal model regression gate/device checks are release prerequisites, not claimed results of this content audit.

## Pre-build follow-up

The mandatory model gate exposed a separate photosynthesis grounding defect: `chloroplast-organelle-closeup-g7` described food as made from sunlight. The grounding-only correction now separates light energy from water/carbon-dioxide inputs in all three languages. This adds one corrected fact (three refreshed vectors) beyond the 11 card/quiz corrections above. See `term2-pilot-photosynthesis-vector-refresh.json` and the Cebuano handoff. The gate also required refreshing the assessment registry and explicitly recording the legitimate science term “Elastic potential energy” in the translation checker. Native build evidence is recorded separately.
