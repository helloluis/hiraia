# Tala teacher portal: friendlier Library, editable slides, calmer This Week — task status

Owner: Claude Fable 5.2 (one owner for this UI task), started 2026-11-19 12:18 UTC (20:18 PHT). Requested by Luis,
relayed by Beanie, to run in parallel with the DeepSeek pack batch (Paseo agent `0a1a3e5f`).

## Ownership check and scope (2026-11-19 12:20 UTC)

- Live site: `https://tala.hiraia.org` answers `0.1.0+tala-v1-demo.10` (commit `87d001ca6`). Its pack data had been
  refreshed since that deploy: 28 built weeks (56 language versions) at 12:20 UTC.
- `tala-v1-packs-live` (`7542d8fe5`) = `tala-v1-demo.10` + 11 commits that touch only `packages/tala-packs/**` and
  `docs/tala/teaching-packs/STATUS.md`. For web, server and core it is byte-identical to what is live, so it is the
  production-compatible base. Local `tala-v1` (91 held curriculum-harvest commits) is NOT in this work.
- The batch (`priority-2026-11-19`, worktree `/home/b11/code/tala-wt/packs`) was running. This task never paused,
  restarted, modified or spent against it; it only READ a consistent snapshot of its output
  (`stage-for-deploy.sh` → `/tmp/tala-ui/packs`) to design against real English and Filipino packs.
- Workspace: branch `tala-v1-teacher-ui` cut from `tala-v1-packs-live`, worktree `/home/b11/code/tala-wt/ui`
  (sparse: the host's set plus `packages/tala-packs/library/` for tests and `docs/tala/`). No new dependencies; the
  root lockfile is untouched, so the host's `--frozen-lockfile` install is unchanged.
- Paths this task owns on the branch: `packages/tala-web/**` (screens, components, strings, scripts, `public/art`),
  `packages/tala-core/src/contracts/decks.ts`, the `decks.*` and `packs.media` routes in `contracts/api.ts`,
  `packages/tala-core/src/decks/**`, `packages/tala-server/src/modules/decks/**`,
  `packages/tala-server/src/modules/packs/library.ts` (+ the small change in `packs/index.ts` to use it),
  one line in `modules/index.ts`, and this folder. Not touched: `packages/tala-packs/**`, the pack library, pack
  data, `main`, `tala-0.4.x`, `packages/tala/**`, `packages/mobile/**`, CI, the lockfile.
- Not done by this task: push, tag push, production deploy, service restarts. Release is handed to Luis's release
  process (see "Release handoff").

## What changed for a teacher

See `README.md` in this folder (design decisions, the demo path, how to check it).

## Release handoff (prepared, NOT deployed by this task)

Luis asked for this to go to tala.hiraia.org as soon as it is ready; the coordination notes say this task must not
push, change production or restart services itself. So the release is packaged for Luis's release process:

- **Candidate**: branch `tala-v1-teacher-ui`, tag `tala-v1-demo.11` (local only until the release operator pushes
  it). Built on `tala-v1-packs-live`, i.e. on what `tala-v1-demo.10` runs plus the pack-pipeline commits; the 91
  held `tala-v1` commits are still not in it.
- **Steps for the operator** (same kit as demo.10, `packages/tala-server/deploy/README.md`):
  1. `git push origin tala-v1-teacher-ui tala-v1-demo.11` (no force).
  2. On the apps host as root: back up first —
     `d=/var/backups/tala/$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$d" && sqlite3 /var/lib/tala/tala.db ".backup '$d/tala.db'" && cp -a /etc/tala/tala.env "$d/"`
  3. `/opt/tala/deploy.sh tala-v1-demo.11` (builds beside the running release, switches, restarts, checks
     `/api/v1/health`, switches back by itself if the new release does not come up).
- **Database**: one additive migration, `decks:001_init` (tables `decks_decks`, `decks_media`). It runs at start.
  Nothing existing is altered. Do not edit that SQL after it has been applied anywhere.
- **Settings**: none to add or change. No new directory. Pack data in `/var/lib/tala/packs` is untouched and keeps
  being refreshed by the pack workstream's snapshots; copies do not depend on it.
- **Rollback**: `/opt/tala/deploy.sh tala-v1-demo.10`. The older code ignores the two new tables and the recorded
  migration (the runner only checks migrations it knows), so teachers' copies simply wait in the database until
  the newer release is back. No data rollback is needed; the backup from step 2 is the safety net.
- **After deploy, check**: health reports `tala-v1-demo.11`; the start-up log has `migration_applied` for
  `decks:001_init` and no `error` line; then the demo path in `README.md` with a temporary account (deleted
  afterwards through `POST /api/v1/account/delete`).
- **Lineage rule, updated**: the next deploy cut from `tala-v1` must merge `tala-v1-packs-live` AND
  `tala-v1-teacher-ui`, or it drops the library and this rework.
- **Still not live after this task**: everything. Nothing was pushed, tagged on origin or deployed. At 14:32 UTC
  (22:32 PHT) on 2026-11-19 the live site still answered `0.1.0+tala-v1-demo.10`.

## Verification (2026-11-19; code as of `449c07675`, the tag adds only the notes in this folder)

Everything below ran on the dev box against local servers with invented teachers and a read-only snapshot of the
pack library. The only request made to production was a read of `/api/v1/health`.

| Check | Result |
|---|---|
| Type-check of `tala-core`, `tala-server`, `tala-web` | clean |
| Unit and contract tests | core 250 of 250 · server 281 of 281 (280 plus the opt-in real-deck reader test) · web 82 of 82 |
| Two teachers and one unchanged original (`scripts/decks-acceptance.mjs --library`) | 35 of 35, on an English and a Filipino pack, on the dev and the production build |
| The same after a newer library snapshot is swapped in the way the host does it (`--snapshot`) | 43 of 43: both copies and their drawings intact, neither teacher sees the other's copy, the original is reported as updated |
| An original that changes, or is withdrawn, after the copy was made | the copy still opens, presents and exports; "Put this slide back" uses the slides as first copied |
| Export read by an independent library (python-pptx), then saved and re-opened | every slide, list, picture and notes page parses; fonts are Cambria and Calibri |
| Export rendered by LibreOffice 26.8 beside the browser | same line breaks and positions on the decks checked (English and Filipino) |
| Browser walk, desktop 1366 px, English, production build | find the pack → carousel by keyboard → Edit my copy → change an example → "Saved" → reload → present → download → add, duplicate, move, delete, undo, put back → edit while offline → a save from a second tab is a conflict the teacher resolves |
| Browser walk, phone 390 px, Filipino, production build | the same path by touch |
| Unsaved work after a refresh | offered back and restored when the save could not reach the server (checked separately; the scripted walk saves too fast to show it) |
| Present mode | the slide fills the screen at 1280×720, 1920×1080 and 1366×768; letterboxed at 1024×768, 844×390 and 390×844 |
| Clean tree built with the host's steps (`deploy.sh`: frozen-lockfile install filtered to `tala-web`, `next build`) | `tala-v1-demo.10` and the candidate both build; lockfile unchanged; `public/` and all three `src/` trees byte-identical to the tree the screenshots came from |
| Upgrade → rollback → roll forward on ONE database, with those two builds | `decks:001_init` applied on upgrade; acceptance 34 of 34 (no `--library`); after rollback demo.10 signs the teacher in, serves all 13 records and the library, and answers 404 for `/decks`; after rolling forward the copy and its edit are there; 0 error lines in all four logs |

## One change outside the screens: where a mid-term set-up starts

`proposeStartPosition` (`packages/tala-core/src/pacing`) picked the first competency that still had ANY later
session. A teacher setting up in week 10 of a term was started on a competency from week 1 ("Life Cycles of
Animals") instead of the one the calendar is on, so This Week and the Library had nothing matching to show. It now
picks the competency whose next session is nearest on or after today (commit `c9c8af440`, test
`modules/curriculum/start-position.test.ts` on the real Science curriculum for every grade). It changes only the
position PROPOSED on the set-up screen; classes already set up keep their saved positions.

## Known limits

- The exported PowerPoint was checked with python-pptx and LibreOffice. It has NOT been opened in Microsoft
  PowerPoint or Google Slides.
- Browser checks ran in Chromium only, at desktop and phone sizes with touch emulated. Not tested: iOS Safari, a
  real Android phone, a screen reader, and the real full-screen API (a headless browser has no screen, so present
  mode was measured filling the window).
- The editor changes words: titles, lines, choices and teacher notes. It adds, duplicates, moves and deletes
  slides and can place a drawing the deck already has. It does not upload a teacher's own picture, change fonts
  or colours, or move things around on a slide. The cover and the credits slide stay with every copy.
- No sharing. A copy is visible to its owner only; the knowledge-sharing area is later work.
- "Download my data" (`account.export`) does not include slide copies yet; each copy can be downloaded as a
  PowerPoint file. Deleting an account deletes its copies; merging two accounts keeps the copies of both.
- The landing page still shows the earlier picture for Community.
- Packs are still drafts and say so on every cover, page and slide. This work changes how they are shown, not
  what they say.

## Release path check (2026-11-19 23:11–23:18 UTC; 07:11–07:18 PHT on 20 Nov): read-only, nothing deployed

Asked for by the coordinator after Luis approved the release. Every check below only reads: nothing was pushed,
fetched into the host repository, restarted or written on the host, and the database was not opened.

- **State**: worktree `/home/b11/code/tala-wt/ui`, branch `tala-v1-teacher-ui`, clean, HEAD `696d1fc0e`. Tag
  `tala-v1-demo.11` (annotated, tag object `d098674e1`) points at `696d1fc0e` and is local only: origin has no
  such branch or tag, and the newest tag in the host repository is `tala-v1-demo.10`. Live answers
  `0.1.0+tala-v1-demo.10`.
- **The standard path** is the kit in `packages/tala-server/deploy/`, used the same way for demo.10: push the
  branch and the tag from b11-dev, then run `/opt/tala/deploy.sh <tag>` as root on b11-apps. There is no other
  release mechanism for Tala: none of the four GitHub workflows mentions Tala, a deploy or SSH (their runners are
  GitHub-hosted or the macOS app runner, with no route to the private host), there is no `paseo.json` and no
  Paseo schedule, and the status dashboard is read-only.
- **Push**: origin is `git@github.com:helloluis/hiraia.git`. `git push --dry-run --no-verify origin
  tala-v1-teacher-ui refs/tags/tala-v1-demo.11` is accepted (new branch, new tag; 10 commits, 214 objects), and
  origin was unchanged afterwards. The pre-push hook is Git LFS; this release changes no LFS file.
- **Host access from b11-dev**: both documented routes answer `root` on `b11-apps`: `sudo ssh b11-apps`
  (`/home/b11/PRODUCTION-ACCESS.md`) and `ssh -i ~/.ssh/prod_ed25519 -o
  UserKnownHostsFile=~/.ssh/known_hosts_ovh_guests root@10.77.0.20` (`deploy/README.md`, the route demo.10 was
  deployed through).
- **On the host**: `/opt/tala/deploy.sh` is `root:root`, mode 755, and byte-identical to the kit's script at
  demo.9, demo.10 and demo.11 (sha256 `c25da204…ba98`). It has no dry-run mode. `current` points at
  `releases/tala-v1-demo.10`; there is no `releases/tala-v1-demo.11` and no half-switched link. Unit `tala` has
  been active since 06:01:36 UTC with 0 restarts and 0 error-level log lines. git 2.43, Node 22.22.0, pnpm and
  sqlite3 3.45.1 are present; 169 GB of disk and 7.7 GB of memory are free; `/var/backups/tala/` holds the one
  backup from the demo.10 deploy. The host repository can read origin, and its release worktrees use the sparse
  set this release was rehearsed with.
- **Health and version**: only `GET /api/v1/health` exists (`system.health` in `contracts/api.ts`, mounted by
  `tala-web/src/app/api/v1/[...path]`; nginx proxies `/` to `127.0.0.1:3220`). `/api/health`, `/healthz` and
  `/health` return the app's 404 page; `/api/v1/version` is a JSON 404.
- **Node**: the dev box default is Node 24.21 and the host runs 22.22. The clean-tree build and the upgrade →
  rollback → roll-forward rehearsal were repeated under Node 22.23.4: both builds pass, `decks:001_init` applies,
  acceptance 34 of 34, the edit survives the rollback, 0 error lines.
- **Blockers**: none technical. The release was not run in this step because the step was scoped read-only.
