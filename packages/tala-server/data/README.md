# Tala curriculum data — source status

This is a starter catalogue, **not the V1.0 curriculum-completeness gate**.

## Included

`packs/` contains 322 extracted Science competencies: Grade 3 (34), 4 (33), 5 (40),
6 (35), 7 (45), 8 (44), 9 (46), 10 (45). These are extracted directly from the
archived DepEd **2026 Three-Term Budgets of Work for Learning Competencies** PDFs,
including term-level content and performance standards. Each competency records
the source document, edition, URL and **1-based physical PDF page** on which its
text starts. Printed footer numbers can differ (the PDFs have an extra leading
page); some competencies continue onto the following physical page.
`science-provenance.json` records the upstream archive paths, SHA-256 hashes,
source links and per-term counts. The extractor joins layout whitespace, preserves
source wording/capitalisation/punctuation, and removes only bullets, week-column
labels and page furniture. No model-authored competencies are included.

The records remain teacher-self-checkable, not staff certified. Apparent source
oddities (for example a repeated category or lowercase initial verb) are preserved.
Official competency codes are null: the older `G4-M-1`-style identifiers are local
Hiraia identifiers, not official DepEd codes. Weights are equal and **estimated**;
a multi-competency week range is not misrepresented as an official individual weight.

Version `science-bow-2026` is mapped to `2026-2027`, following the repository's
2026 three-term schedule and dated source archive. It is **not** asserted to apply
to `2027-2028`; `versionFor` returns null for that year until current applicability
is established. Previously tagged versions remain individually addressable.

## Reference assessment

- `docs/grade*-subcategory-crosswalk.json`: local mappings, not official text.
- `docs/GRADE*-CURRICULUM-AUDIT.md` and the Grades 3–10 summary: local audit reports,
  useful provenance leads, not source documents for competency text.
- `packages/shared/src/curriculum/`: domain/scheduling metadata and the 2026 BOW
  source manifest, not a complete verbatim competency bank.
- `packages/web/scripts/build-competencies.mjs`: publishes authored student lessons;
  its output is not a teacher curriculum guide. Its source references led to the
  archived PDFs used here.
- The older `matatag-*-competencies.json` extracts were inspected as cross-checks,
  but their text is not copied into these packs or silently relabelled as 2026 text.

## Rebuild and verify

From this worktree, with Python 3 and `pypdf` available:

```sh
python3 packages/tala-server/scripts/curriculum/import_science.py --reference-root /home/b11/code/hiraia
python3 packages/tala-server/scripts/curriculum/import_science.py --reference-root /home/b11/code/hiraia --check
python3 packages/tala-server/scripts/curriculum/build-fixtures.py
pnpm --filter @hiraia/tala-server type-check
pnpm --filter @hiraia/tala-server test
```

The reference checkout is read-only. Changed PDF hashes stop the importer. Review
extraction changes, bump dataRevision, and preserve published competency identities
before publishing updates. No publication is performed by these scripts. Pack
`bytes` is the exact UTF-8 file size. Server startup validates identity, count,
bytes, source fields and all contract schemas.

## Fixtures and calendars

`fixtures/` has synthetic Mathematics packs for Grades **2, 3, 4, 5**, supporting
both the G2+G4 demo and four-group tests. Every competency begins `SAMPLE DATA ONLY`,
and every version begins `fixture-`. The curriculum module includes them automatically in local and staging environments.
Production excludes them from the index, pack routes and curriculum service, even
if the old `includeFixtures` option is supplied. Direct `loadCurriculumData()`
still defaults to real packs only. Apps must mark the associated class
`isSample: true`; the shared `buildSampleClass` factory does this. These are not a curriculum claim.

`calendars/deped-2026-2027.json` and `deped-2027-2028.json` are both
`provisional: true`. Dates are editable **sample defaults**, not dates copied from
a verified DepEd order. No holidays/exams have been invented. Obtain and cite each
year's official school-calendar order, then replace the sample dates and empty day
list through a versioned data update. The three-term structure follows the locally
archived 2026 Science BOW, not an assumed four-quarter calendar.

## Official guides still needed for the V1.0 scope (§6.3.1)

Each listed grade × area needs the applicable official guide/BOW, edition and page
extraction. The PRD labels the area/rollout list **verify**; confirm the scope against
current orders before claiming coverage. Only the Science 2026 BOW rows above exist.

| Grade(s) | Guides still to obtain and extract |
| --- | --- |
| K | Kindergarten curriculum |
| 1 | Language; Reading and Literacy; Mathematics; Makabansa; GMRC |
| 2 | Language; Reading and Literacy; Mathematics; Makabansa; GMRC; Filipino; English |
| 3 | Language; Reading and Literacy; Mathematics; Makabansa; GMRC; Filipino; English |
| 4, 5, 6 (each) | Filipino; English; Mathematics; Araling Panlipunan; Music and Arts; Physical Education and Health; EPP/TLE; GMRC/Values Education |
| 7, 8, 9, 10 (each) | Filipino; English; Mathematics; Araling Panlipunan; Music and Arts; Physical Education and Health; EPP/TLE; GMRC/Values Education |
| 11 and 12 (each, core only) | Effective Communication / Mabisang Komunikasyon; Life and Career Skills; General Mathematics; General Science; Pag-aaral ng Kasaysayan at Lipunang Pilipino — confirm the strengthened SHS core set actually in force |
| 3–10 Science for 2027–2028 (each) | Obtain the applicable guide/order or verified carry-forward of the archived 2026 BOW; extract any changes and retain the old version |

Also outstanding: verify the 2026–2027 grade rollout against official orders,
verify the 2027–2028 rollout, official calendar orders for both years, official
individual time allotments if supplied, and cross-version competency mappings when
new guides arrive. Unloaded combinations use the PRD's own-objectives fallback;
fixture availability must never be counted as official coverage.
