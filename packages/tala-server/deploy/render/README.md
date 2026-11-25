# Slide pictures for teachers' own files: the sandboxed drawing service

"My own slides" shows a teacher real pictures of the slides she uploaded. They are drawn by LibreOffice, and a file
a teacher uploads is untrusted input to a very large program. So the web app does not draw. It hands the file to a
**drawing job** that runs once per file in a sandbox, and takes the pictures back. This folder is that service:
the job, the systemd units that are its sandbox, the installer, and the checks.

Decided by Luis on 24 Nov 2026: a sandboxed renderer, with the pictures kept. What is and is not verified is in
the last section; read it before a release.

The release owner installed the first version as root on a machine set up like the host on 24 Nov: it passed
their six checks, and their own probe found three things a job could still see or do (all of `/usr/local`, the
host's control-group tree, `io_uring`). This version closes them; the job checks the first two itself.

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
| Of the administrator's own programs, only its own | `/usr/local` is an empty read-only folder with one thing bound into it: `/usr/local/lib/tala-render` | kernel (mount namespace) |
| Of the host's other services, nothing | `/sys/fs/cgroup` (the control-group tree: every service by name, with its memory and its process numbers) is an empty read-only folder with one thing bound into it: the job's own group, read-only | kernel (mount namespace) |
| One place to write | `/tmp`: 384 MiB in memory, 8192 files, no programs can be run from it; made for the job, gone with it. `/dev/shm` and `/run` are replaced by empty read-only ones. (The job's private message-queue folder, `/dev/mqueue`, exists too: it holds no files, a few hundred KB of queues at most, and goes with the job) | kernel |
| Memory | `MemoryMax=768M`, no swap; over it, the whole job is killed | kernel (cgroup) |
| Processes | `TasksMax=128` | kernel (cgroup) |
| Processor | `CPUQuota=100%` (one core), `LimitCPU=100` s, low priority | kernel |
| File size, open files | `LimitFSIZE=256 MiB`, `LimitNOFILE=512` | kernel |
| A crash leaves nothing | `LimitCORE=1`: no core file, and the kernel starts no crash handler (apport, systemd-coredump) for the job | kernel |
| Run time | the job gives up at 100 s; `RuntimeMaxSec=120` kills whatever is left | job, then systemd |
| System calls | `@system-service` minus privileged and resource-changing ones, and minus `io_uring` | kernel (seccomp) |
| Other processes | sees none but its own (`ProtectProc=invisible`), cannot trace or signal any | kernel |
| Nothing outlives it | `KillMode=control-group`, `KillSignal=SIGKILL`; scratch, IPC and network are the job's own | systemd, kernel |
| One file at a time | `MaxConnections=1`: two teachers' files are never in the drawing user at once | systemd |

The job **checks all of this itself** (`selfCheck` in `render-job.mjs`) before it reads a byte of the file: not root,
no capabilities, no-new-privileges and a system-call filter in force, no network device but its own loopback and
no way to open a connection, none of a list of host paths in sight, nothing in `/usr/local` but its own program,
nothing of the control-group tree but the way to its own group, exactly one writable place that is in memory,
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
/usr/bin/node packages/tala-server/deploy/render/verify.mjs --socket /run/tala-render/render.sock --out /root/tala-render-verify
```

`--out` is a folder of root's own. The check makes it (for root alone) when it is not there, and refuses a folder
that belongs to someone else, that others can write to, or that is a link; no result file is written through a
link. (A folder under `/var/tmp` or `/tmp` is one another local user could prepare before root runs the check.)

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
- Fonts for drawing have to be installed as packages (under `/usr/share/fonts`). The job does not see
  `/usr/local/share/fonts`: of `/usr/local` it sees its own program and nothing else.
- LibreOffice looks for GnuPG when it starts (it runs `/usr/bin/gpg` and `gpgsm` to ask their version). With
  Ubuntu's AppArmor profile in complain mode that is one "ALLOWED exec" line each in the kernel log per job (seen
  by the release owner on 24 Nov). Nothing is blocked and nothing leaves the box: the programs run inside it, with
  no network and no keys. The unit does not hide them.
- A crash of LibreOffice: the unit sets the core limit to 1, at which the kernel neither writes a core file nor
  starts a crash handler it is told to pipe to (read in `fs/coredump.c` of Linux 6.8; not tried by the author on a
  machine with apport). With the earlier `LimitCORE=0` a host with apport enabled kept a report under `/var/crash`,
  written by apport as root outside the box (seen by the release owner; production has apport masked).
- The host's name: a job can read it with `uname` (it is not a file). systemd 255 can give a unit a host-name
  namespace of its own (`ProtectHostname=`) but not another name in it, so the name stays.

### Do not "harden" the unit with these

`ProtectSystem=`, `ReadOnlyPaths=/` and `DynamicUser=` (which forces `ProtectSystem=strict` and a private `/tmp` on
the host's disk). On systemd 252 their read-only `/` silently takes the place of the empty root, and the job would
see the host's whole file system, read-only (tested here; `selfCheck` then refuses to draw). The empty root is
already read-only. `MemoryDenyWriteExecute=` is left out because Node and LibreOffice make executable memory at
run time.

`ProtectControlGroups=yes`, for the same reason one level down: it is a rule for `/sys/fs/cgroup` that outranks the
empty folder the unit puts there, so with it the whole control-group tree is readable again (tested here on 252:
240 groups and files in sight instead of none; the order of the rules is the same in the source of 255, `MountMode`
in `src/core/namespace.c`). The unit's two lines already make what the job sees of the tree read-only.

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
| Time per deck | median 0.68 s, 90% under 4.4 s, slowest 57 s | median 0.63 s, 90% under 3.1 s, slowest 23 s |
| Peak memory of a job | median 89 MiB, 90% under 214, most 591 MiB | median 166 MiB, 90% under 190, most 505 MiB |
| Largest file / most pictures | 27.7 MiB in, 5.4 MiB of pictures out | the same files |

(The second round's runs of 24 Nov; both shared the machine.) That machine has faster cores than the host. A deck that takes 57 s there may run
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
| `box` | `hostile.py` in the job's own box: tries to read (29 paths and devices), write (16 places), reach the network (8 ways) and the host's sockets (10), gain privileges (11 ways, 5 setuid programs), use `io_uring` (3 calls), see any control group but its own or anything in `/usr/local` but its own program, then hits every ceiling for real (memory, processes, a fork bomb, disk, file size, open files, processor time, run time), dies of a memory fault (no memory image may be made of it), and tries to leave processes and files behind |

`--slow` adds the waits at the real time ceilings (about four minutes). The exit code is 0 only when every check
passed; `results.json` under `--out` holds every answer.

Through the web app (a local or staging server; it creates two fictional accounts and stops and starts the
service):

```bash
cd packages/tala-web
pnpm exec tsx scripts/uploads-render-states.mjs http://127.0.0.1:3220 out.json [--db "$TALA_DB_PATH"] \
  --deck small.pptx --slow-deck a-deck-that-takes-seconds.pptx \
  --socket-unit tala-render.socket --job-units 'tala-render@*.service' --server-pid "$(systemctl show -p MainPID --value tala)"
```

`--db` is only needed where a new account has to confirm its address by mail; a server that verifies accounts by
itself (`TALA_AUTH_AUTO_VERIFY=1`, as on the host) needs none. The step that kills a job waits until a job is
running, kills it, and then looks whether that job is gone; what `systemctl kill` says about a unit that is
already ending is noted in the result, not relied on.

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
node verify.mjs --user --socket "$TALA_DECKS_PREVIEW_SOCKET" --out ~/tala-render-verify
node dev-units.mjs stop
```

The same job and the same unit lines under the per-user service manager; the units are derived from the files in
this folder and the differences are printed. What a developer's machine cannot have, because only root's service
manager can: the job runs as the developer (not as a user of its own), so it can see the developer's processes
and signal them; `ProtectProc`/`ProcSubset` are not applied by the per-user manager; no packet filter. The job
says so (`isolation: "shared-user"`), and the web app refuses such a job unless it is a local server that asked
for it by name. It needs unprivileged user namespaces, which the production host does not give its service user:
this set-up is for building and testing, never for a server.

## What is verified, and what is not (24 Nov 2026, third round)

**By the release owner, as root, on a machine set up like the host** (KVM guest, Ubuntu 24.04.5, kernel 6.8,
systemd 255.4, AppArmor, Node 22.22.0, the host's `tala.service` with `MemoryMax=1G`). With the first version of
this folder: `install.sh` for real and `verify.mjs --slow` 96 of 96; their probe then found the three leaks named
at the top. With the second version (the box as it is here, but for the two lines named below): `install.sh` over
the earlier install, 18 of 18; `verify.mjs --slow` with `--out /root/tala-render-verify`, 100 of 100; and their
own probe in a copy of the installed unit: a canary in `/usr/local/sbin` is not there for the job and `/usr/local`
holds its program only; `/sys/fs/cgroup` holds only the way to the job's own group, which it reads and cannot
write; `io_uring_setup` is refused; a unit whose own group cannot be bound does not start; and after a crash in
the box with apport as the handler nothing is in `/var/crash`. So `User=`/`Group=`, `PrivateUsers`,
`ProtectProc`/`ProcSubset`, `IPAddressDeny`, `RemoveIPC`, the socket's owner, the two new pairs of mount lines on
systemd 255 and `LimitCORE=1` against apport all hold there.

**Two lines of the job changed after that run** and have been run only here, without root: the job sends no
picture larger than the web app takes (2 MiB, was 4), and a `/usr/local` that is there but cannot be listed is no
longer taken as hidden.

**By the author, with THIS version**, on the build machine (Debian 12, kernel 6.1, systemd 252, per-user service
manager), with the unit lines of this folder minus the four that need root:

- with this machine's LibreOffice 26.8 and Node 24: `verify.mjs --slow`, every section, 97 of 97;
- with the **Ubuntu 24.04 packages the host will get** (LibreOffice 24.2.7, poppler 24.02, fonts, Python 3.12,
  sudo/su/ping) and Node 22.22.0, unpacked into a folder that takes the place of `/usr`, `/etc/fonts` and
  `/etc/libreoffice` at the production paths, with the production `ExecStart` and the job in
  `/usr/local/lib/tala-render` as `install.sh` puts it: `verify.mjs --slow`, every section, 97 of 97; and
  the whole corpus (86 of 86 decks drawn);
- the same userland with every non-process entry of `/proc` made unreadable (what `ProcSubset=pid` does on a
  server): probe and drawings still pass (18 of 18);
- the three new probes are real: run outside any box, each reports what a box has to hide (hundreds of control
  groups, hundreds of entries in `/usr/local`, `io_uring` calls that go through); in the box each is stopped. With
  `ProtectControlGroups=yes` put back beside the new lines, the box shows the whole control-group tree again;
- a crash in the box: with the unit's `LimitCORE=1` systemd reports a plain signal and no memory image; with the
  limit lifted, a core dump. (This machine writes core files; it has no piped crash handler.)
- the web app with the service behind it: server tests, the browser walk in English and Filipino, and
  `uploads-render-states.mjs` (20/20 on a site that verifies accounts by itself, as the host does;
  20/20 on one that confirms them by mail), including a job that systemd kills at a 6 s run-time
  ceiling and one that gives up by itself;
- the unit files: `systemd-analyze verify` (no complaint but this machine's missing `/usr/bin/node`), and
  `systemd-analyze security --offline`.

**Not verified as root:**

- The two lines of the job that changed after the release owner's run (above). `verify.mjs` on the host shows
  them: the `probe` section prints the job's own report, and the `draw` and `files` sections draw.
- Ubuntu's own Node package instead of the NodeSource or nodejs.org build; real load beside the host's other
  services.

How systemd 255 applies the two pairs of mount lines (`/usr/local`, `/sys/fs/cgroup`) was first read in its source
(`src/core/namespace.c` of v255: rules for one path are ordered by kind and the first wins, a temporary file
system outranks the implicit rule `ProtectKernelTunables=` has for `/sys/fs/cgroup` and is outranked by
`ProtectControlGroups=`) and then shown by the release owner's run. `LimitCORE=1` was read in `fs/coredump.c` of
Linux 6.8 and then shown the same way.

For each of these the design answers the same way: the job re-checks its box on the host, on every job, and
draws nothing if the box is not whole. `verify.mjs` as root on a box set up like the host is the test that
closes the list.
