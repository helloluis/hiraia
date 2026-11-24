# My own slides (teacher uploads): status

**As of 24 Nov 2026.** What the feature is, how it works and the evidence: [README.md](README.md). The drawing
service: [`packages/tala-server/deploy/render/README.md`](../../../packages/tala-server/deploy/render/README.md).

| | |
|---|---|
| State | **Built and handed over (twice on 24 Nov). Not deployed.** Production is untouched. The release owner's root rehearsal of the first hand-over passed the drawing sandbox and found that the file reader, inside the web process, could be made to stop the site; the second hand-over answers that (below) |
| Where | Worktree `/home/debian/code/tala-wt/uploads` on b11-002. Handed to the release owner as patches against `tala-v1-demo.13` (`6ebaf2c96`) and as a commit on top of the multi-grade commit |
| On top of | `tala-v1-demo.13` (`6ebaf2c96`), what tala.hiraia.org runs. First built on `tala-v1-demo.11`; moved over on 23 Nov with three-way merges, no conflicts, and re-tested each time |
| Owner | The agent session that built it (sole owner of this lane). Release, installation on the host and restarts belong to the release owner (b11-dev `bcd615b4`) |
| Production | No deployment, no pushes, no deletions, no permission or secret changes were made for this work |

## Done and checked

- Upload in resumable pieces, safety checks and plain refusals, private storage of the untouched original.
- Reading a deck into slides, text blocks (with their places on the slide) and an honest list of what is only kept.
- Editing words, table cells and notes; moving, copying, removing and restoring slides; undo/redo; autosave with
  conflict and offline handling; unsaved work kept on the device.
- Export of the edited file by patching the original; download of the original byte for byte; delete.
- **Real pictures of slides from a sandboxed drawing service** (new on 24 Nov, replacing the earlier unsandboxed
  drawing, which is deleted): one job per file started by systemd, its own user, no network, nothing of the host
  in sight, one small scratch space in memory, kernel-enforced ceilings, one file at a time. Off by default. The
  editor keeps working without pictures when the service is missing, stopped, slow or killed.
- English strings and Filipino strings with the Filipino owner's editorial pass; desktop and phone layouts.
- **Reading and writing a file never happens on the web server's own thread** (new on 24 Nov, after the release
  owner's rehearsal): one worker thread for each job, with a time limit and a memory limit of its own, one job at
  a time; a budget for the whole of each job (how much it may unpack, parse and write); a plain ZIP only (no name
  twice, no shared bytes); a file in memory once and only while a job works on it (handed to the worker and back,
  stored in pieces, the uploaded file sent from the database a piece at a time); the edited file and pictures on
  their way to clients counted for everybody and for each account; settings that cannot be read turn uploads off. The two files that stopped the rehearsal server (a
  63 KB file that held the site's thread for half a minute, a 542 KB file that ran the process out of memory)
  are rebuilt in the tests with eighteen more of their kind: each is read or refused in under a second, with the
  server's thread held for milliseconds. Four accounts doing all of the worst at once for a minute, with decks
  near the largest size, leave the site answering and its process well under its memory ceiling (the numbers are
  in the README).
- **Three ways out of the drawing box, closed** (same day): the job saw all of `/usr/local`, could read the host's
  control-group tree (every service by name, with its numbers), and could use `io_uring`. It now sees its own
  program in `/usr/local` and nothing else, its own control group and nothing else, and the system-call filter
  refuses `io_uring`; the job checks the first two itself before every drawing. A crash inside the box makes no
  memory image: tested here for a core file; that a crash handler of the host (apport) is not started either is
  the kernel's rule for the setting used, read in its source and not tried here.
- Tests, type-checks, production build, the browser walk in English and Filipino, the real-file corpus through
  the engine, through the real HTTP API and through the sandboxed drawing; the drawing service's own checks with
  ordinary files, hostile files and a hostile program in the box; hostile files through the reader, the worker,
  the routes and a running site. Numbers are in the two READMEs.

## Not done

- **Not opened in Microsoft PowerPoint, Google Slides or WPS.** None is available on the build machine. See the
  first question below.
- No Open XML SDK validation run.
- **The drawing service has not been installed or run as root, and not on a host like production.** It was built
  and tested without root on the build machine, including with the exact Ubuntu 24.04 packages the host will get
  unpacked into a folder. What that leaves untested is listed at the end of the drawing service's README. The
  release owner installs it and runs its checks on a box set up like the host before anything of this lane is
  released.
- **The second hand-over has not been run as root, and not on systemd 255.** The new lines of the drawing unit
  were run here under the per-user service manager of systemd 252, with this machine's programs and with the
  Ubuntu 24.04 packages. That systemd 255 orders the same rules the same way was read in its source, not run.
  The release owner repeats the whole root rehearsal, with their own two files.
- The web app was not run here with the host's Node 22.22.0 (its database driver is built for this machine's
  Node). The worker alone was: every hostile file, and both of its limits.
- Originals and pictures are stored in SQLite. Acceptable for a first release; see the README.
- A client that opens hundreds of connections and takes its answers slowly is not this lane's to stop: that is
  true of every route of the site and wants a limit at the proxy. This lane's own large answers are counted.
- Filipino strings have had an editorial pass, not a teacher's review (see "Filipino" below).
- No "add a new slide / text box / picture" and no formatting controls. By design for this version.

## Decided

- **Slide pictures in production** (was open until 24 Nov). The question was: *Should Fable add a sandboxed
  production renderer before enabling PPTX previews, or ship without preview pictures?* Luis, 24 Nov 2026: "Yeah
  the sandboxed renderer makes sense". So: a sandboxed renderer, with the pictures kept. Built as described above.
  This decision is about the renderer only.
- **Committing.** Luis's 23 Nov "Did we deploy all the improvements already? If not please do so now" is read by
  the coordinator, the release owner and this lane's owner as asking for the release of this work, which takes
  commits. The lanes were committed locally on that basis (multi-grade first, this lane on top); nothing is pushed
  from b11-002.

## For the release owner to set

**The largest file the first release takes.** Measured on 24 Nov under the host's ceiling (`MemoryMax=1G`), with
four accounts doing all of the worst at once for a minute: with 30 MiB files (what the server takes when nothing
is set) the web process held 735 MiB and its memory group as a whole was at the ceiling 243 times, with nothing
killed; with 15 MiB files the group peaked at 786 MiB and never reached it. So either
`TALA_DECK_UPLOAD_MAX_BYTES=15728640` for the first release (the line is in `deploy/tala.env.example`, commented
out), or more memory for the service. Blocks nothing here; it is a setting of the host.

## Decisions waiting for Luis (`waiting_for_user`)

1. **Hand check in real PowerPoint** (blocks the release of this lane). *Can someone open the two sample downloads
   (the edited file and the original) in Microsoft PowerPoint on a computer and on a phone, in Google Slides and
   in WPS Office, and say whether a repair message appears or anything looks wrong?* What to look at: the changed
   title on slide 1, the copy on slide 2, the added line and the notes on "What we will learn", the last cell of
   the table, the chart (double-click it: its data should open), the hidden "Answer key" slide, the fade on the
   first slides.
2. **How long uploads are kept, and the words that say so** (blocks the release of this lane). *What should the
   privacy text tell a teacher about the PowerPoint files she uploads: how long Tala keeps them, who can see them,
   and when they are deleted?* What the code does today: a file, its edits and its pictures are private to the
   account, kept until the teacher deletes the file or her account, and removed with either; unfinished uploads
   are removed after 24 hours. Nothing is shared and nothing is sent to a model. The policy and its wording are
   Luis's to set; the code follows whatever he decides.

Nothing else is blocked on these: the work, the hand-over and the evidence are complete without them.

## Filipino

`packages/tala-web/src/i18n/parts/uploads.fil.ts` holds every Filipino string of this feature and nothing else. It
has had the Filipino owner's editorial pass (23 Nov: 79 of 144 messages revised; keys and placeholders
untouched) and is taken in exactly as handed over. It keeps its draft header, because review by a
Filipino-speaking teacher has not happened. Where that pass was more exact than the English about what the editor
does (what resuming an upload depends on, that a failed save needs the download to be tried again, what "put
back" restores), the English strings and the server's English messages were brought to the same accuracy.

The drawing service added no string and changed none, in either language: the editor already had words for "no
picture here" and "could not be drawn just now".

No existing Filipino string, pack source or page was edited: the feature registers its strings with one import and
one spread in `i18n/en.ts` and `i18n/fil.ts`.

## Shared files touched (small, additive)

| File | Change |
|---|---|
| `packages/tala-core/package.json` | two export entries (`./pptx`, `./pptx/testing`) |
| `packages/tala-core/src/contracts/api.ts`, `contracts/index.ts` | the `decks.uploads.*` routes; one export line |
| `packages/tala-server/src/modules/decks/index.ts` | the uploads handlers, migration and account hooks joined to the decks module |
| `packages/tala-server/src/modules/decks/zip.ts` | reading and writing an entry's stored bytes as they are (`raw`); and, since 24 Nov, for every archive this module reads: a name may appear once, an entry's own header must agree with the directory, no two entries may share bytes; for writing, an optional ceiling on the archive's size |
| `packages/tala-server/src/kernel/types.ts`, `kernel/http.ts` | one optional field on a binary answer (`held`): the answer is then handed to the connection in pieces and its route is told when it has gone. An answer without the field is sent exactly as before |
| `packages/tala-server/deploy/tala.env.example` | eight comment lines: the upload limits and the drawing socket, all commented out (off) |
| `packages/tala-web/src/features/library/LibraryScreen.tsx` | one card: "Your own slides" |
| `packages/tala-web/src/i18n/en.ts`, `fil.ts` | one import and one spread each |

Everything else is in new files (listed in the README). `packages/tala-server/deploy/README.md` and
`tala.service` are not touched: the drawing service has its own folder, `deploy/render/`. The private-copy editor
is unchanged.

One thing noticed in passing and left alone because it is outside this lane: in the copy editor, opening
"Delete" or "Start again" from the "More" sheet appears to rely on the same sheet-chaining that closed itself in
the new editor until it was fixed here (`closing()` in `UploadEditor.tsx`). Worth a two-minute check by its owner.

## Also in this worktree

The combined multi-grade lesson plan ("One plan for a multi-grade class") is a separate lane in the same
worktree, with its own patch, its own commit and its own notes (`docs/tala/multigrade-plan/`). Neither lane needs
the other. Both add their own lines to `packages/tala-core/package.json`, `i18n/en.ts` and `i18n/fil.ts`.

The Math and English harvesting plans and the Android/Windows distribution plan from the first request are not
written. Research notes for distribution and for editors exist outside the repository on b11-002
(`/home/debian/code/tala-wt/.tools/research/`). The Math pilot belongs to a separate owner.

## The preview

A temporary copy of the web app ran on b11-002 from this worktree on a throwaway database with fictional
teachers, reachable through a temporary HTTPS tunnel, from 21 Nov. Since 24 Nov its pictures come from the
sandboxed drawing service in its developer set-up. The tunnels were started with a 72-hour limit and end by
themselves on 24 Nov 2026 at about 19:15 Philippine time; a new preview would have new addresses. Its scripts,
throwaway database and sign-in details are in `/home/debian/code/tala-wt/.tools/preview/`, outside the
repository. Nothing in it is real data, and none of it goes to production.
