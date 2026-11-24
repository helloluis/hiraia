# My own slides (teacher uploads): status

**As of 24 Nov 2026.** What the feature is, how it works and the evidence: [README.md](README.md). The drawing
service: [`packages/tala-server/deploy/render/README.md`](../../../packages/tala-server/deploy/render/README.md).

| | |
|---|---|
| State | **Built, handed over and rehearsed as root. Not deployed.** Production is untouched. On 24 Nov the release owner ran the second hand-over (commit `c6938a492`) as root on a machine like the host: their three blockers are closed by test, and the lane is technically releasable with 15 MiB files. A third hand-over the same day adds what their second readers found (below); they have not rehearsed it. The release waits on Luis's two questions |
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
  are rebuilt in the tests with nineteen more of their kind: each is read or refused in under a second, with the
  server's thread held for milliseconds. Four accounts doing all of the worst at once for a minute, with decks
  near the largest size, leave the site answering and its process well under its memory ceiling (the numbers are
  in the README).
- **Three ways out of the drawing box, closed** (same day): the job saw all of `/usr/local`, could read the host's
  control-group tree (every service by name, with its numbers), and could use `io_uring`. It now sees its own
  program in `/usr/local` and nothing else, its own control group and nothing else, and the system-call filter
  refuses `io_uring`; the job checks the first two itself before every drawing. A crash inside the box makes no
  memory image: tested here for a core file; that a crash handler of the host (apport) is not started either is
  the kernel's rule for the setting used, read in its source and then shown by the release owner's run as root
  (with apport as the handler, nothing was left in `/var/crash`).
- **What the release owner's second readers found** (third hand-over, same day): the one job place is shared out
  between accounts (two jobs of an account there at a time, being done or waiting; the free place goes to the
  waiting account that has had the least of it in the last minute); a content type is 255 characters at most and
  each is looked at once; the room of a download is given back the moment its client has gone, and after 30 s in
  which the connection took nothing; a file put back together from its stored pieces is checked against its
  checksum before anything is written from it; a deck's stored reading is fetched only to answer the editor; and
  a server with nothing set takes 15 MiB files and 50 MiB for an account. The first two leads were tried before
  anything was changed, and were real: a 489 KB file kept the job place for 7.4 s, and again for every download;
  six abandoned requests kept an account at "come back" for as long as was watched (the README has both before
  and after).
- Tests, type-checks, production build, the browser walk in English and Filipino, the real-file corpus through
  the engine, through the real HTTP API and through the sandboxed drawing; the drawing service's own checks with
  ordinary files, hostile files and a hostile program in the box; hostile files through the reader, the worker,
  the routes and a running site. Numbers are in the two READMEs.

## Not done

- **Not opened in Microsoft PowerPoint, Google Slides or WPS.** None is available on the build machine. See the
  first question below.
- No Open XML SDK validation run.
- **The drawing service has not been installed on the production host.** It was built and tested without root on
  the build machine, including with the exact Ubuntu 24.04 packages the host will get unpacked into a folder; and
  the release owner installed it and ran its checks as root, twice, on a machine set up like the host (24 Nov;
  the second time every check passed, and their own probe of the box). What is left untested is listed at the
  end of the drawing service's README. On the host itself the release owner plans to install it and run its
  checks again, without the two that fill a machine's memory and process table.
- **The third hand-over has not been run as root or by the release owner.** The second was, on systemd 255 with
  AppArmor and Node 22.22.0: the drawing service's check 100 of 100 as root, the release owner's own probe of the
  box, the upgrade from the first hand-over's database and from production's, the hostile files and their own
  two through the real API, the stress at 15 MiB. Since then two lines of the drawing job changed (it sends no
  picture larger than the web app takes; a `/usr/local` that cannot be listed is not taken as hidden), and the
  web app changed as "What the release owner's second readers found" above says. All of it was run here,
  without root.
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

## Settled with the release owner (24 Nov)

**The largest file.** Production takes 15 MiB files and 50 MiB for an account (their setting). Since the third
hand-over that is also what a server takes when nothing is set, so that a missing setting is not the weaker
case; 30 MiB files remain possible by setting, with more memory for the service than 1 GiB.

## Known limits: what a few hostile accounts could still do to this feature

None of these reaches the site as a whole, another teacher's files, or the host. They are about this feature
being slow or told "come back" for other teachers while someone works at it. Found by the release owner's two
independent readers on 24 Nov. The first two below were tried here before anything was changed, and were real (the
evidence has each before and after); the other three can be read in the code.

Closed in the third hand-over:
- one account keeping the one job place busy (a 489 KB file with 3,900 parts sharing a megabyte-long content type
  was read, after 7.4 s, and cost as much again for every download): a content type is 255 characters at most
  and is looked at once; and the job place is shared out between accounts;
- downloads whose client left before they were written keeping their room for about ten minutes: let go at once;
- the drawing job sending pictures the web app would drop (4 MiB against 2): one number now;
- a file put back together from its pieces written from without a check: the worker checks its checksum;
- the stored reading of a deck fetched for every picture, drawing and download: fetched only to answer the
  editor (opening a deck, saving it) and the upload itself.

Left as they are, with the reason:
- **The drawing place.** Three accounts with decks that take a minute to draw can still take most of it, in turn;
  an editor stops asking by itself after about half a minute of "busy"; and a drawing goes on to its own end
  (100 s at most) after the web app has given up on it, because the job cannot tell a client that has finished
  sending from one that has gone without a change to how the two talk. Effect: pictures come late. Editing,
  saving and downloading never wait for pictures.
- **Clients that stay connected and take nothing.** Two or three accounts doing that to edited downloads can fill
  the 96 MiB count for as long as they keep at it (each answer is let go after 30 s without progress, and they
  can ask again). Behind a proxy that takes a whole answer off the server at once, as the host's does, a slow
  client does not hold the server at all.
- **Still on the server's own thread:** a file's pieces are stored in one transaction and a drawing's pictures
  in another; the stored reading (2 MB at most) is parsed for the editor and for a save.
- **A change too large to write** (more than 24 MiB of new or changed parts) can be saved and then not
  downloaded; the editor does not say so when it is saved.
- **"The file I uploaded"** is sent from its stored pieces without a checksum on the way out (the edited file is
  written only from a checked file).
- The drawing client joins a picture's bytes as they arrive (one picture is 2 MiB at most).
- The job's system-call filter still allows the keyring calls and `process_vm_*`: its keyring is its own, and it
  sees no process but its own.

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
| `packages/tala-server/src/kernel/types.ts`, `kernel/http.ts`, `kernel/server.ts` | one optional field on a binary answer (`held`): the answer is then handed to the connection in pieces, let go when its client has gone or stops taking it, and its route is told when it has gone. For that the kernel hands the request's own signal to a binary answer (the one line in `server.ts`). An answer without the field is sent exactly as before |
| `packages/tala-server/deploy/tala.env.example` | eleven lines, all comments: the upload limits and the drawing socket, commented out (the limits are then the measured defaults, the drawing off) |
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
