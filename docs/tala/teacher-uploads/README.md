# My own slides: a teacher's PowerPoint file, edited in Tala (preview, 21 Nov 2026)

The brief, in short: a teacher should be able to bring her own slides or slide templates into Tala and edit them
there, and we had to find a straightforward way to edit a PowerPoint file. This is a preview on the branch
`tala-v1-teacher-uploads`, on top of what tala.hiraia.org runs (`tala-v1-demo.13`, `6ebaf2c96`; first built on
`tala-v1-demo.11` and moved over twice without conflicts). It is not deployed. State,
open decisions and who owns what are in [STATUS.md](STATUS.md).

## What a teacher can do

1. **Library → "Your own slides" → Upload a PowerPoint file.** `.pptx`, `.potx` (template) or `.ppsx` (slide show),
   up to 30 MB. The file travels in small pieces, so a dropped connection carries on where it stopped.
2. **See what Tala will and will not touch.** The editor opens with one sentence ("7 slides in the file. You can
   edit the text in 26 places on the slides.") and a list of what is in the file that Tala only carries along: charts, SmartArt,
   animations, transitions, videos, sounds, embedded files, hidden slides, comments, embedded fonts.
3. **Change the words.** Every title, text box and table cell is a plain field beside a picture of the slide.
   Clicking words on the picture jumps to their field. New words take the look of the words they replace. Teacher
   notes are the slide's speaker notes.
4. **Change the slides.** Move earlier or later, copy, remove, put a removed slide back, put a changed slide back
   as uploaded, undo and redo.
5. **Download** her file with her changes written in, or the file she uploaded, untouched. **Delete** removes both
   from Tala.

Everything saves by itself about a second after she stops typing; a failed save keeps the work on the device and
says so. Where the server is set up to draw slides, the picture follows the words a few seconds after a save.
Only the signed-in owner can see, change, download or delete an upload. There is no sharing.

## What it does not do, and says so

- It does not redesign. Fonts, colours, sizes and positions stay as they are in the file. There is no adding of
  new slides from nothing, new text boxes or new pictures, and no bold/colour controls.
- A slide that holds a chart, a SmartArt diagram or an embedded file cannot be **copied** yet (it can be edited,
  moved and removed). The screen says so on that slide.
- Text that fills itself in (dates, slide numbers) and maths are shown but not editable.
- Notes cannot be added to a file that has no notes master (the screen says so). Common in files not made in
  PowerPoint.
- A template or a slide show is downloaded as an ordinary presentation that opens for editing.
- Refused, each with its own plain sentence in English and Filipino: old `.ppt`, password-protected files, files
  with macros (`.pptm` or disguised as `.pptx`), ActiveX, "Strict Open XML", digitally signed files, damaged or
  truncated files, files that are not PowerPoint at all, files over the limits.

## How a PowerPoint file is edited: keep the file, patch only what she changed

The uploaded file is the source of truth and is never modified. It is stored exactly as it arrived (its SHA-256 is
checked on arrival and it is served back byte for byte). The teacher's version is a small list of **differences**
beside it: slide order, which slides are copies, changed paragraphs per text block, changed notes.

A download is made from the two each time (`writeEditedDeck`):

- Every part of the file she did not change (pictures, charts and their workbooks, themes, masters, layouts, fonts,
  media, unknown extensions) is carried over as **the very bytes stored in the uploaded archive**: still compressed,
  same checksum. Nothing is re-encoded, so nothing can be flattened.
- A changed slide is the uploaded slide's own XML with splices: only the text runs that changed are rewritten, by
  common prefix/suffix, so the formatting of unchanged words and of the words around an edit stays. Paragraph
  properties (bullets, indent, alignment) stay with their paragraph; an added line takes the previous line's.
- Reordering, copying and removing slides rewrite the slide list, relationships, content types, sections and custom
  shows. A removed slide's own parts are dropped only when nothing else still uses them.
- The reader (`packages/tala-core/src/pptx`) is our own small, strict one: no DTDs or external entities, hard
  limits on sizes and counts, no dependency. It keeps byte offsets so a splice never reformats the rest.

With no edit at all the download has exactly the uploaded parts, byte for byte (a template or slide show differs in
the one part that names the kind of file, because it is downloaded as a presentation). Changing the words of one
slide changes one part.

## The comparison we were asked for: extend our editor, or embed an established one?

Measured on the same 84 real files, with no edit made at all:

| | Patch in place (this branch) | LibreOffice open-and-save (the engine inside Collabora Online) |
|---|---|---|
| Files where every part comes back byte-identical | **82 of 82 presentations**; the template and the slide-show file differ only in the one part that names the kind of file | 0 of 84 |
| Parts byte-identical afterwards | **5,614 of 5,616** | 240 of 5,616 |
| Parts dropped | 0 | 611 |
| Slides that draw differently afterwards | 0 of 527 | 391 of 527 (73 by more than 1 % of the picture) |

The second column is `scripts/decks/pptx-roundtrip-lo.py`: LibreOffice 26.8 opens each file and saves it as .pptx,
then the original and the saved file are both drawn by the same LibreOffice and compared. What that round trip did
to the parts teachers care about, with no edit made:

| Kind of part | In the 84 files | Byte-identical after | Rewritten | Dropped |
|---|---|---|---|---|
| Slides | 527 | 0 | 527 | 0 |
| Slide layouts | 1,102 | 0 | 1,102 | 0 |
| Pictures and media | 233 | 180 | 17 | 36 |
| Charts | 34 | 0 | 24 | 10 |
| Embedded files (mostly the charts' data) | 40 | 19 | 0 | 21 |
| SmartArt diagram parts | 90 | 0 | 70 | 20 |
| Notes pages | 249 | 0 | 210 | 39 |
| Embedded fonts | 6 | 0 | 0 | 6 |
| Handout masters | 15 | 0 | 0 | 15 |

Not every dropped part is a visible loss (some are unused leftovers), and this is not a criticism of LibreOffice: an
office suite imports a file into its own model and writes a new file from it. It is the reason an embedded suite
cannot promise "everything you did not change is exactly as you uploaded it".

Other facts that decided it (sources and quotes in the research notes, fetched 20 Nov 2026):

| Option | What stops it for Tala today |
|---|---|
| ONLYOFFICE Docs (Community) | AGPL v3. **Mobile web editing is view-only** in the open-source edition (commercial builds only), and most of our teachers are on phones. Needs its own server (2 GB RAM minimum). Paid Developer Edition is quote-only from 250 connections. |
| Collabora Online (CODE) | MPL; edits on mobile browsers; but regenerates the file (table above), needs a separate always-on server (1 GB + 50 MB per concurrent user, a dedicated VM advised), needs an uninterrupted connection, and CODE is "not recommended for production". The Android app is 179–243 MB against our 40 MB budget. |
| Microsoft 365 for the web | Only for cloud-storage vendors in Microsoft's partner programme; every editing user needs a Microsoft 365 licence. |
| Google Slides | Import/export through Drive: charts and videos become pictures, SmartArt becomes drawings, exports are capped at 10 MB, and it needs Google accounts and a restricted-scope review. |
| Open-source in-browser editors (PPTist, Univer-based) | They rebuild the file from their own model on export (PPTist itself states about 85 % import fidelity). Newer patch-in-place projects exist (PPTXjs v2, ooxml, pptx-editor) but appeared this month and are unproven. |

**Decision taken for this preview:** extend our own editor with patch-in-place. It is the only route that keeps a
teacher's file intact, works on a phone, adds no server to run and no licence to buy, and keeps working inside the
offline apps later (the engine is pure TypeScript). **What it gives up:** free-form editing (moving things, new
shapes, formatting). If teachers ask for that, the same stored original can be handed to an embedded suite as an
optional "open in a full editor" later; nothing here prevents it.

## Pictures of the slides

A real picture of each slide is drawn by LibreOffice **in a sandboxed drawing service, and only there**. It is off
unless a server is told where the service's socket is (`TALA_DECKS_PREVIEW_SOCKET`). With it, the editor shows the
slide as PowerPoint-compatible software draws it, and redraws it a few seconds after a save. Without it, or when
the service is stopped, busy for too long, killed or not the sandbox it must be, the editor shows each slide as its
text boxes in their places, and everything else works the same.

Outlines on the picture come from the geometry stored in the file (own, layout or master placeholder; group
transforms; table grids). Where the renderer wraps text differently from PowerPoint, words can run past their
outline, and table rows below a row that grew can sit lower than their outline.

**An uploaded file is untrusted and LibreOffice's importers are a large attack surface, so the web app does not
draw.** (Decided by Luis on 24 Nov 2026: a sandboxed renderer, with the pictures kept.) The web process holds no
code that starts LibreOffice or any other program. It sends the file over a socket file to a job that systemd
starts for that one file and removes afterwards: a user of its own with no privileges, no network, a root file
system that contains programs and fonts and nothing of the host, one small scratch space in memory, and ceilings on
memory, processes, processor time, file size and run time that the kernel enforces. One file at a time. The job
checks its own box from the inside before it reads the file and refuses to draw if anything is missing; the web
app accepts pictures only with that report, only as whole JPEGs of a sane size, and otherwise shows none. The
earlier drawing (LibreOffice started by the web process with a fresh profile and no network) is deleted, not kept
as a fallback. A teacher gets at most 60 drawings and three minutes of drawing time in any ten minutes; a drawing
that takes longer than 20 s is finished in the background while the editor is told "busy" and asks again.

The service, its installer, its checks, what was tested and what was not: `packages/tala-server/deploy/render/README.md`.

## Safety of the upload itself

- Signed-in accounts with a confirmed email only; 20 upload starts per hour; 40 files and 200 MB per account;
  30 MB per file (`TALA_DECK_UPLOAD_MAX_BYTES`, `TALA_DECK_UPLOAD_ACCOUNT_BYTES`). A size setting that is set but
  is not a plain number of bytes turns uploads off and says so in the log; it is never guessed.
- Before anything is unpacked: extension, declared size, SHA-256 of what arrived, first bytes (ZIP, not OLE2 or
  PDF). The archive has to be a plain one: no name twice, no entry whose own header says something else than the
  directory, no two entries sharing bytes. Unpacking is capped (400 MB inflated, 4,000 entries, 200× ratio).
- **The web server's own thread never reads or writes an uploaded file.** Reading a new upload, and writing the
  edited file for a download or a drawing, each run in a worker thread that is started for that one job
  (`upload-jobs.ts`, `upload-worker.mjs`): with a time limit (10 s to read, 20 s to write), a memory limit of its
  own (192 MiB), one job at a time for the whole server and a short queue. A job that is stopped at a limit is
  "this file is more than is read here"; the server goes on answering everybody else. There is no code path that
  reads a file on the server's thread instead.
- **Every job has a budget for the whole of it**, not only limits for each part (table below). A file cannot be
  small to send and endless to read, and an edit cannot make a file grow without end.
- **A file is in memory once, and only while a job works on it.** A new upload is put together from its pieces
  when its turn has come, handed to the worker (not copied to it) and comes back with its reading, its checksum
  taken again after the reading. It is stored in pieces of 512 KiB. "The file I uploaded" is sent from the
  database a piece at a time, as the connection takes it: it is never in memory whole for a download.
- **What is on its way to clients is counted.** The edited file and the slide pictures do exist whole while they
  are sent, and a client can take as long as it likes. The routes count these bytes for everybody and for each
  account, hand such an answer out in pieces, and cut it short when it is not taken in time; past the count the
  next one is told to come back.
- The reader refuses macros and ActiveX (by content type and relationship, not by file name), encrypted and signed
  packages, Strict OOXML, part names that escape the package or collide, UTF-16 or invalid UTF-8 XML, DTDs.
- Nothing in the file is executed, converted in place or followed: external links and linked files are kept as
  text and never opened.
- A refused file is not kept in any form. File names, slide text and notes are never logged. Nothing a worker
  prints is passed on, and of a worker's failure only a short code is logged.
- Every SQL statement that reads or writes an upload, an unfinished upload, a piece or a picture names the owner.
  Another teacher's id answers "not found", exactly like an id that does not exist. Deleting an account removes
  its uploads, unfinished uploads and pictures; merging two accounts moves them.

### The limits, and what real files need

Measured on the corpus (99 files; the 86 the reader takes are real decks from bug reports and web crawls).

| What | Limit | The most any of the 86 real decks needs |
|---|---|---|
| One part the reader opens, whatever its name | 8 MiB; 250,000 elements; 200 levels deep; a list (relationships, content types) 40,000 entries | 163,290 elements |
| Everything one job parses | 2,000,000 elements; 64 MiB of text; 96 MiB unpacked | 636,650 elements; 6.7 million characters |
| What a deck is read into (and stored as) | 2,000,000 characters; 400 slides; 600 text boxes and 1,000 other things a slide | 306,000 characters |
| What one job writes | 24 MiB of new or changed parts; the edited file 48 MiB at most | 29.0 MB, for a 27.7 MB deck with every text box changed and every slide copied |
| A job's time and memory | 10 s to read, 20 s to write; 192 MiB | 392 ms to read, 1435 ms for that heaviest change; every deck is read with 128 MiB, one is not with 96 |
| On its way to clients at one moment | 96 MiB for everybody, 48 MiB for one account (an uploaded file counts as one piece, 512 KiB: it is sent from the database); an answer may take 2 minutes and the time a 32 KiB/s connection needs | |
| Kept for an account beside its files | what its files were read into: 16 MiB; pictures: 96 MiB (those of the files opened longest ago make room); two unfinished uploads, within the file allowance | |
| Requests of one account | 20 upload starts an hour; 30 downloads a minute; 60 drawings and 3 minutes of drawing time in ten minutes | |

What the web process holds at the worst, measured, not estimated (`uploads-hostile-http.mjs --stress 60`): four
accounts at once, each with a deck near the largest size, sitting on downloads of the original and of the edited
file, downloading, uploading more (another large file, and the heaviest file the reader still takes) and having
slides drawn, for a minute, against a site under the host's ceiling (`MemoryMax=1G`, no swap):

| Largest file taken | Most the web process held | Most its whole memory group held (the process, the database's file cache, connections) | The group at its ceiling | Killed for memory | Its health route meanwhile |
|---|---|---|---|---|---|
| 30 MiB (when nothing is set) | 735 MiB | 1024 MiB of 1024 | 243 times | none | 628 asked, none failed, 604 ms at the longest |
| 15 MiB (`TALA_DECK_UPLOAD_MAX_BYTES=15728640`) | 635 MiB | 786 MiB of 1024 | never | none | 635 asked, none failed, 284 ms at the longest |

**Read plainly: with 30 MiB files that stress puts the service AT its ceiling.** Nothing was killed, because what
filled the group beyond the process itself was the database's file cache, which the kernel takes back when asked;
but a service that the kernel has to squeeze hundreds of times a minute has no room left. With 15 MiB files the
group stayed 238 MiB below the ceiling. So under `MemoryMax=1G` the first release should take 15 MiB files (what
`deploy/tala.env.example` suggests); 30 MiB files want more memory for the service. Which of the two is the
release owner's to set.

What the process itself holds is mostly this: itself (about 200 MiB); one worker at its own limit (192 MiB of heap
and 32 for new objects) while it reads the heaviest file it accepts; one drawing (the file sent, up to 48 MiB, and
the pictures back, up to 64); what is on its way to clients (up to 96); one file with a job (up to 30, and up to
48 written). The same run before files were handed over instead of copied, and before originals were sent in
pieces, held 876 MiB. An ordinary heavy run is far below either: every hostile file, a 20 MB upload and ten
clients sitting on its original held 484 MiB at the most.

What is NOT bounded here, and is true of every route of the site, old and new: a client that opens hundreds of
connections and takes its answers slowly makes the server hold each answer until it is taken. The uploads' own
large answers (downloads, pictures) are counted as described; its JSON answers are not (the largest, a deck as
read, is 2 MB at most; of the 86 real decks nine in ten are under 24 KB and the largest is 306 KB). A limit on
connections for each address belongs at the proxy in front of the site.

## Evidence (all re-runnable; numbers from 21 Nov 2026)

Corpus: the 101 presentation files of Apache POI's test data (real files from bug reports and web crawls, Keynote
and LibreOffice exports, fuzzer cases, macro files), plus one invented lesson deck made with python-pptx.

| Check | Result |
|---|---|
| Reader alone, 101 files (`pptx-corpus.ts`) | 84 taken; 17 refused, all correctly (11 not valid archives incl. fuzzer cases, 5 with macros, 1 damaged); 0 crashes; 527 slides, 3,939 text blocks; slowest read 238 ms |
| Download with no edit | every part byte-identical in all 82 presentations; in the template and the slide show, all but the one part that names the kind of file |
| Scripted edits read back exactly | words 62/62, notes 32/32, reorder 33/33, copy 70/70, remove 33/33, all together 29/29 |
| Independent reader (python-pptx) opens every edited file | 343 of 343 variants, including the template and slide-show uploads |
| Independent drawing (LibreOffice): slides that were not edited look the same | unchanged 84/84, after a words edit 62/62, after notes 32/32, after removing 33/33; after reordering and copying the only differences are slide-number footers (under 0.2 % of pixels) and one comment marker that a copy does not carry |
| Every edited slide visibly changed | 62 of 62 |
| The same 101 files through the real HTTP API, in pieces (`uploads-corpus-http.mjs`) | 101 of 101 agree with the reader; original back byte for byte 84/84; edit saved, exported and read back 84/84 |
| A 29 MB deck (near the limit) through the API and the browser | taken in 56 pieces; server check 160 ms, export 27 ms; in the browser, open for editing 2.1 s after choosing the file (local network) |
| Browser walk, English and Filipino, desktop and phone (`uploads-walk.mjs`) | 40 of 40 checks each: upload, refusals, kept report, words, notes, table cell, move, copy, remove, undo/redo, pictures follow, reload, both downloads, list, delete, phone layout, a second teacher refused everywhere |
| The walk's downloads read by python-pptx (`pptx-walk-verify.py`) | 11 of 11 each: words and notes as typed; picture, chart with its workbook, table, hidden slide, transitions, layouts and positions as uploaded |
| Unit and server tests (24 Nov, second round) | With this lane alone on `tala-v1-demo.13`: core 282, server 333 (+1 opt-in), web 89, all passing; with both lanes: core 302, server 333 (+1), web 94; type-checks clean; production build clean. The browser walk in English and Filipino and the check of its downloads were repeated with the final build and the sandboxed drawing service behind the app (40/40 and 40/40; downloads 11/11 and 11/11) |
| **Files and edits made to stop the site** (24 Nov, second round) | 20 hostile files (`hostile-files.ts`), among them rebuilds of the two files the release owner stopped a rehearsal server with (a table cell "spanning" 4,000,000,000 columns; seven slides of 1,400,000 empty elements). Each comes to the end written beside it, a deck like any other or a plain refusal, at three levels: the reader alone (`pptx-hostile.test.ts`, 11 tests); the worker and the routes of a test server (`uploads-hostile.test.ts`, `uploads-sending.test.ts`: slowest 743 ms, the server's thread never held longer than 12 ms; the worker stopped at its time limit and at its memory limit, with the next file read as ever); and a running site through its HTTP API under the host's 1 GiB memory ceiling (`uploads-hostile-http.mjs`: 31 of 31; its health route asked 92 times meanwhile, never failing, 66 ms at the longest). The worker alone was also run with the host's Node 22.22.0 (`hostile-worker.ts`: all as expected) |
| The reader before and after this round, on the 99 real files (24 Nov) | Same verdict on 98; the other is a fuzzer file refused both times, now for a plainer reason. For all 86 decks that are taken: what is read is identical, and the bytes written with no change and with the heaviest change an editor can ask for are identical |
| The real files through the HTTP API with files stored in pieces (`uploads-corpus-http.mjs`, 24 Nov, second round) | 101 files: 101 agree with the reader alone (84 taken, 17 refused); the uploaded file back bit for bit 84 of 84; an edit saved, exported and read back 84 of 84; 16 sent in several pieces; problems: none |
| Uploads made before files were stored in pieces (the preview's database, migrated in place) | 1 of 1 uploads made before the change come back whole; the migration's own statements are also run in a test on a file of three pieces |
| **Everything at once, at the limits** (`uploads-hostile-http.mjs --stress 60`, 24 Nov, second round) | 4 accounts with 29 MB decks for 60 s under a 1 GiB ceiling: 61 more uploads, 43 downloads started and left; errors none; the health route never failed (604 ms at the longest); the web process held 735 MiB at the most and was not killed, but its memory group as a whole was at its ceiling 243 times. With the largest file set to 15 MiB: 635 MiB for the process, 786 MiB for the group, the ceiling never reached |
| **The sandboxed drawing service, from outside and inside** (`deploy/render/verify.mjs --slow`, 24 Nov, second round) | 97 of 97 checks with this machine's LibreOffice 26.8 and 97 of 97 with the Ubuntu 24.04 packages the host will get (LibreOffice 24.2.7, Node 22.22.0). Ordinary decks drawn. 31 hostile or broken files each refused, failed or killed in bounded time, with the service working afterwards and a canary file, port and socket on the machine never reached. A hostile program in the job's own box could read none of 29 host paths and devices, write nowhere but its scratch space, reach no network and no socket of the host, gain no privilege, use no `io_uring`, see no control group but its own and nothing in `/usr/local` but its own program, and was stopped at every ceiling for real (memory at 752 of 768 MiB, 127 of 128 processes, a fork bomb, 384 MiB of scratch, 256 MiB per file, 100 s of processor time, 120 s of run time). A crash left no memory image. No process and no file of a job outlived it |
| The real-file corpus through the server's drawing path into the sandbox (24 Nov, second round) | every deck the reader takes was drawn: 86 of 86 and 86 of 86 (545 slides), with the two LibreOffice versions; slowest 57 s and 23 s, most memory 591 and 505 MiB, inside the ceilings |
| The web app with the service behind it (`uploads-render-states.mjs`, 24 Nov, second round) | 20/20: pictures only for their owner; two teachers at the same moment; a job killed in the middle of a drawing; the service stopped (saving, both downloads and new uploads still work) and started again. Also a drawing that systemd kills at a 6 s ceiling, and one that gives up by itself: 4/4 and 4/4. The web process never started a program. Run on a server that verifies accounts by itself, as the host does |
| In a browser: the service stops while she is editing (24 Nov) | 6/6: the old picture gives way to her words in their boxes, the editor asks once and stops asking, saving goes on, and pictures return when the service is back |

**Not checked:** opening the edited files in Microsoft PowerPoint, Google Slides or WPS (none is available on the
build machine), and no validation with Microsoft's Open XML SDK. python-pptx and LibreOffice are the two
independent readers used. This is the first thing to do by hand: STATUS.md.

## Where things are

| | |
|---|---|
| Engine (pure TypeScript, no I/O) | `packages/tala-core/src/pptx/` — `xml.ts` (offset-keeping reader), `opc.ts` (package, relationships, content types), `text.ts` (paragraph splices), `walk.ts` (blocks and geometry), `inspect.ts` (safety gate, what is in the file), `apply.ts` (edits → package) |
| Contract | `packages/tala-core/src/contracts/deck-uploads.ts`; routes `decks.uploads.*` in `contracts/api.ts` |
| Server | `packages/tala-server/src/modules/decks/` — `uploads.ts` (routes, storage, owner checks, what is on its way to clients), `upload-jobs.ts` and `upload-worker.mjs` (one worker thread a job, with its limits), `upload-file.ts` (bytes ↔ engine, the job's budget), `upload-render.ts` (the web app's end of the drawing socket), `zip.ts` (raw pass-through; one name once, no shared bytes, a ceiling on what is written). Stored files are in `decks_upload_file_pieces` (512 KiB a row). In the kernel: `http.ts`, `types.ts` (a binary answer its route keeps count of: handed out in pieces, from memory or from a source, with a word when it has gone) |
| Drawing service | `packages/tala-server/deploy/render/` — `render-job.mjs` (one sandboxed job), `tala-render@.service`, `tala-render.socket`, `talarender.slice`, `install.sh`, `verify.mjs`, `sandbox-run.mjs`, `hostile.py`, `dev-units.mjs` (a developer's machine), `README.md` |
| Web | `packages/tala-web/src/features/slides/` — `UploadsScreen.tsx`, `UploadEditor.tsx`, `useUploadEditor.ts`, `upload-model.ts`; `src/data/uploads.ts`; routes `/library/mine`, `/slides/mine/[uploadId]` |
| Strings | `packages/tala-web/src/i18n/parts/uploads.en.ts`, `uploads.fil.ts` (Filipino has had the Filipino owner's editorial pass; teacher review is open) |
| Tests | `tala-core/src/pptx/pptx.test.ts`, `pptx-hostile.test.ts`; `tala-server/src/modules/decks/uploads.test.ts`, `uploads-hostile.test.ts`, `uploads-sending.test.ts`, `upload-render.test.ts` (and `hostile-files.ts`, the hostile files themselves); `tala-web/src/features/slides/upload-model.test.ts` |
| Evidence tools | `packages/tala-server/scripts/decks/` (`pptx-corpus.ts`, `pptx-fidelity.py`, `pptx-roundtrip-lo.py`, `pptx-walk-verify.py`, `pptx-boxes.py`, `render-deck.ts`, `make-sample-deck.py`, `hostile-files.ts`, `hostile-worker.ts`), `packages/tala-web/scripts/uploads-walk.mjs`, `uploads-corpus-http.mjs`, `uploads-render-states.mjs`, `uploads-hostile-http.mjs`; `packages/tala-server/deploy/render/verify.mjs` |

## Running it

```bash
# optional, for real slide pictures on a developer's machine: the sandboxed drawing service without root
node packages/tala-server/deploy/render/dev-units.mjs start [--soffice-dir /path/to/libreoffice] [--fonts-dir /path/to/fonts]

# from packages/tala-web, a local server on a throwaway database
TALA_ENV=local TALA_DB_PATH=/tmp/tala-uploads.sqlite TALA_PUBLIC_ORIGIN=http://127.0.0.1:3411 \
  TALA_DECKS_PREVIEW_SOCKET="$(node ../tala-server/deploy/render/dev-units.mjs path)" TALA_DECKS_PREVIEW_SHARED_USER=1 \
  node_modules/.bin/next start -H 127.0.0.1 -p 3411                       # after `next build`
pnpm exec tsx scripts/ui-seed.mjs http://127.0.0.1:3411 --db /tmp/tala-uploads.sqlite --teacher a --lang en
PLAYWRIGHT_PATH=… CHROMIUM_PATH=… node scripts/uploads-walk.mjs http://127.0.0.1:3411 <outDir> \
  --email … --password … --deck lesson.pptx --refuse macros.pptm --other-email … --other-password …
python packages/tala-server/scripts/decks/pptx-walk-verify.py <outDir>/walk-en.json

# real files, engine alone and through the API
pnpm --filter @hiraia/tala-server exec tsx scripts/decks/pptx-corpus.ts <corpus-dir> report.json --out variants/
pnpm exec tsx scripts/uploads-corpus-http.mjs http://127.0.0.1:3411 <corpus-dir> report.json http.json --db /tmp/tala-uploads.sqlite

# files and edits made to stop the site
pnpm --filter @hiraia/tala-core exec tsx --test src/pptx/pptx-hostile.test.ts              # the reader alone
pnpm --filter @hiraia/tala-server exec tsx --test "src/modules/decks/uploads-*.test.ts"    # worker and routes
pnpm --filter @hiraia/tala-server exec tsx scripts/decks/hostile-worker.ts                 # the worker alone, any Node
pnpm --filter @hiraia/tala-server exec tsx scripts/decks/hostile-files.ts <new folder>     # the files as files
pnpm exec tsx scripts/uploads-hostile-http.mjs http://127.0.0.1:3411 out.json [--db ...] [--server-pid PID] [--file own.pptx]...
```

The last one sends every hostile file, and any file given with `--file`, to a running site while it asks the
site's health route ten times a second; it also sits on downloads of a 20 MB deck. A server that confirms
accounts by mail needs `--db` (the link is read from its outbox); one with `TALA_AUTH_AUTO_VERIFY=1` does not.

`TALA_DECKS_PREVIEW_SHARED_USER=1` is for a developer's machine only: there the job can only run as the developer,
and the web app refuses such a job unless it is a local server that asks for it by name. On a server the service
is installed by `packages/tala-server/deploy/render/install.sh` and only `TALA_DECKS_PREVIEW_SOCKET` is set. The
settings of the earlier drawing (`TALA_DECKS_PREVIEW_SOFFICE`, `_PDFTOPPM`, `_FONTCONFIG`, `_ALLOW_NETWORK`) do
nothing any more; the server says so once in its log if one is still set.

## Before this could go to production

1. **Open the edited files in real PowerPoint, Google Slides and WPS** (by a person; a short list is in STATUS.md).
2. **Install the drawing service on a box set up like the host and run its checks as root** (the release owner;
   `packages/tala-server/deploy/render/README.md`). How slides are drawn in production was decided on 24 Nov (a
   sandboxed renderer, pictures kept) and the service is built and tested, without root; the end of that README
   lists exactly what is left for a root run on the host to show.
3. **Node 22.18 or newer on the host** (it has 22.22.0). File reading is off the request thread since 24 Nov: each
   job runs in a worker thread, like the class-list reader, and the worker runs the reader's TypeScript sources as
   they are, which older Node versions cannot. A server whose Node cannot says so at start
   (`deck_upload_reader_unavailable` in the log) and takes no file: reading is never done another way. The
   sources have to be there at run time (`packages/tala-server/src/modules/decks/`, `packages/tala-core/src/pptx/`),
   as they are where the release is built in its own folder.
4. **Move stored files out of SQLite.** Originals are stored as rows (once per distinct file). That is simple and
   transactional, and right for a preview; at scale they belong on disk or object storage, and the database file
   does not shrink after deletes.
5. **Filipino:** the editorial pass on `uploads.fil.ts` is done (23 Nov); review by a Filipino-speaking teacher is open.
6. **How long uploads are kept, and the words that say so in the privacy text**: Luis's decision (the question is
   in STATUS.md). Today a file, its edits and its pictures are kept until the teacher deletes the file or her
   account.
