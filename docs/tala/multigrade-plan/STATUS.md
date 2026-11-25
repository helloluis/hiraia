# One plan for a multi-grade class: status

**As of 23 Nov 2026.** What it is, how it works and the evidence: [README.md](README.md).

| | |
|---|---|
| State | **Built and tested as a preview. Not committed, not pushed, not deployed.** |
| Where | Worktree `/home/debian/code/tala-wt/uploads` on b11-002, local branch `tala-v1-teacher-uploads` |
| On top of | `tala-v1-demo.13` (`6ebaf2c96`), what tala.hiraia.org runs |
| Owner | The agent session that built it. The teacher-uploads lane ("My own slides") lives in the same worktree and is separate: either can be released without the other |
| Production | Untouched. Release is the release owner's (b11-dev); hand-over is by patch against `6ebaf2c96` |

## Done and checked

- Combining two to four grades' lessons into one session on the multi-grade template; rules that keep it teachable.
- The screen to choose class, subject, day and each grade's lesson; the combined plan is a private draft edited and
  saved in the ordinary lesson editor.
- Table print layout on A4 and long bond; a page ending that cannot leave the footer alone.
- Editable Word export with real text and tables, made on the device.
- English strings; Filipino strings with the Filipino owner's editorial pass.
- Tests and evidence as listed in the README (25 new unit and sync tests; 274 file checks; 18-step browser walk
  with real pack lessons; 21 checks of the walk's own files).

## Open before production

1. **Filipino: editorial pass done, teacher review open.** The Filipino owner revised
   `packages/tala-web/src/i18n/parts/combine.fil.ts` and the Filipino halves of
   `packages/tala-core/src/plan/combine-words.ts` and `packages/tala-core/src/print/table.ts` on 23 Nov (28 of 58
   values changed; keys, placeholders and English untouched). The files are taken in exactly as handed over and
   keep their draft header, because review by a Filipino-speaking teacher has not happened.
2. **Hand check of a Word file in real Word, Google Docs and WPS** (none is on the build machine). Sample files are
   in the hand-over.
3. **Permission to commit.** Nothing is committed: the standing rule is to commit only when Luis asks.

Decisions for Luis (`waiting_for_user`):

- *Can someone open a sample combined plan (.docx) in Microsoft Word on a computer and on a phone, in Google Docs
  and in WPS Office, and say whether it opens without a repair message and the tables can be typed into?*
- *May this work be committed on the local branch `tala-v1-teacher-uploads`?*

## Known limits

- Sources are the teacher's saved lessons (her own or pack days added to the class). There is no step that fetches
  a pack day from the Library inside the combine screen: she adds the pack to the class first, as today.
- The order of the teacher's turns is youngest grade first; she can reorder blocks in the editor, but the combine
  screen has no order control.
- The server-made PDF fallback prints the list layout only, so it is hidden while the table is chosen.
- The Word file has no pictures (plans have none) and no DRAFT watermark; it says DRAFT in words.
- A session note is limited to 600 characters by the plan format; the note drops the list of source lessons before
  it would be cut.
- The plan's title names each grade's lesson ("Day 1 · Grade 4: … · Grade 5: …"; a label all the lessons share is
  said once). With long lesson titles it runs past the three lines the editor's title box shows; the box then
  scrolls, and she can shorten the title. The print page and the file name are not affected.
- The print sheet says the Word file is in the format Word, WPS Office and Google Docs use. That it opens cleanly
  in each of them is what the hand check is for.

## Shared files touched

| File | Change |
|---|---|
| `packages/tala-core/package.json` | one export entry (`./docx`) |
| `packages/tala-core/src/plan/index.ts` | re-exports the combining functions |
| `packages/tala-core/src/print/index.ts` | `layout` option, references, table branches, the page ending, exports for the Word writer |
| `packages/tala-core/src/print/snapshots/*.html` | one line each: the page ending |
| `packages/tala-web/src/data/print.ts` | Word download helpers |
| `packages/tala-web/src/features/editor/PdfSheet.tsx`, `PrintPage.tsx` | layout choice, Word button, `layout` in the print page's address |
| `packages/tala-web/src/features/lessons/LessonsScreen.tsx` | the entry link |
| `packages/tala-web/src/i18n/en.ts`, `fil.ts` | one import and one spread each |

`package.json`, `en.ts` and `fil.ts` are also touched by the teacher-uploads lane (its own lines). The hand-over
has a patch for each lane alone and one for both.
