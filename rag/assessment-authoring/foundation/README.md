# Incoming Grade 3 foundation source catalogue

This separate evaluation scope contains 72 draft items across four domains. It
samples earlier learning anchored to selected competencies in the **May 2016
Kindergarten curriculum guide**. Student grade is 3; source material grade is 0.
It is not an invented Grade 2 Science curriculum or a complete Grade 2 Makabansa
crosswalk. Individual classroom coverage remains unverified.

`catalogue.json` pins the official source PDF and extracted text by SHA-256. Its
anchors retain the exact printed code **and page**: some codes are reused in the
guide, so a code alone is insufficient. Its target ledger records the narrow
claims, source anchors and shared knowledge families. `blueprint.json` explicitly
lists admitted items, six provisional benchmark constructs and the first form.

`living-materials.json` and `movement-surroundings.json` are the authored trilingual
records. Their Markdown companions support human review. Source-card snapshots
and literal excerpts are checked against the current card pool in every language;
an unlinked question receives no recent-card eligibility. Direct diagram claims
use claim-specific provenance IDs, never a shared curriculum-document fact ID.

Run the separate gate before regenerating the offline bank:

```sh
python3 tools/assessment-evaluation/review-foundation.py --render
python3 packages/mobile/scripts/build-assessment-bank.py
python3 packages/tala/scripts/build-assessment-catalog.py
```

The source gate checks the complete assigned pool, exact curriculum anchors,
translations/options, holds, source snapshots, diagram answer consistency,
explicit item admission and first-form family/source independence. Its 27
known-bad mutations exercise those checks; they do not establish semantic
accuracy, fluent language, calibrated forms or individual teaching coverage.
Claim, family or anchor changes require reviewing the corresponding target-ledger
entry, rather than silently accepting a changed author record.

`validation.json` and `REVIEW.md` are generated review artifacts. All items remain
production-disabled. Teacher, native-language and intended-age learner reviews
remain pending. The historical Grade 3–10 batches and ledger are separate and
unchanged. Tala's append-only `../catalogue-history/` retains exact old claim maps
so saved results can still be interpreted using their original bank version.
