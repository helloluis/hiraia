# ADR-0001 — Curriculum pack format: keep everything the source says, version the format

Status: accepted (2026-11-14, Luis: "make decisions that allow the maximum amount of flexibility").
Owner: orchestrator. Contract: `packages/tala-core/src/contracts/curriculum.ts`.

## Context

Tala's curriculum data started as eight Science packs. The harvest of every DepEd 2026 Three-Term Budget of
Work (grades 2–10, then senior high) showed that subjects do not share one shape: some place competencies in
weeks, some only in terms; some print topic headings, some only strands; some print day allotments, tick
columns, or parent competencies with lettered sub-items; English is a cross-grade grid. The selector, pacing,
the lesson generator and later retrieval will all build on this data, and DepEd revises these documents yearly.

## Decisions

1. **Source wording is never rewritten.** `text` is the complete competency exactly as printed (layout
   whitespace joined; U+200B, U+FEFF and U+00AD removed). Source typos stay. No model writes or edits it (CUR-6).
2. **Official and derived labels live side by side.** `officialHeading` holds the printed theme/topic heading
   verbatim and untruncated. `shortTitle` is the 1–4 word display label; `shortTitleSource` says whether it is
   official or derived; `shortTitleDerivation` records method, rule-table id@version and the wording it was
   derived from. A derived title can therefore always be regenerated, audited or replaced without re-parsing.
3. **Structure is preserved, not flattened.** Separate fields for: learning area, grade, term, weeks
   (`weekFrom`/`weekTo`, absent when the source gives none), `domain` (strand/theme), `component` (part of a
   combined area such as MAPEH or EPP/TLE), `code` (official code where one exists), `parts` (lettered
   sub-items, addressable; `text` still contains them), `allottedDays`, `tags` (printed classification marks
   such as Filipino macro-skill columns), `contentStandard`, `performanceStandard`.
4. **Missing means missing.** Nothing is inferred to fill a gap: no invented weeks, standards, codes or
   headings. Pack-level `placement` ('week' | 'term') tells consumers which to expect; the selector shows
   "Term N" without a week for term-level subjects.
5. **Every entry is traceable.** `source` carries document title as printed, edition, page (and `pageTo`), URL
   and the SHA-256 of the archived file; the pack lists its `sourceDocuments`. `sourceRowId` links entries that
   come from one printed row (grid documents where a row applies to several terms).
6. **Editions never overwrite.** A pack is identified by `<curriculumVersion>:<grade>:<learningAreaId>` and
   competency ids embed the curriculum version, so a new DepEd edition is a new set of packs with new ids
   (`supersedes` points at the old one). Old plans keep resolving against the edition they were written with.
   `dataRevision` is only for corrections to the same edition.
7. **The format itself is versioned.** `formatVersion` (absent = 1). New fields are optional and additive;
   readers ignore unknown optional fields; a breaking change bumps the number and old packs are not migrated.
   Packs produced under this ADR are `formatVersion: 2`.
8. **Combined subjects stay as DepEd publishes them.** MAPEH is one learning area with two components; EPP/TLE
   keeps DepEd's two documents per grade as two learning areas. Splitting further is a display choice, made
   from `component`, not a data change.
9. **Selector entries are derived, not stored.** A topic unit (term, weeks, title, title source, group,
   competency ids) is computed from the pack by one shared function in `tala-core`, so web, mobile and server
   cannot disagree and no second dataset can drift from the packs.
10. **Verification is part of the format.** A pack is acceptable only if every competency is found in its
    source page text, counts reconcile with the document's own rows, and exclusions are listed with reasons
    (`data/REVIEW-<area>.md`). Documents that cannot be parsed reliably are left out, never approximated.

11. **Units the source does not pin to a school term keep that freedom.** Elective sequences (Grade 9–10 TLE
    sectors "studied for one term", Grade 12 electives) carry pack-level `scheduling` with
    `termAssignment: 'teacher_selected'`, their stated duration, every eligible grade and the source sentence.
    Inside such a pack `termIndex` is the position within the unit, not a school term, and weeks are relative.
    A document shared by two grades yields one pack per grade with identical entries and shared
    `sourceRowId`s — two views of one source, not two curricula. Nothing is assigned to "Term 1" by default
    and nothing is copied across all three terms.
12. **Problems in the source are recorded, not repaired.** `sourceIssues` lists contradictions and apparent
    editorial errors in a DepEd document (page-referenced). The text is still extracted exactly as printed.
13. **Names travel with the data.** A pack may carry `areaName` and `areaKind` (core / elective), so new
    learning areas need no code change to be listed.

## Consequences

- Packs are larger and carry fields some subjects never use; consumers must treat all of them as optional.
- Derived titles need rule tables per subject and a human review sample; they are cheap to redo.
- Standing gaps are explicit: DepEd publishes no Science below Grade 3 (Kindergarten, Grade 1 and Grade 2 have
  none). Kindergarten and Grade 1 Budgets of Work exist on a combined page
  (`…/lsguide/budgets-of-work/kindergarten-and-grade-1`) and are part of the source set; Kindergarten is
  organised by theme and subtheme, not by subject.
