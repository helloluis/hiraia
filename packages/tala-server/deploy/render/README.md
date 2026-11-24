# Slide pictures for teachers' own files: the sandboxed drawing service

"My own slides" shows a teacher real pictures of the slides she uploaded. They are drawn by LibreOffice, and a file
a teacher uploads is untrusted input to a very large program. So the web app does not draw. It hands the file to a
**drawing job** that runs once per file in a sandbox, and takes the pictures back. This folder is that service:
the job, the systemd units that are its sandbox, the installer, and the checks.

Decided by Luis on 24 Nov 2026: a sandboxed renderer, with the pictures kept. What is and is not verified is in
the last section; read it before a release.

```
web app (tala.service, user tala)                 no code that starts LibreOffice or any other program
   │  socket file /run/tala-render/render.sock    0660 root:tala, no network port
   ▼
tala-render.socket   Accept=yes, MaxConnections=1    one connection = one job; a second caller is turned away
   ▼
tala-render@N.service  in talarender.slice           made for this file, gone when it ends
   /usr/bin/node /usr/local/lib/tala-render/render-job.mjs
       1. checks its own box from the inside, and refuses to draw if anything is missing
       2. reads the file from the connection into /tmp (memory)
       3. checks the archive's table of contents
       4. soffice.bin (fresh hardened profile) → PDF → pdfinfo → pdftoppm → one JPEG per slide
       5. writes the pictures to the connection
```

## What a job can and cannot do

| | How | Enforced by |
|---|---|---|
| Its own user, no privileges | `User=tala-render` (owns nothing, in no other group), `PrivateUsers`, `NoNewPrivileges`, no capabilities, `RestrictSUIDSGID`, `RestrictNamespaces` | kernel |
| No network at all | `PrivateNetwork` (its own empty network), `RestrictAddressFamilies=AF_UNIX`, `IPAddressDeny=any` | kernel |
| Sees programs and fonts, nothing else | `TemporaryFileSystem=/:ro` (an empty root), then read-only binds of `/usr`, `/etc/fonts`, `/etc/libreoffice`, `/etc/ld.so.cache`, the font cache. `/var/lib/tala`, `/etc/tala`, `/home`, `/run`, `/etc/passwd` are not hidden: they are not there | kernel (mount namespace) |
| One place to write | `/tmp`: 384 MiB in memory, 8192 files, no programs can be run from it; made for the job, gone with it. `/dev/shm` and `/run` are replaced by empty read-only ones. (The job's private message-queue folder, `/dev/mqueue`, exists too: it holds no files, a few hundred KB of queues at most, and goes with the job) | kernel |
| Memory | `MemoryMax=768M`, no swap; over it, the whole job is killed | kernel (cgroup) |
| Processes | `TasksMax=128` | kernel (cgroup) |
| Processor | `CPUQuota=100%` (one core), `LimitCPU=100` s, low priority | kernel |
| File size, open files | `LimitFSIZE=256 MiB`, `LimitNOFILE=512`, no core dumps | kernel |
| Run time | the job gives up at 100 s; `RuntimeMaxSec=120` kills whatever is left | job, then systemd |
| System calls | `@system-service` minus privileged and resource-changing ones | kernel (seccomp) |
| Other processes | sees none but its own (`ProtectProc=invisible`), cannot trace or signal any | kernel |
| Nothing outlives it | `KillMode=control-group`, `KillSignal=SIGKILL`; scratch, IPC and network are the job's own | systemd, kernel |
| One file at a time | `MaxConnections=1`: two teachers' files are never in the drawing user at once | systemd |

The job **checks all of this itself** (`selfCheck` in `render-job.mjs`) before it reads a byte of the file: not root,
no capabilities, no-new-privileges and a system-call filter in force, no network device but its own loopback and
no way to open a connection, none of a list of host paths in sight, exactly one writable place that is in memory,
small, empty and made for this job, no other user's or job's process in sight, finite ceilings on memory, swap,
processes, processor, file size and open files, and no stray environment variable. If one check fails it answers
"sandbox check failed" with the names of the failed checks and draws nothing. There is no switch to turn the
check off. So a mistake in a unit file, or a line this systemd applies differently, turns pictures off; it does
not turn the sandbox off.

The web app believes nothing the job sends (`src/modules/decks/upload-render.ts`): the answer is read with hard
limits, must end with an explicit "done", must carry the job's report that its box held, the job must not run as
root or as the web app's own user, and every picture must be a whole JPEG no wider than asked and no taller than
4096 px. Anything else is "no picture". **There is no other way to a picture**: the earlier code that started
LibreOffice from the web process is deleted, and its settings (`TALA_DECKS_PREVIEW_SOFFICE` and friends) do
nothing but a warning in the log.

Second locks on the same doors: the archive that arrives is one the web app wrote itself, and the job still
refuses names that climb out of the archive, absolute names, a part named twice, encryption, ZIP64, unknown
compression and an archive that says it unpacks to too much; LibreOffice is told to read the file as a PowerPoint
presentation whatever it may pretend to be, and gets a fresh profile with macros off and links to outside blocked.

## Files

| File | What it is | Goes to |
|---|---|---|
| `render-job.mjs` | The job. One file, no dependencies | `/usr/local/lib/tala-render/render-job.mjs` |
| `tala-render@.service` | The sandbox of one job | `/etc/systemd/system/` |
| `tala-render.socket` | The door: the socket file, who may open it, one job at a time | `/etc/systemd/system/` |
| `talarender.slice` | The ceiling for everything drawing ever uses | `/etc/systemd/system/` |
| `install.sh` | Installs, updates or removes all of the above (`--dry-run` prints the commands) | run from the tree |
| `verify.mjs` | The check: ordinary files, hostile files, abuse of the protocol, turns, and a hostile program in the box | run from the tree |
| `sandbox-run.mjs`, `hostile.py` | Run any program in the job's box; a program that plays a taken-over LibreOffice | used by `verify.mjs` |
| `dev-units.mjs`, `units.mjs` | The same service on a developer's machine, without root | developer machines only |

The web app's side: `packages/tala-server/src/modules/decks/upload-render.ts` (+ tests), the route
`decks.uploads.render` in `uploads.ts`, and `packages/tala-web/scripts/uploads-render-states.mjs` (the check
through the real HTTP API).

## Installing on the host

Needs: systemd 252 or newer with the unified control-group hierarchy (memory, pids and cpu controllers), Node at
`/usr/bin/node` (written for 20 and newer; run with 22.22.0 and 24.21), the group of the web app (`tala`), about
600 MB of disk for the packages, and memory for one job (768 MiB at most) beside everything else on the host.

```bash
# as root, in the release's tree
packages/tala-server/deploy/render/install.sh --dry-run     # read what it will do
packages/tala-server/deploy/render/install.sh               # packages, user, files, units, first check
/usr/bin/node packages/tala-server/deploy/render/verify.mjs --socket /run/tala-render/render.sock --out /var/tmp/tala-render-verify
```

`install.sh` installs `libreoffice-impress-nogui poppler-utils fonts-crosextra-carlito fonts-crosextra-caladea
fonts-liberation fonts-dejavu-core`, makes the user `tala-render`, copies the job and the units, starts the socket
and runs the `probe` and `draw` sections of the check. It does not touch the web app. Pictures stay **off** for
teachers until both of these are done in the release window:

1. `TALA_DECKS_PREVIEW_SOCKET=/run/tala-render/render.sock` in `/etc/tala/tala.env`;
2. the web app is restarted.

`tala.service` needs no change: it can already reach `/run/tala-render/render.sock` (group `tala`), and it starts
no program.

Turn pictures off again: `systemctl stop tala-render.socket`. The web app answers "no pictures here" within one
request, says so for 30 s at a time without trying the service on every request, and the editor works on the
words; uploads, saving, the edited download and the original are not affected. Start it again and pictures come
back by themselves. Remove everything: `install.sh --remove`. Roll back a release: an older release of the web
app does not know `TALA_DECKS_PREVIEW_SOCKET` and ignores it.

### Things to know about the host (read on 24 Nov 2026 by the release owner; not tested by the author there)

- Unprivileged user namespaces are closed to the service user on the host (Ubuntu 24.04, AppArmor). That does not
  matter here: root's service manager builds the box. It is why an `unshare` or `bwrap` wrapper inside the web
  app's own service was not an option.
- Ubuntu's LibreOffice package loads an AppArmor profile for `soffice.bin` in **complain** mode. It does not block
  the job. If it is ever switched to enforce, run `verify.mjs` again first.
- LibreOffice's registry lives in `/etc/libreoffice/registry` on Ubuntu (copied there when the package is
  installed). The unit binds `/etc/libreoffice`; without it LibreOffice aborts at start. `install.sh` checks it.
- The host has no Carlito or Caladea (the fonts that stand in for Calibri and Cambria, PowerPoint's defaults).
  `install.sh` installs them. A font a deck uses that the host does not have is replaced by a similar one in the
  picture; the file the teacher downloads keeps her fonts.

### Do not "harden" the unit with these

`ProtectSystem=`, `ReadOnlyPaths=/` and `DynamicUser=` (which forces `ProtectSystem=strict` and a private `/tmp` on
the host's disk). On systemd 252 their read-only `/` silently takes the place of the empty root, and the job would
see the host's whole file system, read-only (tested here; `selfCheck` then refuses to draw). The empty root is
already read-only. `MemoryDenyWriteExecute=` is left out because Node and LibreOffice make executable memory at
run time.

## Settings

Web app (`/etc/tala/tala.env`):

| Setting | Meaning |
|---|---|
| `TALA_DECKS_PREVIEW_SOCKET` | The socket of the drawing service. Unset (the default): no pictures |
| `TALA_DECK_UPLOAD_MAX_BYTES`, `TALA_DECK_UPLOAD_ACCOUNT_BYTES` | As before: the largest file, and what an account may keep |
| `TALA_DECKS_PREVIEW_SHARED_USER=1` | Developer machines only, ignored when `TALA_ENV` is staging or production: accept a job that runs as the developer |

The job (lines `Environment=` in `tala-render@.service`): where the programs are (`TALA_RENDER_SOFFICE`,
`TALA_RENDER_PDFTOPPM`, `TALA_RENDER_PDFINFO`), and optionally `TALA_RENDER_MAX_INPUT_BYTES` (default 48 MiB, never
above 64), `TALA_RENDER_DEADLINE_SEC` (default 100, never above 110), `TALA_RENDER_REQUEST_SEC` (default 20: a
caller that connects and says nothing does not hold the one place for longer), `TALA_RENDER_FORBIDDEN_PATHS`
(what `selfCheck` must not see).

The numbers in the unit come from drawing every real file of the corpus (86 decks, 545 slides) in the box:

| | LibreOffice 26.8 (developer machine) | LibreOffice 24.2.7 (Ubuntu 24.04 packages) |
|---|---|---|
| Time per deck | median 0.69 s, 90% under 4.4 s, slowest 55 s | median 0.67 s, 90% under 3.8 s, slowest 22 s |
| Peak memory of a job | median 88 MiB, 90% under 215, most 587 MiB | median 165 MiB, 90% under 190, most 505 MiB |
| Largest file / most pictures | 27.7 MiB in, 5.4 MiB of pictures out | the same files |

(Both runs shared the machine.) That machine has faster cores than the host. A deck that takes 55 s there may run
into the 100 s limit on the host; it then has no pictures and the editor says so. The web app does not hold a
request for longer than 20 s: it answers "busy", the drawing carries on, and the pictures are there when the
editor asks again.

Because one file is drawn at a time for everybody, the web app keeps each teacher to 60 drawings and to three
minutes of drawing time in any ten minutes (`rendersPerTenMinutes`, `drawMsPerTenMinutes` in `uploads.ts`); past
either she is told "busy" and keeps the pictures she has, and other teachers are not held back by her.

## Operating

- One line per job in the journal, numbers only: `journalctl -t tala-render`. How systemd ended a job that was
  killed: `journalctl -u 'tala-render@*'` (`oom-kill`, `timeout`).
- The web app logs `deck_upload_render_unavailable` (no usable service; `reason` says why, for example
  `socket ENOENT` or `the job refused to draw: sandbox check failed (no-network-device)`) and
  `deck_upload_render_failed` (this file could not be drawn: `could not convert`, `out of time`, `the drawing job
  was stopped before it finished`).
- Neither log ever holds a file name, a path inside a file or a word of a slide.
- Pictures are kept in the web app's database beside the upload (as before): about 60 KB to 250 KB per slide.

## Checking it

`verify.mjs` makes every file it uses and changes nothing. As root on a server it checks the installed service; on
a developer's machine it checks the developer set-up (`--user`).

| Section | What it does |
|---|---|
| `probe` | The job's own report: user, capabilities, network, what it sees, where it can write, ceilings, environment |
| `draw` | Ordinary decks: 1 and 12 slides, 4:3 with a hidden slide, portrait, a banner, a picture, a narrower width |
| `files` | 31 hostile or broken files: not a presentation at all (8), archives that try something (12: names that climb out, absolute names, a part named twice, encryption, ZIP64, zip bombs honest and lying), content that tries something (11: a 40,000 × 40,000 picture, a billion expanding entities, 30,000 nested shapes, links to the network and to files of the host, macros, embedded objects, wrong slide counts). Each must end in bounded time, leave the service working, and never reach a canary file, port or socket on the host |
| `protocol` | A caller that breaks the rules: not a request, unknown operation, absurd sizes, hanging up, saying nothing |
| `turns` | Six files at the same moment: one is drawn, five are turned away at once; then each in turn gets her own |
| `box` | `hostile.py` in the job's own box: tries to read (29 paths and devices), write (16 places), reach the network (8 ways) and the host's sockets (10), gain privileges (11 ways, 5 setuid programs), then hits every ceiling for real (memory, processes, a fork bomb, disk, file size, open files, processor time, run time) and tries to leave processes and files behind |

`--slow` adds the waits at the real time ceilings (about four minutes). The exit code is 0 only when every check
passed; `results.json` under `--out` holds every answer.

Through the web app (a local or staging server; it creates two fictional accounts and stops and starts the
service):

```bash
cd packages/tala-web
pnpm exec tsx scripts/uploads-render-states.mjs http://127.0.0.1:3220 out.json --db "$TALA_DB_PATH" \
  --deck small.pptx --slow-deck a-deck-that-takes-seconds.pptx \
  --socket-unit tala-render.socket --job-units 'tala-render@*.service' --server-pid "$(systemctl show -p MainPID --value tala)"
```

It holds the server to: pictures only for their owner; two teachers at once (one drawn, one told "busy"); a job
killed in the middle (a failed drawing, no half pictures, next one works); the service stopped ("no pictures
here", while saving, both downloads and new uploads work); started again (pictures by themselves after 30 s); and
the web process never starting a program.

The release owner's six checks, and where each is answered:

| Check | Answered by |
|---|---|
| 1. Isolation: no network; no read of the database, the settings, other teachers' files, the wider file system; no write outside scratch | `probe`, `box` (read, write, network, sockets) |
| 2. Hostile files end in a refusal or a timeout and do not harm the web process | `files`, `protocol`; the web process: `uploads-render-states.mjs` and the client tests |
| 3. Ceilings and timeouts by the kernel or systemd, not only the app | `box` (every ceiling hit for real). And one of the hostile files does it by itself: the deck with 30,000 nested shapes was killed by the kernel's memory ceiling within about two seconds with both LibreOffice versions; in one earlier run LibreOffice 26.8 instead spun until the job's own time limit cut it off after 80 s |
| 4. Tenant privacy: a picture only for its owner; scratch removed; nothing of one job left for the next | `uploads-render-states.mjs`, the server tests, `turns`, `box` (orphans, files left behind), `scratch-empty` in every job's report |
| 5. Normal upload, preview, edit, autosave, export, delete | the browser walk `packages/tala-web/scripts/uploads-walk.mjs` (40 checks) with the service behind it |
| 6. Service missing, slow or killed: the editor keeps working, no unsandboxed fallback | `uploads-render-states.mjs`; there is no code that could fall back |

## On a developer's machine

```bash
node dev-units.mjs start [--soffice-dir /path/to/libreoffice] [--fonts-dir /path/to/fonts]
export TALA_DECKS_PREVIEW_SOCKET="$(node dev-units.mjs path)" TALA_DECKS_PREVIEW_SHARED_USER=1
node verify.mjs --user --socket "$TALA_DECKS_PREVIEW_SOCKET" --out /tmp/verify
node dev-units.mjs stop
```

The same job and the same unit lines under the per-user service manager; the units are derived from the files in
this folder and the differences are printed. What a developer's machine cannot have, because only root's service
manager can: the job runs as the developer (not as a user of its own), so it can see the developer's processes
and signal them; `ProtectProc`/`ProcSubset` are not applied by the per-user manager; no packet filter. The job
says so (`isolation: "shared-user"`), and the web app refuses such a job unless it is a local server that asked
for it by name. It needs unprivileged user namespaces, which the production host does not give its service user:
this set-up is for building and testing, never for a server.

## What is verified, and what is not (24 Nov 2026)

Verified by the author on the build machine (Debian 12, kernel 6.1, systemd 252, per-user service manager), with
the unit lines of this folder minus the four that need root:

- with this machine's LibreOffice 26.8 and Node 24: `verify.mjs --slow`, every section;
- with the **Ubuntu 24.04 packages the host will get** (LibreOffice 24.2.7, poppler 24.02, fonts, Python 3.12,
  sudo/su/ping) and Node 22.22.0, unpacked into a folder that takes the place of `/usr`, `/etc/fonts` and
  `/etc/libreoffice` at the production paths, with the production `ExecStart`: `verify.mjs --slow`, every
  section, and the whole corpus (86 of 86 decks drawn);
- the same userland with every non-process entry of `/proc` made unreadable (what `ProcSubset=pid` does on a
  server): probe and drawings still pass;
- the web app with the service behind it: server tests, the browser walk in English and Filipino, and
  `uploads-render-states.mjs` including a job that systemd kills at a 6 s run-time ceiling and one that gives up
  by itself;
- the unit files: `systemd-analyze verify` (no complaint but this machine's missing `/usr/bin/node`), and
  `systemd-analyze security --offline`: exposure 0.7, "SAFE".

**Not verified by the author, because it needs root and the host:**

- `install.sh` has never run for real (only `--dry-run`).
- The four root-only lines: `User=`/`Group=tala-render` (here the job ran as the developer), `RemoveIPC=`,
  `IPAddressDeny=any`; and the socket's owner and group.
- `ProtectProc=invisible` and `ProcSubset=pid` as root's manager applies them, and so the result "sees no process
  but its own". `selfCheck` tests exactly this on every job: if the host does not deliver it, the job refuses.
- systemd 255 and kernel 6.8 (the host) instead of 252 and 6.1; Ubuntu's AppArmor with LibreOffice's profile
  loaded; Ubuntu's own Node package instead of the nodejs.org build.
- Real load: how the host behaves with drawing beside its other services.

For each of these the design answers the same way: the job re-checks its box on the host, on every job, and
draws nothing if the box is not whole. `verify.mjs` as root on a box set up like the host is the test that
closes the list.
