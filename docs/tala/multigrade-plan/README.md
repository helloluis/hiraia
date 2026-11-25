# One plan for a multi-grade class (preview, 23 Nov 2026)

The brief, in short: a multi-grade teacher needs one printable lesson plan that combines the lessons of her grades,
and it must be an editable document so she can revise it before printing. This is built on top of what
tala.hiraia.org runs (`tala-v1-demo.13`, `6ebaf2c96`). It is not deployed. State and open decisions:
[STATUS.md](STATUS.md).

## What a teacher does

1. **Lessons → Combine lessons for a multi-grade class.** The entry shows when one of her classes has two or more
   grades.
2. **She chooses the class, the subject and the day.** For each grade Tala offers her saved lessons of that grade
   (her own, or the days of a teaching pack she added from the Library) and pre-selects the one placed on that day.
   A grade with no lesson yet can be left for her to write.
3. **Make the combined plan.** One private draft opens in the ordinary lesson editor. Every box can be changed and
   is saved and synced like any other plan. Her own lessons are not changed.
4. **More → Download PDF** now also has: the paper (A4 or long bond, 8.5 × 13 in), the layout of a multi-grade plan
   (table, or the list it had before), and **Download as Word (.docx)**.

## How the lessons become one plan

It is not the lessons printed one after another: she is one person in one room. `combineLessons`
(`packages/tala-core/src/plan/combine.ts`) builds one session on the existing multi-grade template
(`tpl.multigrade.v1`):

- **Start together** and **Finish together**: whole-room blocks at each end (5 minutes each in a 45-minute period).
- **One turn with the teacher per grade** in between, the youngest grade first (it can wait alone least); she can
  reorder the blocks in the editor. A grade that is waiting first works alone (reads today's goal, gets its
  materials ready), then in pairs; a grade that has had its turn carries on with the lesson's own activity and its
  exit ticket.
- **Minutes always add up to the period exactly**, for two to four grades. A turn under 8 minutes is said plainly,
  on the screen before she makes the plan and in the plan's note.
- **Objectives, materials and assessment stay per grade**, side by side.
- **Curriculum references travel with each grade**; the plan is marked an AI draft while any lesson it was made
  from is one; the lessons it came from are named in the note.
- **No word of a lesson is reworded.** Every word in the result is the lesson's own or one of the short
  instructions in `combine-words.ts`. There is no model and no connection involved: the same lessons always give
  the same plan, and it works offline.

`checkSessionFlow` holds the result (and the teacher's later edits) to the rules a session must keep to be
teachable by one teacher: the blocks fill the period, she is with one group at a time, a group taught directly has
her.

## Printing

The print page gained a **table layout** for multi-grade plans (`layout: 'table'` in
`packages/tala-core/src/print`): one row per time block, one column per grade, a column that says who the teacher
is with, a heavier edge on the box of the grade she is teaching, and each competency with its source document,
edition and page. Per-grade sections are set side by side.

- A4 and long bond, portrait for two grades and landscape for three or four (as before).
- The table's heading row repeats on every page; a time block is not cut across pages when it fits on one.
- The page now ends with one block that cannot be split (signature lines and footer), so the footer is never left
  alone on a last sheet. This applies to every plan's print, not only multi-grade ones.
- The table is the default for a multi-grade plan in the print sheet; "List" gives the layout it had before.
- The server-made PDF (the last fallback in the sheet) knows only the list layout, so it is not offered while the
  table is chosen. "Save as PDF" in the browser and the plain page give the table.

## The Word file

`packages/tala-core/src/docx` writes a real `.docx` on the teacher's device (also offline): paragraphs, bulleted
and numbered lists, and tables she can type into, with the same parts in the same order as the print page. A
multi-grade plan is the same table. Page size and orientation follow the paper chosen. It has no dependency and
the same plan always gives the same bytes. It works for every kind of plan, not only combined ones.

It does not carry the Hiraia mark as a picture or the large DRAFT watermark: a draft says DRAFT in words at the
top, which she can delete when the plan is final.

## Evidence (re-runnable; numbers from 23 Nov 2026)

| Check | Result |
|---|---|
| Combining: two, three and four grades, short and long periods, Filipino, a grade left empty, a teacher's edits held to the same rules (`combine.test.ts`) | 12 tests pass |
| Word export: valid package, well-formed parts, table shape, references, draft labels, Filipino, awkward characters, every plan template (`docx.test.ts`) | 8 tests pass |
| Choosing lessons, combining saved lessons, and **persistence through the real sync engine and server**: the plan reaches a second device, an edit made there comes back, and print and Word carry it (`combine-model.test.ts`) | 5 tests pass |
| 8 generated cases (2, 3, 4 grades; English and Filipino; A4 and long bond; long lessons; a teacher's edit) judged by python-docx, LibreOffice and pypdf (`multigrade-evidence.mjs`, `multigrade-evidence-check.py`) | 274 of 274 checks: the Word file opens in both readers at the right paper size with the right table; a copy edited with python-docx saves and reopens; the printed PDF has every word, the heading row on every page of the table, no time block cut, signatures on the last page |
| Footer never alone on the last sheet: 101 page-fill positions each on A4 portrait and long-bond landscape | 0 of 202 |
| Real browser, real pack lessons (Grade 4 "Muscles and Bones", Grade 5 "What Typhoons Do to Our Communities"), desktop, phone and Filipino (`multigrade-walk.mjs`) | 18 of 18 checks: lessons of the day pre-selected, one draft in the editor, an edit kept after reload and on a second device, source lessons unchanged, Word downloaded, print on A4 and long bond, three grades with one left empty |
| The walk's own Word download and PDFs judged by python-docx, LibreOffice and pypdf (`multigrade-walk-verify.py`) | 21 of 21 checks |
| All tests on `tala-v1-demo.13` with both lanes applied | core 291, server 299 (+1 opt-in), web 94; type-checks and production build clean |

**Not checked:** opening the Word file in Microsoft Word, Google Docs or WPS Office (none is on the build machine;
python-docx and LibreOffice are the two independent readers used), and printing on a real printer.

## Where things are

| | |
|---|---|
| Combining (pure) | `packages/tala-core/src/plan/combine.ts`, `combine-words.ts`, `combine-fixtures.ts`, `combine.test.ts` |
| Table print layout | `packages/tala-core/src/print/table.ts`; `layout` option, references and page ending in `print/index.ts` |
| Word export (pure) | `packages/tala-core/src/docx/index.ts`, `zip.ts`, `docx.test.ts`; entry point `@hiraia/tala-core/docx` |
| Screen | `packages/tala-web/src/features/lessons/CombineScreen.tsx`, `combine-model.ts` (+ test); route `/lessons/combine`; entry in `LessonsScreen.tsx` |
| Print sheet | `packages/tala-web/src/features/editor/PdfSheet.tsx`, `PrintPage.tsx`, `src/data/print.ts` |
| Strings | `packages/tala-web/src/i18n/parts/combine.en.ts`, `combine.fil.ts` (Filipino has had the Filipino owner's editorial pass; teacher review is open) |
| Evidence tools | `packages/tala-web/scripts/multigrade-evidence.mjs`, `multigrade-evidence-check.py`, `multigrade-walk.mjs`, `multigrade-walk-verify.py`; `packages/tala-core/scripts/print-snapshots.mts` |

No migration, no new dependency, no new setting, no server route, nothing spawned.

## Running the evidence

```bash
# from packages/tala-web
PLAYWRIGHT_PATH=… CHROMIUM_PATH=… pnpm exec tsx scripts/multigrade-evidence.mjs <outDir>
python scripts/multigrade-evidence-check.py <outDir> --soffice /path/to/soffice.bin --out <outDir>/check.json

# against a running local server (creates one fictional teacher through the real API)
PLAYWRIGHT_PATH=… CHROMIUM_PATH=… pnpm exec tsx scripts/multigrade-walk.mjs http://127.0.0.1:3411 <outDir> --db <TALA_DB_PATH>
python scripts/multigrade-walk-verify.py <outDir> --soffice /path/to/soffice.bin
```

A server whose public origin is https gives its session cookie to a browser only over https: pass
`--browser-base https://…` for the browser part.

## What this changes for plans that already exist

- Every plan's print page ends with the unsplittable block described above (three print snapshots changed by one
  line each).
- A multi-grade plan's print sheet opens with the table layout chosen; "List" is one tap away.
- Every plan's print sheet has "Download as Word (.docx)".
