# Assessment authoring handover — 28 September 2026

**638 questions in 33 batches; 1,914 English, Tagalog and Cebuano versions.** This completes the selected-blueprint drafting pass, not classroom validation or full curriculum coverage.

Origins: **43 exact reuses, 577 revisions, 14 alternate forms, 4 entirely new questions**. Five held questions are excluded. The other 633 remain `source_checked` drafts; zero are marked production-ready or pilot-approved.

The earlier estimate of about 800 new questions was a provisional planning allowance. Existing questions supplied most selected targets after revision. This result does not establish a final generation requirement for all topics or ordinary recent-card coverage.

| Material grade | Drafts | Held | Knowledge families |
|---|---:|---:|---:|
| 3 | 76 | 2 | 67 |
| 4 | 80 | 1 | 72 |
| 5 | 80 | 1 | 74 |
| 6 | 82 | 1 | 76 |
| 7 | 80 | 0 | 69 |
| 8 | 80 | 0 | 73 |
| 9 | 80 | 0 | 71 |
| 10 | 80 | 0 | 72 |

## What the evidence supports

- Every selected item has pinned teaching/bank provenance, one scored claim, three language versions, stable options and a review record. Existing source errors were narrowed away or held rather than copied into assessed claims.
- All 33 batches pass 25 mechanical controls each. The combined pool passes nine controls with no exact content duplicates. These checks do not certify science, language fluency or item difficulty.
- Seven incoming-grade blueprints (Grades 4–10) pass eight constructed fortnight follow-ups each, with twelve unique families/source identities, six benchmark and six recent items, no repeated whole paper, and at most two exact repeats from the preceding three forms. The old failing Grade 4 proposal is retained as negative evidence.
- All 159 full-form scenario/link checks pass, including sparse exposure, missing or altered teaching-text hashes, language, date boundaries, holds, unknown curriculum and exhausted pools. Synthetic cohort confirmation is a test input, not a verified learner record.
- Separate agents reviewed 100 Grade 9/10 items and primary teaching snapshots in all three languages. Twenty items were repaired during integration. This is independent model review, not native-speaker or teacher approval.

## What remains unresolved

- Non-held drafts sample narrow recall in **212/335 subcategories** and **291/324 internal competency mappings**. These are supporting-knowledge links, not full performance-competency assessments. See the two authored-coverage CSVs.
- Only **642/49,156** core cards have accepted non-held assessment links. Only **9/308** actual lesson shelves even reach a six-family upper bound if every card is encountered. Typical fortnight histories are unmeasured. Do not promise six recent questions after ordinary usage.
- When fewer recent facts qualify, count the actual recent denominator and label prior-level supplements separately. Defer when twelve items cannot meet the rules. Extra question stems alone will not fix missing teaching-card links.
- Incoming Grade 3 has no approved earlier-learning bridge. Keep its onboarding assessment unavailable; do not call Grade 3 material a Grade 2 exam.
- Cohort-specific published curriculum matching, native/teacher review, student response calibration and broader exposure coverage remain pending. Source-card defects are documented separately and were not repaired in the shipping bank by this authoring pass.
- Single 12-item scores and changing recent-content scores cannot prove a causal effect or justify changing the child’s enrolled grade. Keep benchmark, recent, supplementary and repeated-item evidence distinct.

## Authorized app integration

At 17:27 GMT+8 the user authorized a new 12-item assessment flow alongside existing mini-quizzes, based on the already merged 0.4.26 work, followed by a signed APK copy to the connected Redmi over USB. No card-mini-quiz replacement bank was produced.

The first USB artifact is explicitly a **local assessment evaluation build**. Its opt-in flag may expose non-held source-checked drafts as a Hiraia prior-level practice baseline; records retain unverified cohort and review status. This does not change the production bank’s gates or claim formal MATATAG readiness. Production defaults remain gated. App implementation, runtime tests, signing and transfer have their own completion record.

## Files and reproduction

- [Question design plan](../../docs/ASSESSMENT-QUESTION-DESIGN-PLAN-20260928.md)
- [Target ledger](targets.md) and [structured ledger](targets.json)
- [Authored subcategory coverage](authored-subcategories.csv) and [competency coverage](authored-competencies.csv)
- [Pool checks](pool-review.md), [full-form simulations](form-simulation.md), [lesson-link coverage](exposure-link-audit.md)
- [Peer-review resolutions](reviews/peer-review-resolutions-20260928.md) and [source repair notes](source-repair-notes.md)
- [Machine-readable summary and input hashes](authoring-summary.json)

Run each batch through `review-authoring.py --batch <path> --render` sequentially, then `simulate-forms.py`, `review-pool.py`, `audit-exposure-links.py`, and `summarize-authoring.py` in `tools/assessment-evaluation/`.
