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

## Release handoff (prepared 2026-11-19; deployed 2026-11-20, see "Production deploy" below)

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
- **Status**: prepared on 2026-11-19 and not pushed or deployed that day (at 14:32 UTC the live site still
  answered `0.1.0+tala-v1-demo.10`). Deployed on 2026-11-20 at 00:23 UTC after Luis authorized it.

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

## Production deploy: 2026-11-20 00:22–00:23 UTC (08:22–08:23 PHT)

Luis: "Look for the work we've done on Tala.hiraia.org and deploy it to production." The coordinator confirmed the
authorization for `tala-v1-demo.11`.

- **Release**: `tala-v1-demo.11` = commit `696d1fc0e` (tag object `d098674e1`), branch `tala-v1-teacher-ui`.
  Pushed at 00:22 UTC with `git push origin tala-v1-teacher-ui refs/tags/tala-v1-demo.11` (no force; nothing else
  was pushed). Rechecked first: origin and live were still on demo.10, `tala-v1-packs-live` had not moved, and
  nothing was building on the host.
- **Backup before deploy**: `/var/backups/tala/20261120T002240Z/` on b11-apps (root only): SQLite online backup
  (`integrity_check` ok), the environment file, `PREVIOUS_RELEASE`, `PREVIOUS_BUILD_ENV`, `SHA256SUMS` (verified)
  and the deploy log.
- **Deploy**: `sudo ssh b11-apps`, then `/opt/tala/deploy.sh tala-v1-demo.11`: exit 0 in 28 seconds (00:22:55 to
  00:23:23 UTC). Built on the host from `696d1fc0e` with pnpm 9.15.9; `current` points at
  `releases/tala-v1-demo.11`; unit `tala` active since 00:23:22 UTC with 0 restarts. No setting was changed and no
  other service was touched.
- **Database**: `decks:001_init` applied at start (13 migrations recorded, 12 before). Tables `decks_decks` and
  `decks_media` exist and are empty. All 24 earlier tables have at least the rows they had in the backup;
  `quick_check` ok.
- **Verified on production** (public URL unless noted):
  - `GET /api/v1/health` answers `0.1.0+tala-v1-demo.11`.
  - The new routes are mounted and reachable through Cloudflare and nginx: `GET`, `POST`, `PUT` and `DELETE` on
    `/api/v1/decks…` answer the app's 401 for a signed-out visitor (404 on demo.10).
  - Twelve static files of the release (art, slide fonts, landing screens) are served byte-identical.
  - In a browser, signed out, at desktop 1366 px (English) and phone 390 px (Filipino): the landing page with the
    new screens, sign-in, the Library front, a draft pack ("still a draft, sign in"), and `/week` and `/slides/…`
    sending a signed-out visitor to sign-in. No console errors apart from the expected 404s for draft content,
    and no sideways scrolling.
  - Host log since the restart: 0 error lines; one warning, the known `auth_auto_verify_on` stop-gap.
- **Checked off production, against production's pack files**: 3,216 of the 3,227 pack files on the host are
  byte-identical to the library the release was tested on, where a sweep with the release code copied and
  exported every built language version (200 copies, 10,372 slides, 0 problems). The other 11 files are one week
  (Grade 7, Term 2, Week 11) that was rebuilt later; its production files were copied to the dev box read-only and
  pass the two-teacher check, 35 of 35 in English and in Filipino.
- **NOT verified on production**: everything behind sign-in. That is This Week, the signed-in Library ("For your
  classes"), the pack pages, the slide carousel, Edit my copy, present mode and the PowerPoint download. No test
  login for tala.hiraia.org exists on the dev box, and this step was told not to create production accounts.
  These flows were verified on the dev box only (same commit, the host's Node line, and the pack files above).
- **Rollback**: `/opt/tala/deploy.sh tala-v1-demo.10` (its release directory is still on the host), or switch
  `/opt/tala/current` back to `releases/tala-v1-demo.10`, write `TALA_BUILD_ID=tala-v1-demo.10` to
  `/opt/tala/build.env` and restart `tala`. Teachers' copies stay in the database either way.
- **Not part of this deploy**: pack data. The host still serves the 28-week snapshot from 2026-11-19 09:14 UTC;
  newer batch output is installed by the pack workstream (`stage-for-deploy.sh`), which this task did not touch.

## Pack library refresh on production: 2026-11-20 03:26 UTC (11:26 PHT)

Luis: "Install the new batch pls I need the latest versions, I'm demoing in 45 mins". Done by this task as deployment
owner, with the pack workstream's own procedure; its owner agent (`0a1a3e5f`) was idle and was sent a note.

- **Source**: the finished batch `priority-2026-11-19` in the pack worktree (68 of 68 weeks, ended 2026-11-19
  13:29 UTC, nothing written since). `stage-for-deploy.sh` staged 204 language versions and left none out as
  mid-build. Nothing in that worktree, the batch or its ledger was changed, and no generation was started.
- **Checked before install, with the release code**: all 204 versions load through the real pack routes, all 612
  downloadable files are served and equal their manifests, and a teacher's copy of every deck can be made and
  exported (0 problems). The snapshot keeps every one of the 56 language versions that were live; only Grade 7
  Term 2 Week 11 is replaced, by its newer build.
- **Backup**: `/var/backups/tala/20261120T032629Z-packs/` (the library that was live as `packs-before.tar`, the
  older `packs.prev` as `packs-prev-before.tar`, the old index, checksums). The library that was live is also
  `/var/lib/tala/packs.prev`. Roll back the data with
  `mv /var/lib/tala/packs /var/lib/tala/packs.new-rolled-back && mv /var/lib/tala/packs.prev /var/lib/tala/packs`.
- **Install**: tarball sha256 `9839519a…df19` verified on the host, all 11,795 files verified against
  `SHA256SUMS`, owner `tala:tala`, then swapped at 03:26:35 UTC. No restart; the release stays `tala-v1-demo.11`.
- **Live now** (public index): 103 of 262 weeks, 204 language versions: 35 draft, 169 draft with open problems,
  0 approved. Every status is unchanged from the staged snapshot, and draft content still answers 404 to a
  signed-out visitor. Term 2 weeks 10 and 11 are built for every grade; Term 3 is complete for Grades 3 to 9.
- **Still unavailable**: 159 weeks. Term 1 except two samples (Grade 4 Week 8, Grade 7 Week 6); Term 2 except
  weeks 10 and 11; Grade 10 Term 3 Weeks 3 and 10 (both languages failed); the Filipino edition of Grade 3 Term 3
  Week 1 and of Grade 9 Term 3 Week 7 (English is there).
- **On the host after the swap**: all 612 downloadable files match their manifests, 0 error lines, 0 teacher
  copies existed at the time (copies do not depend on the library in any case).
- **NOT verified on production**: opening or downloading a pack while signed in (no authorized test login; see
  "Production deploy").

## Mathematics pilot on production: 2026-11-21 13:49–13:51 UTC (21:49–21:51 PHT)

Luis: "Let's get it on production so I can view it directly." The coordinator authorized the Mathematics production
release and the targeted integration it needs, not a wider library expansion.

- **Content and evidence** belong to the Math owner `b11-002:f6c61cce`. Bundle
  `tala-math-six-week-pilot-20261121.tar.gz`, 79,436,215 bytes, sha256 `3d2eeeff…c1d5`, confirmed by the owner over
  the cross-host bridge as the final verified bundle (request `c57f50e7…`, reply `6d7850b3…`). All 1,413 files match
  its `FILES-SHA256.json`; the nine evidence files and twelve pack hashes the owner named match the copy used.
  Six weeks, English and Filipino: Grade 4 Term 3 Weeks 1 and 4, Grade 5 Term 2 Week 10 and Term 3 Week 7, Grade 7
  Term 3 Weeks 2 and 4.
- **Integration (this task)**: branch `tala-v1-math-pilot` = `tala-v1-teacher-ui` with `tala-v1-packs-live` merged
  in, plus `4910276d2` (contract, packs module, staging tool, tests) and `d57b2c18c` (Library and pack pages). The
  pilot is a second pack library BESIDE Science, so a Science refresh cannot remove it. The pack contract was
  widened in exactly the four places that kept the pilot packs out; no pack was relabelled. Slides are shown from
  the delivery's own checked pictures. A pilot deck is not copied for editing and "use for my class" is not
  offered; both would need work that is outside this release.
- **Release**: `tala-v1-demo.12` = `d57b2c18c` (tag object `0f6d28d17`). No database migration, no new setting, no
  dependency change. Checks before release: types clean; tests 250 core, 289 server (8 new), 82 web; the staged
  library validated through the real routes (12 versions, 64 downloads equal to their manifests, 520 slide
  pictures, drafts closed to visitors, Science unchanged); clean-tree build with the host's steps and demo.11 →
  demo.12 → demo.11 → demo.12 on one database under Node 22, with a teacher's Science copy made beforehand: copy
  kept, Science counts identical, 0 migrations, 0 error lines.
- **Data**: `deploy/math-pilot/stage-math-pilot.py` copies an explicit list of files from the bundle and compares
  every hash with the bundle's own records: 626 files, tarball sha256 `6b157550…4b98`. Installed to
  `/var/lib/tala/packs-math` (all 625 listed files verified on the host, `tala:tala`). Review is recorded as it is:
  automatic checks and an AI cross-review passed, no teacher or expert reviewed anything, publication `draft`. The
  solids week also carries its diagram bank and net templates, with the author's note.
- **Deploy window**: held the shared `hiraia` deploy lock from 13:48:36 to 13:51:46 UTC. Backup
  `/var/backups/tala/20261121T134925Z/` (database, integrity ok; environment file; previous release; the Science
  library's checksum-list hash; deploy log). `/opt/tala/deploy.sh tala-v1-demo.12` exit 0 in 28 seconds.
- **Verified on production**: health answers `0.1.0+tala-v1-demo.12`; the Science index is identical to the one
  saved before the release in every field; the Mathematics index lists the six weeks, twelve drafts, 0 approved;
  a signed-out visitor sees no title, no file and no content, and every pilot route answers 404 for them; on the
  host, as the service user, all 64 downloads match their manifests and all 520 slide pictures are present; the
  database has the same rows in all 26 tables, the one teacher copy that existed is still there, no migration ran;
  the Science library's checksum list is unchanged; 0 error lines; in a browser as a visitor, desktop and phone,
  the Library switch, the Mathematics view and the draft page load with no error beyond the expected 404s.
- **NOT verified on production**: everything behind sign-in, for Mathematics and Science alike: opening a pilot
  pack, its lesson plans, slides, carousel, present mode and the seven downloads. No authorized test login exists
  and no account was created. These were exercised on the dev box only, on the same commit and the same bytes.
- **Rollback**: `/opt/tala/deploy.sh tala-v1-demo.11`, which ignores the Mathematics folder; to take the pilot
  away without a code change, `mv /var/lib/tala/packs-math /var/lib/tala/packs-math.removed` (no restart).
- **Not in this release**: the teacher PPTX upload and its preview renderer (owner `b11-002:f500f47c`; nothing of
  it was installed and its pending choice is untouched), any Mathematics pacing or calendar matching, and any
  change to the Science library.
- **Deploy lock, said plainly**: the two production changes of 20 Nov (demo.11 and the Science library refresh)
  were made without the shared deploy lock that `/home/b11/code/AGENTS.md` requires; I had not read that file
  then. Nothing else was deploying at the time. This release held it.

## Filipino interface and revised Filipino Science editions on production: 2026-11-23 10:05–10:08 UTC (18:05–18:08 PHT)

Luis: "Did we deploy all the improvements already? If not please do so now." The coordinator approved the remaining
Tala improvements lane by lane and kept the PPTX renderer question open. What follows is the two lanes that were
ready; the others are in the ledger at the end.

- **Owners and hand-offs** (all read back over the pinned route and hash-checked, then confirmed over the bridge):
  Filipino owner `b11-002:7964278f`: review bundle sha256 `9afd7889…de1c` (866,511,405 bytes, checkpoint 18, 12,164
  files verified) and code patch sha256 `15b5b447…f37f`, both confirmed final (bridge reply `c1a3a8db…`). Science
  source owner `b11-dev:0a1a3e5f`: decisions on the known gaps (reply of 23 Nov, 09:5x UTC).
- **Code**: `tala-v1-demo.13` = `6ebaf2c96` (tag object `f3f139913`), branch `tala-v1-filipino`. `f4937e469` is the
  Filipino owner's patch for tala-core, tala-server, tala-web and the two pack-renderer files (16 files
  byte-identical to the owner's results; three strings files carry every revised line and keep the Mathematics
  keys). `packages/mobile/src/tala/copy.ts` and `packages/tala-mobile/**` from the same patch were left out: not in
  this build, no app build in scope. `6ebaf2c96` lays out question slides as the revised renderer does (checked
  against a rebuilt deck's own picture), puts the Mathematics Filipino strings in the revised voice, and adds the
  overlay tool. No migration, no setting, no dependency change.
- **Data**: the Science library was rebuilt from the live one with `deploy/science-overlay/overlay-filipino.py`.
  **72 Filipino editions taken** from the bundle (70 replace a live edition with its label unchanged, 2 are new:
  Grade 3 Term 3 Week 1 as a draft and Grade 9 Term 3 Week 7 as a draft with open problems). **33 held** and left
  exactly as they were (`filipino-overlay-holds-20261123.json` in this folder): the Filipino owner's 29 (missing or
  conflicting safety directions, answer-key conflicts, evidence a scored item needs, the two weeks never to add)
  and 4 more whose own flags record an unresolved safety conflict (Grade 3 Term 3 Weeks 4 and 7, Grade 5 Term 3
  Week 2, Grade 8 Term 3 Week 11). English: 0 files changed. Counts: 204 → 206 built language versions, 103 weeks,
  0 approved. Overlay tarball sha256 `eaaa7915…8a20d`, 11,916 files verified on the host.
- **Checks before release**: types clean; tests 250 core, 289 server, 82 web; the overlay served through the real
  routes (206 editions, 618 downloads equal to their manifests, 206 teacher copies made and exported, 0 problems);
  clean-tree build and rehearsal under Node 22 on one database: upgrade, library swap while running, code rollback,
  roll forward, data rollback, with three teacher copies made beforehand (edits kept throughout; the copy of a
  replaced edition reports "original updated"), 0 error lines.
- **Deploy window**: shared `hiraia` lock held 10:05:02–10:08:26 UTC. Backup `/var/backups/tala/20261123T100545Z/`
  (database, integrity ok; environment file; previous release; `packs-before.tar` of the library that was live; the
  old index). `/opt/tala/deploy.sh tala-v1-demo.13` exit 0 in 25 seconds; library swapped at 10:06:47 UTC.
- **Verified on production**: health answers `0.1.0+tala-v1-demo.13`; the Science index equals the staged overlay
  (statuses and counts); the only status changes against the index saved before the release are the two added
  Filipino editions; the Mathematics index is identical to before; signed-out visitors still get no draft content.
  On the host, as the service user: all 206 Science editions are whole; exactly the 72 taken Filipino editions
  differ from the previous library, 0 English files, 0 held editions; database rows unchanged in all 26 tables, the
  one teacher copy still there, no migration; 0 error lines. In a browser as a visitor, Filipino and English, desktop
  and phone: landing, sign-in, Library, Mathematics view, draft page, with the revised Filipino wording.
- **NOT verified on production**: anything behind sign-in. The authorized test account exists on production
  (`beanie-reg-20261120-1205@example.com`), but no credential or session for it is retrievable on b11-dev: it is in
  no project document, the two credential stores on the dev box are from October, and the Beaniebot attachment
  inbox is empty since October. Nothing was searched beyond that, no account was created, reset or impersonated.
- **Rollback**: code `/opt/tala/deploy.sh tala-v1-demo.12`; data
  `mv /var/lib/tala/packs /var/lib/tala/packs.rolled-back && mv /var/lib/tala/packs.prev /var/lib/tala/packs`
  (the previous library is also `packs-before.tar` in the backup). Either can be done alone.
- **Open decision for Luis (withdrawal)**: the Science source owner asks to WITHDRAW four live Filipino editions
  whose Filipino text lost safety directions that the English keeps: Grade 6 Term 3 Week 8 (Day 4 instruction cut
  off mid-activity), Grade 3 Term 3 Week 2 (rubber bands near faces, string near the neck, light into eyes), Grade 3
  Term 3 Week 11 (do not look at the Sun), Grade 7 Term 3 Week 6 (tsunami answer lost "do not return after the first
  wave"). They were held, not withdrawn: they are still live exactly as before, as labelled drafts.

### Ledger, 23 Nov 2026

| Lane | State |
|---|---|
| 1. Six-week Mathematics pilot | Live since 21 Nov (demo.12), untouched by this release. Signed-in check on production still not done (no credential route). |
| 2. Filipino interface revisions | Live in demo.13 (web interface, print templates, deck credits, mail texts). Mobile app strings from the same patch not applied: no app build in scope. |
| 3. Revised Filipino Science editions | 72 of 105 live; 33 held (list in this folder); 2 weeks never added (Grade 10 Term 3 Weeks 3 and 10). |
| 4. Teacher PPTX upload, editing, export | Not released. A preview on b11-002, not committed; the owner's own production gates are open; renderer question open with Luis. |
| 5. Combined multi-grade plans, DOCX, print | Not released. Per the owner's 21 Nov status only the core logic exists; DOCX export, the web screen and print pagination tests are missing. |

### Lanes 4 and 5: the owner's hand-over, 23 Nov 2026 18:30 PH (bridge reply `840ceae7…`)

Owner `b11-002:f500f47c`. Nothing of either lane is committed, pushed or installed. Both patches were read back
over the pinned route and match the owner's checksums; they are kept outside the repository.

- **Uploads (lane 4)**: patch against `d57b2c18c`, sha256 `b879fd2c…82c7` (44 files). Checked by the release owner
  in a scratch tree: it applies cleanly on the live commit `6ebaf2c96`; with the patch alone, frozen install with the
  lockfile unchanged, types clean, tests 271 core, 299 server (1 opt-in skip), 89 web. Adds one additive migration
  (`decks:002_uploads`, five tables), no dependency. Nothing is spawned while `TALA_DECKS_PREVIEW_SOFFICE` is unset;
  upload, editing, autosave and export work without it, and the editor then shows text boxes instead of a picture.
  Owner's suggested limits for a first release: 15 MB per file, 50 MB per account.
  **Waiting on Luis**: (1) the renderer question, unchanged: "Should Fable add a sandboxed production renderer before
  enabling PPTX previews, or ship without preview pictures?"; (2) a person to hand-check an edited file in real
  PowerPoint, Google Slides or WPS, or his word to ship without that; (3) the wording of the privacy line (uploaded
  files are kept until the teacher deletes them or her account); (4) his word that the work may be committed.
  Also open: the Filipino pass on the uploads strings.
- **Multi-grade plans (lane 5)**: patch sha256 `bdcf3305…e0be` (7 files), for reading only: library code and 12
  tests, nothing a teacher can reach. The owner is building the editable DOCX export, the combine-and-edit screen,
  the A4 and long-bond print layout, strings and tests, and will hand over patches against `6ebaf2c96`.

### Lanes 4 and 5: second hand-over, 23 Nov 2026 19:15 PH (bridge reply `2f4898e4…`): multi-grade is built

Still nothing committed, pushed or installed. The first hand-over's patches are superseded. All three new patches
are against the live commit `6ebaf2c96`, were read back over the pinned route and match the owner's checksums:
multi-grade alone `a904397d…a08d` (33 files), uploads alone `9c703d7e…5d2a` (44 files), both `8d74eafe…283d`
(74 files). Applied in a throwaway index they give the trees `b0d7c202…` (multi-grade alone), `85cff385…`
(uploads alone) and `f90c49b4…` (both), the last equal to the tree the owner built and tested.

- **Multi-grade (lane 5), what it is**: Lessons shows "Combine lessons for a multi-grade class" to a teacher who has
  a class with two or more grades; one saved lesson per grade becomes one private draft on the existing
  multi-grade template, edited and synced like any plan; the print sheet gains a table layout (A4 and long bond)
  and "Download as Word (.docx)", made in the browser. No migration, dependency, setting, server route or process.
  It also changes three things for every plan: the print page ends with one unsplittable block (signature lines
  and footer), every print sheet offers the Word download, and a multi-grade plan's sheet opens on the table layout.
- **Release-owner checks of the multi-grade patch alone on `6ebaf2c96`** (scratch trees, Node 22.23.4, frozen
  install, lockfile unchanged): types clean; tests 270 core, 288 server (1 opt-in skip), 87 web; production build
  clean with the new `/lessons/combine` route. Rehearsal on one database with the libraries that are live:
  `tala-v1-demo.13` → candidate → back to `tala-v1-demo.13` → candidate. The database keeps its 26 tables
  throughout. On the candidate the owner's browser walk passed 18 of 18 (two and three grades, a teacher's edit
  kept across reload and devices, source lessons unchanged, A4 and long-bond print, Word download, phone,
  Filipino). The Word file is a well-formed document that LibreOffice opens and converts. After the switch back,
  the plans made on the candidate open in the current release's editor with the teacher's note and print in the
  list layout (11 of 11); after switching forward again, 11 of 11. No error lines in any server log.
- **Not verified by anyone**: the Word file in Microsoft Word, Google Docs or WPS; a real printer. The print sheet
  itself says the file "Opens in Word, WPS Office and Google Docs", so this check decides whether that line is true.
- **Open before release** (the owner's gates): (1) Luis's word that the work may be committed; the owner then
  commits multi-grade first and uploads second on `tala-v1-teacher-uploads` and sends the commit ids and a bundle;
  (2) a person to open a sample `.docx` in real Word, Google Docs or WPS, or Luis's word to ship without that;
  (3) the Filipino pass on `combine.fil.ts` and the Filipino halves of `combine-words.ts` and `print/table.ts`
  (first drafts; the Filipino owner has paths and checksums and was asked for the pass on 23 Nov).
- **Uploads (lane 4)**: no change in function; moved onto `6ebaf2c96`; everything in the first hand-over stands,
  including the renderer question.
- Sample files for the hand checks (the owner's, checksum-verified) and screenshots from the rehearsal were
  published as unlisted links for Luis; they expire on 30 Nov 2026.
- **Release plan once the gates close**: take the owner's multi-grade commit, compare its tree with `b0d7c202…`
  plus whatever the Filipino pass changes, repeat the checks above, tag `tala-v1-demo.14` (multi-grade alone,
  no uploads code) and deploy under the lock. Rollback is `/opt/tala/deploy.sh tala-v1-demo.13`; plans combined
  in the meantime stay usable there.

### Lane 5: third hand-over, 23 Nov 2026 19:40 PH (bridge reply `93acaacc…`)

The owner acted on two observations from the release check; nothing is committed. Five files changed in the
multi-grade patch, the uploads patch is byte for byte the same. Read back and verified: multi-grade alone
`3197af66…e765` (tree `45500908…` when applied alone on `6ebaf2c96`), both lanes `a10a7f31…7bf1` (tree
`e79b7e64…`), equal to the owner's values. The difference from the second hand-over is exactly: the print sheet
now says the Word file is "in the .docx format that Word, WPS Office and Google Docs use" instead of claiming it
opens in them; a combined plan's title says a label all its lessons share once ("Day 1 · Grade 4: … · Grade 5: …");
one test and the owner's notes.

- Release-owner checks of this version alone on `6ebaf2c96` (Node 22.23.4, frozen install): types clean; tests 270
  core, 288 server (1 opt-in skip), 87 web; production build clean. The rehearsal (upgrade, browser walk, switch
  back and forward) was run on the second hand-over's version and is to be repeated on the committed one.
- Filipino pass: the Filipino owner started it on request the same evening, finished the three multi-grade files
  and is handing its text to the feature owner, who re-issues the patch.
- Still open: Luis's word that the work may be committed; a person opening a sample `.docx` in real Word, Google
  Docs or WPS, or Luis's word to ship without that; the re-issued patch after the Filipino pass.

### Lane 5: fourth hand-over, 23 Nov 2026 19:50 PH (bridge reply `347c6563…`): Filipino pass in, release content complete

Nothing is committed. Read back and verified: multi-grade alone `f0a27077…0601` (tree `b6125b4d…` when applied
alone on `6ebaf2c96`), both lanes `e988c49a…3b81` (tree `05715727…`), the uploads patch unchanged; all equal to the
owner's values. Against the third hand-over exactly nine files differ:

- **Filipino pass.** The three Filipino files in the patch are byte for byte the files in the Filipino owner's own
  hand-over folder (`combine.fil.ts` `9f6c97ac…`, `combine-words.ts` `a32399ca…`, `print/table.ts` `d39eb6ba…`),
  which that owner confirmed separately over the bridge (`422b4d03…`). Only Filipino values changed (28 of 58);
  keys, placeholders and English are untouched. It is an editorial pass by the Filipino owner, not a teacher's
  review; the print notice still says the draft was made with AI, that no teacher has checked it, and to check
  it before use.
- **One bug fixed**, found by the Filipino owner's notes: with exactly one multi-grade subject, choosing "All grades
  together" snapped back to that subject. The owner's browser walk has a check for it (19 checks now).
- The multi-grade patch contains no uploads code.

Release-owner checks of this version alone on `6ebaf2c96` (Node 22.23.4, frozen install, lockfile unchanged):
types clean; tests 270 core, 288 server (1 opt-in skip), 87 web; production build clean. Full rehearsal on one
database with the libraries that are live: `tala-v1-demo.13` → candidate → `tala-v1-demo.13` → candidate; 26
tables throughout; the owner's walk 19 of 19 on the candidate; after switching back the combined plans open, keep
the teacher's note and print on the current release (11 of 11); forward again 11 of 11; no error lines.

**What is left**: Luis's word that the work may be committed, and a person opening a sample `.docx` in real Word,
Google Docs or WPS (or Luis's word to ship without that). When the owner's commit arrives with parent `6ebaf2c96`
and tree `b6125b4d…`, it is the content rehearsed here and goes out as `tala-v1-demo.14` (multi-grade alone).
The Filipino pass on the uploads strings is also done on the Filipino owner's side; the uploads patch will be
re-issued and stays unreleased.

### Lane 4: fifth hand-over, 23 Nov 2026 20:15 PH (bridge reply `8b58a427…`): uploads re-issued, still not releasable

Nothing is committed. The multi-grade patch is byte for byte the fourth hand-over's (`f0a27077…`, tree
`b6125b4d…`). Read back and verified: uploads alone `5a402f22…4f29` (tree `b2762367…` when applied alone on
`6ebaf2c96`), both lanes `2e4032a0…8d7e` (tree `76da81cd…`), equal to the owner's values. Against the second
hand-over exactly five files differ: the Filipino owner's pass on `uploads.fil.ts` (`6905616e…`, byte for byte the
file in that owner's hand-over folder; 79 of 144 messages revised; an editorial pass, teacher review open), 15
English values and five server messages brought to the same accuracy (wording only, no logic), and the owner's
notes.

- Release-owner check of the uploads patch alone on `6ebaf2c96` (Node 22.23.4, frozen install, lockfile unchanged):
  types clean; tests 271 core, 299 server (1 opt-in skip), 89 web; production build clean with `/library/mine` and
  `/slides/mine/[uploadId]`. No rehearsal yet: it has a migration and server-side file handling, and is to be
  rehearsed in the configuration Luis chooses.
- Still waits on Luis: the renderer question, unchanged ("Should Fable add a sandboxed production renderer before
  enabling PPTX previews, or ship without preview pictures?"); a person opening an edited `.pptx` in real
  PowerPoint, Google Slides or WPS, or his word to ship without that; the wording of the privacy line; his word
  that the work may be committed.

## 24 Nov 2026: renderer decision resolved; nothing new released

Luis, relayed by the coordinator: "Yeah the sandboxed renderer makes sense". The renderer question is resolved for a
**sandboxed production renderer with slide preview pictures kept**. Only the decision is resolved. The feature
owner (`b11-002:f500f47c`) was resumed by the coordinator with the implementation and verification brief; the
release owner implements none of it, receives the checksum-verified hand-off, rehearses and releases.

- **Production, 24 Nov 03:25 UTC (11:25 PHT)**: `tala-v1-demo.13`, running since the release, 0 error lines, 3
  accounts, 1 teacher copy, libraries unchanged. No branch or tag on origin moved.
- **Host facts sent to the feature owner for the sandbox design** (b11-apps, read-only): Ubuntu 24.04.3, kernel
  6.8, systemd 255, KVM, 4 CPUs, 11.9 GB RAM, shared with about 25 other services. **The service user cannot
  create user or network namespaces**: `kernel.apparmor_restrict_unprivileged_userns=1` with AppArmor on; probed as
  user `tala`, `unshare --user --map-root-user` and `unshare --net` both end in "Operation not permitted". So the
  preview's `unshare` step would fail on production, and an unprivileged bubblewrap too, unless an AppArmor profile
  grants it. Not installed: LibreOffice, poppler tools, bubblewrap (all available from apt). No Carlito or Caladea
  fonts. `tala.service` has MemoryMax=1G, NoNewPrivileges, ProtectSystem=strict, no CPU limit, no network or
  namespace restriction. A renderer inside the web process's own cgroup would share that 1 GB ceiling.
- **Before uploads can be released** (the coordinator's list): real isolation, malformed and hostile files,
  resource limits and timeouts enforced outside the app, tenant privacy, normal preview, edit and export; no
  unsandboxed fallback; no seeded preview data. To be checked on a box set up like the host, then on production.
- **Not waived by this decision, still open with their owners**: the Word and PowerPoint application checks; the
  retention and privacy policy for uploads and its wording; the withdrawal of four Filipino Science editions; a
  signed-in check route on production for the release owner.
- **Multi-grade plans**: unchanged, rehearsed and ready (tree `b6125b4d…`). It waits for the feature owner's commit
  and the Word application check. It is not held for the sandbox work.

### Lane 5: sixth hand-over, 24 Nov 2026 11:55 PH (bridge reply `d7edf0b5…`): multi-grade as a commit, staged

The feature owner committed the multi-grade plan on its own reading of Luis's 23 Nov request, which the coordinator
told both of us to use as the standing approval: one local commit on b11-002, nothing pushed there.

- **Commit** `de6bd222ead05526f6aec325efee092cc5f4937a`, parent `6ebaf2c96` (`tala-v1-demo.13`), tree
  `b6125b4d4dcca15c5e78c027688ef9ccab7a7552`, which is the tree rehearsed on 23 Nov. 33 files, all under
  `packages/tala-core`, `packages/tala-web` and `docs/tala/multigrade-plan`. Received as a bundle (78,333 bytes,
  sha256 `61892554…a89b`), read back over the pinned route, checksum equal, `git bundle verify` clean, fetched here
  as local branch `tala-v1-multigrade-plan`.
- **Release candidate, local only**: branch `tala-v1-multigrade` = the notes-only release line merged with that
  commit (`e2b372540` at the time of writing). It differs from the owner's commit only in two files under `docs/`
  and the deploy README. Built the way the host builds (clean export of the host's folder set, Node 22.23.4, frozen
  install, lockfile the same as the live release): types clean; tests 270 core, 288 server (1 opt-in skip), 87 web;
  production build clean with `/lessons/combine`. Not pushed and not tagged.
- **Staged, not deployed.** The one gate left is the Word application check (a sample `.docx` opened in real Word,
  Google Docs or WPS, or Luis's word to ship without it), which the coordinator says is not waived. When it
  closes: recreate the merge on the then-current notes tip, confirm the build set equals the one checked here,
  tag `tala-v1-demo.14`, push branch and tag, back up, deploy under the lock, verify, record. No migration, no
  setting, no data change; rollback is `/opt/tala/deploy.sh tala-v1-demo.13`.
- **Uploads**: not committed. The owner is building the sandboxed renderer as its own systemd service and slice,
  outside the web process's cgroup, and will hand it over separately.

### Lane 4: seventh hand-over, 24 Nov 2026 13:20 PH (bridge reply `10bb18ea…`): uploads with the sandboxed drawing service. Rehearsed; NOT releasable

The feature owner handed over teacher uploads with the sandboxed renderer Luis chose, as a commit on top of the
multi-grade commit: `eba4e6da9874650d8734544fd8383396e788becf`, parent `de6bd222e`, tree `b50cc05d…`, 58 files,
bundle sha256 `cbae3577…845f`; uploads alone as a patch `d5780238…926e` (tree `fbccf077…`). All read back and equal
to the owner's values; fetched here as local branch `tala-v1-my-own-slides`. Nothing of it is installed on
production.

**Shape**: a socket file (`/run/tala-render/render.sock`, 0660 root:tala) starts one hardened systemd job per file
in its own slice and under its own user; the job checks its own sandbox before reading the file and refuses to draw
if anything is missing; the web process holds no code that starts a program; pictures are off unless
`TALA_DECKS_PREVIEW_SOCKET` is set.

**Rehearsal machine**: a KVM guest on the dev box with Ubuntu 24.04.5, kernel 6.8.0-147 and systemd
255.4-1ubuntu8.18 (both identical to production), AppArmor on with the same namespace restriction, Node
22.22.0-1nodesource1, the host's `tala.service` text, the live libraries, the candidate built as `deploy.sh` builds.

**Passed there as root** (what the owner could not run):
- `install.sh` dry run, then for real: 68 packages (LibreOffice 24.2.7, poppler 24.02), user `tala-render`, units,
  first check 18 of 18. On production an apt simulation says 53 new packages, 0 upgraded, 0 removed (its package
  lists date from 20 Oct, so an `apt-get update` may be needed in the window).
- The owner's full suite `verify.mjs --slow`: 96 of 96 (hostile files, protocol abuse, turns, a hostile program in
  the box, every ceiling hit for real).
- The release owner's own probe in an exact copy of the installed job unit: no capabilities, no network of any
  family, an empty root with programs and fonts only, database, settings, home folders and devices absent, one
  small in-memory place to write, no new namespaces or privileges; memory hog killed by the kernel near 736 MiB,
  fork bomb held at 126 children, a sleeper killed by systemd at exactly 120 s.
- Web side: upgrade from `tala-v1-demo.13` on one database (one additive migration, five tables, earlier rows
  untouched); the owner's browser walk 34 of 34 in English and in Filipino with real pictures; tenant checks (a
  picture only for its owner, 404 for another teacher); back to `tala-v1-demo.13` with the new tables (clean
  start, 0 errors) and forward again (0 migrations, uploads intact). The owner's service-state check: 19 of 20; the
  one failure is its own kill step erroring on this systemd while the outcomes it protects all passed.

**Blockers, confirmed by test on that machine** (web process under the host's unit, MemoryMax=1G):
1. A 63 KB file freezes the whole site: one table cell with `gridSpan="4000000000"` held the event loop for more
   than 30 s (`tala-core/src/pptx/walk.ts:274-276`; the attribute may be 250 times larger). Nothing restarts a
   process that is only busy.
2. A 542 KB file kills the web process: seven slides with 1.4 million empty elements each, inside every per-part
   limit, ended in "JavaScript heap out of memory" and a restart. The upload size settings do not help.
3. A taken-over drawing job can read everything under `/usr/local` (a canary script planted there was read), which
   on production holds other services' operational scripts; what it reads can leave in the returned pictures.
Also confirmed: the job can list other services' control groups with their memory figures and process ids, and
`io_uring` is available inside the sandbox. Two independent static reviews list further unbounded paths in the
file reader and exporter (quadratic scans, a size cap that goes by file extension, overlapping zip entries, export
size, stored inspection outside the quota); those are passed to the owner as unverified leads.

**State**: sent back to the feature owner with the evidence (bridge request `efbfec14…`). Uploads stay as a
commit and patches, not installed. Independent of that, two questions remain Luis's: the PowerPoint application
check, and how long uploads are kept with the privacy wording. Multi-grade is not affected and stays staged.

### Lane 4: eighth hand-over, 24 Nov 2026 16:05 PH (bridge reply `4e8d6f39…`): the three blockers are closed by test

The feature owner answered the rehearsal's findings: commit `c6938a492c7da81aae3657eb358f4f330c9a357f` on top of
the seventh hand-over's commit (parent `eba4e6da9`, tree `05294460…`, 37 files), bundle sha256 `003346c5…81f0`;
uploads alone as a patch `99b7d58a…9bbb` (tree `c2e3628a…`). Read back and equal to the owner's values; local
branch `tala-v1-my-own-slides` now points at it. Nothing is installed on production.

**What changed**: an uploaded file is no longer read or written on the web server's thread but in a worker thread
with its own time limit, heap and a budget for the whole job; the stored original is kept and sent in pieces; large
answers are counted while being sent; two more additive migrations (`decks:003`, `decks:004`); the sandbox hides
`/usr/local` and the control-group tree except the job's own corner, denies `io_uring`, and sets the core limit so
that a host's crash handler is not fed.

**The whole run repeated on the same rehearsal machine** (production's kernel and systemd, Node 22.22.0):
- Database: the previous candidate's database upgraded (stored upload back bit for bit); production's path from
  `tala-v1-demo.13` on a fresh database (32 tables, 16 migrations, no earlier row touched); back to `tala-v1-demo.13`
  with the new tables (clean, 0 errors) and forward (0 migrations, upload intact).
- Sandbox as root: reinstall 18 of 18; the owner's suite `verify.mjs --slow` 100 of 100; the release owner's probe
  in an exact copy of the installed unit: the canary under `/usr/local` is gone from sight, no other service's
  control group is visible, the job's own ceiling is readable and not writable, `io_uring_setup` is refused, a unit
  whose own group cannot be bound does not start, and a crash leaves nothing with apport.
- The two files that stopped the site: the column span (also at 999,999,999,999) is read as an ordinary deck in
  about 0.13 s with health answering within 6 ms; the 542 KB element flood is refused in 0.12 s; no restart.
- The owner's hostile set through the real API: 28 of 28. One minute of stress at the limit production will get
  (15 MiB per file; four accounts, 14 MB decks): health 617 asked, 0 failed, longest 492 ms; same process; memory
  group peak 643 MB of 1 GB, never at the ceiling.
- Service states 20 of 20 with automatic verification on; browser walk 34 of 34 in English and in Filipino;
  multi-grade walk 19 of 19 on the combined tree; every live pack edition through the new code (206 editions, 618
  downloads equal to their manifests, 206 teacher copies exported, 0 problems).
- Clean export under Node 22: types clean; tests 302 core, 333 server (1 opt-in skip), 94 web; build clean.

**Did not pass**: the same stress at the code's default limits (30 MiB per file) failed the script's own health bar
on this machine (1 of 428 health checks unanswered, longest answer 7.7 s; no crash, no kill). Production is to run
with `TALA_DECK_UPLOAD_MAX_BYTES=15728640` and `TALA_DECK_UPLOAD_ACCOUNT_BYTES=52428800`.

**Second independent static reviews**: no blocker by reading. Remaining leads, passed to the owner, concern what a
few hostile accounts could do to this feature for other teachers (keeping the single file worker, the sending count
or the drawing slot busy), not the site or anyone's data.

**State**: technically releasable from the release owner's side at the 15 MiB setting. Still open, and Luis's: the
PowerPoint application check, and how long uploads are kept with the privacy wording. For the production window:
`apt-get update` is probably needed first (package lists from 20 Oct), then `install.sh` (53 new packages, none
upgraded or removed in simulation), the owner's suite with a root-only output folder (without the fork-bomb and
memory-hog section, which held on the rehearsal machine), the three settings, deploy, and live checks.

### Lane 4: ninth hand-over, 24 Nov 2026 17:43 PH (bridge reply `133e593c…`): an increment, taken into the first release

Optional increment on top of the rehearsed commit, offered by the feature owner; the release owner took it because
the release waits on Luis anyway. Commit `d1eb90438243a666aea8a4d4ea80fcd2bb3675dd`, parent `c6938a492`, tree
`3d9ea436…`, 20 files, bundle sha256 `e88c3217…3549`; uploads alone as a patch `4b741d07…d05f` (tree `2727397f…`).
Read back and equal to the owner's values. The sandbox's unit files, the installer and the web app's source are
byte for byte the eighth hand-over's. `c6938a492` stays a valid fallback.

**What it changes**: the built-in limits become 15 MiB per file and 50 MiB per account (30 MiB can still be set);
the single file worker is shared out between accounts and a content type is bounded, so one account can no longer
keep it busy with a slow file (the owner reproduced that lead: 7.4 s per read and per download before, refused in
12 ms now); a counted download is let go the moment its client has gone or has taken nothing for 30 s (reproduced
before: about ten minutes of "come back"); a file put back together from its pieces is checksum-checked before it
is written from; the drawing job's picture limit equals the web app's.

**Round on the rehearsal machine, with no size setting**: production's upgrade path clean; sandbox reinstall 18 of
18 and the owner's suite 100 of 100 as root; the release owner's two files harmless as before; the owner's hostile
set with held downloads and one minute of stress 36 of 36 (health 779 asked, 0 failed, longest 0.6 s measured from
a thread of its own; memory group peak 672 MB, never at the ceiling); service states 20 of 20; browser walk 34 of
34 in English and in Filipino; all 206 pack editions validate; back to `tala-v1-demo.13` and forward with a kept
upload, clean both ways. Clean export under Node 22: types clean; tests 303 core, 338 server (1 opt-in skip), 94
web; build clean. With the limit set to 30 MiB the stress had one health answer at 1.3 s (the server's, now
measured separately from the script): the release stays at 15 MiB. Not repeated: the release owner's own sandbox
probes (units unchanged) and the multi-grade walk (web source unchanged). No third static review.

**Known limits accepted for a first release** (the owner's list in `docs/tala/teacher-uploads/STATUS.md` of that
commit): a few hostile accounts can still make pictures late or downloads "come back" for other teachers while
they keep at it. None reaches the site as a whole, another teacher's files or the host.

**State**: `d1eb90438` is the content held for the uploads release. Still open, and Luis's: the PowerPoint
application check; how long uploads are kept and the privacy wording.

## 25 Nov 2026: a new lane announced: public DepEd forms catalogue at /forms (nothing staged)

Heads-up over the bridge (request `de7ad662…`) from `b11-002:2b7a1b9c-eb5a-443f-8ea7-b4fef175cf27`, owner of a DepEd
School Forms task. It reports that Luis authorized building and deploying a public, unauthenticated page at
`tala.hiraia.org/forms`: 32 fillable DepEd school-form PDFs, page previews and a ZIP of the PDFs, all static, to go
through this release pipeline with the release owner. Nothing is staged.

- **Approval**: not yet received by the release owner through the coordinator's thread; asked there on 25 Nov. The
  earlier approval covers the earlier Tala improvements only. No production step before it arrives.
- **Agreed shape** (reply `659e4d43…`): one additive commit with the single parent `6ebaf2c96`, touching only
  `packages/tala-web/src/app/forms/**` and `packages/tala-web/public/forms/**`, merged unchanged into the release
  line so that later releases carry it; static files in the release, not a data directory (15 to 25 MB; `.pdf`,
  `.webp` and `.zip` are not LFS paths in this repository, which matters because the host's deploy skips LFS);
  hand-over as a bundle with checksums.
- **Tag numbers are assigned in the window.** Three releases are now waiting (multi-grade plans, teacher uploads,
  forms); whichever is cleared first takes `tala-v1-demo.14`. The staged scripts under
  `/home/b11/tala-release-20261123/release14/` name that tag for multi-grade and must be renumbered if another
  release goes first.
- **Checks planned**: identity and confinement of the change; build as the host builds; as a signed-out visitor
  every file against its checksum, no API request and no cookie; nothing in the database moves on switch and
  rollback. Asked of the owner: no script, embedded file or submit action in any PDF; no personal name, user name
  or local path in document properties; what the page says about where the forms come from.

## 25 Nov 2026: Luis's four numbered answers, mapped to the four original questions

**The answers** (Luis, 25 Nov 2026 12:27 Manila, relayed by the coordinator, verbatim):

1. Keep all user files in a R2 folder for now
2. Same thing here, keep them in R2 indefinitely
3. That's fine
4. Make a test account for yourself and use it thoroughly to do your testing

**The questions they answer.** The coordinator directed that the numbers be applied to the numbered list in the
release owner's report that opens "The renderer decision is recorded as resolved: sandboxed, with preview pictures
kept" and not to any later list. That report is in the release owner's own session transcript (assistant message
of 2026-11-24T03:30:41Z, 11:30 Manila); its section "Remaining choices" reads, verbatim:

1. **Word and PowerPoint application checks.** This blocks the multi-grade release now and uploads later. Options:
   a person opens the sample files (link, expires 30 Nov); Luis lets me import them into his Google Drive and check
   them in Google Docs and Slides, removing the files afterwards; Luis says to ship without the check.
2. **How long uploads are kept, and the privacy line.** This blocks uploads only. Options: keep each file until the
   teacher deletes it or her account (the owner's proposal), with Luis's wording; or a different rule.
3. **Withdraw four Filipino Science editions that lost safety directions.** This blocks nothing else. Options:
   withdraw them (my recommendation and the Science source owner's request; English stays, reversible), or keep
   them live as labelled drafts.
4. **Signed-in checks on production.** This blocks my live verification of every signed-in feature, current and
   coming. Options: Beanie runs the checklist with its test account; an approved way for me to use that account;
   or permission for a temporary test account that I delete afterwards.

**Mapping and what each resolves**

| # | Question | Luis's answer | Resolved? |
|---|---|---|---|
| 1 | Word and PowerPoint application checks | "Keep all user files in a R2 folder for now" | **No.** The answer picks none of the three options; it is a storage instruction (taken up under 2). The application checks stay open: `waiting_for_user`, question unchanged. Nothing is waived. |
| 2 | How long uploads are kept, and the privacy line | "Same thing here, keep them in R2 indefinitely" | **Yes, the rule**: all Tala user files in private Cloudflare R2 storage, no automatic expiry. An explicit delete by the teacher still deletes. The privacy wording was not given: to be drafted from this rule and shown to Luis. |
| 3 | Withdraw four Filipino Science editions that lost safety directions | "That's fine" | **Yes, for exactly this**: the recommended option, withdrawal of the Filipino editions of Grade 6 Term 3 Week 8, Grade 3 Term 3 Week 2, Grade 3 Term 3 Week 11 and Grade 7 Term 3 Week 6; English stays; reversible. It is applied to nothing else: not to the application checks, the forms page or any other operation. |
| 4 | Signed-in checks on production | "Make a test account for yourself and use it thoroughly to do your testing" | **Yes**: a dedicated, clearly labelled test account for the release owner, synthetic content only. |

Why the numbers are read against this list and no other: answers 2 and 4 fit questions 2 and 4 of this list word
for word (how long uploads are kept; a test account), and only this report has four items with the test account
last.

## Four Filipino Science editions withdrawn on production: 2026-11-25 09:47–09:51 UTC (17:47–17:51 PHT)

**Authority.** Luis's answer 3 ("That's fine") to original question 3 ("Withdraw four Filipino Science editions that
lost safety directions"), as mapped in the section above; the Science source owner (`b11-dev:0a1a3e5f`) asked for
it on 23 Nov and the release owner recommended it. The order, with the question and the answer verbatim, is
`filipino-withdrawals-20261125.json` in this folder. The answer was applied to these four editions and nothing else.

**What changed.** The Filipino editions of `sci26-g6-t3-w08`, `sci26-g3-t3-w02`, `sci26-g3-t3-w11` and
`sci26-g7-t3-w06` are no longer in the live Science library: the site lists that language of those weeks as not
built and serves no page, file, picture or copy of it. Their English editions are untouched. Every other file of the
library is byte-identical to what was live before. No code, setting, database row or Mathematics file changed; the
service was not restarted (same process since 23 Nov 10:06 UTC). The running release stays `tala-v1-demo.13`.

| | before | after |
|---|---|---|
| library version | 2026-11-23 | 2026-11-25 |
| `SHA256SUMS` sha256 | `6f949e3a69183652…` | `03b33ec024cbad185653e52307faa8d54f8b103756967fe76dc205f4e6a156a9` |
| files | 11,917 | 11,680 (238 removed, one record added) |
| editions live (draft / needs fixes / approved) | 36 / 170 / 0 | 35 / 167 / 0 |
| not built | 314 | 318 |
| weeks open / with both languages | 103 / 103 | 103 / 99 |

The week `sci26-g6-t3-w08` is now labelled by its English edition (needs fixes) because the Filipino draft was the
better-labelled of the two; no label of a remaining edition changed and nothing was approved.

**How.** `packages/tala-server/deploy/science-overlay/withdraw-editions.py` (base = a checksum-verified copy of the
live library, order = the file above) wrote the reduced library and `WITHDRAWAL-RECORD.json`, which names each of
the 238 removed files with its checksum. Before the window the result was validated with the live release's own
code: 202 editions, 606 downloads and 202 private copies with 0 problems; the four Filipino editions answer 404 for
detail, download, picture and copy, their English 200. On the host the new library was assembled beside the live one
with hard links (no second copy of its 920 MB), the four editions' folders removed, the three changed files copied in
and compared with the staged ones, `sha256sum -c` clean, owners and modes as before, then swapped with two renames
at 09:47:49 UTC under the shared deploy lock (held 09:47:11–09:51:31 UTC).

**Backup and undo.** `/var/backups/tala/20261125T094735Z/` on the host: the database (integrity ok), the settings,
the index and checksum list as they were, `withdrawn-editions.tar` (the 238 removed files) and the library from
before 23 Nov (`packs-prev-older-da7d4abf`, moved there so that one previous library stays beside the live one).
`/var/lib/tala/packs.prev` is now the library that was live until this window (`6f949e3a…`). Undo, no restart:
`mv /var/lib/tala/packs /var/lib/tala/packs.withdrawn && mv /var/lib/tala/packs.prev /var/lib/tala/packs`.

**Verified on the live site** (09:48–09:51 UTC, the release owner's test account and a signed-out visitor): the
index is the new one and parses (35 / 167 / 0, 318 not built, 103 weeks open, 99 with both languages); each of the
four Filipino editions answers 404 for detail, download and picture to a signed-in teacher while its English opens
and downloads; 35 downloads of nine other editions (five Science, four Mathematics) are still the same bytes as
before; a visitor still gets no draft content; the test account's private copy opens, its original still available.
Host: 0 error lines, 0 server-error responses since the swap; accounts 4, teachers' copies 2, as before. No teacher's
copy or lesson on production depended on a withdrawn edition (checked before the window).

**To put an edition back later**: the corrected Filipino edition comes from the Filipino owner through
`overlay-filipino.py` like any revised edition; all four are on the holds list of 23 Nov
(`filipino-overlay-holds-20261123.json`), so an overlay run does not re-release them by accident.

## Signed-in checks on production with the release owner's test account: 2026-11-25 04:39–04:51 UTC (12:39–12:51 PHT)

**Authority.** Luis's answer 4 ("Make a test account for yourself and use it thoroughly to do your testing").

**The account.** One account, made through the public registration page on 25 Nov 04:39:30 UTC, display name
"Fable Release Test (synthetic)", an `@example.com` address. Its credentials are on the release owner's machine
only (`~/.config/tala-release-test/`, owner-only), never in this repository, a report or a message. It holds
synthetic content only: one class ("Grade 5 Test Section (synthetic)" at "Release Test School (synthetic)"), five
lessons taken from a Grade 5 Science week, and one private copy of an English Science deck with test edits. No
pupil, no real teacher's data. Production went from 3 to 4 accounts and from 1 to 2 teachers' copies.

**Release under test**: `tala-v1-demo.13` as live. Scripts, screenshots (59) and downloaded files are in
`/home/b11/tala-release-20261123/prodtest/` on the release owner's machine.

**Passed**

- Registration through the public page; sign-in through the sign-in form; a wrong password is refused (401); the
  session knows who it is; sign-out asks for confirmation and then the session is gone (401).
- Library, through the API (56 of 56 checks): the Science index (262 weeks, 103 open) and the Mathematics index
  (6 weeks, 12 drafts) load and parse; ten representative editions open (six Science and four Mathematics, English
  and Filipino among them), each labelled a draft with no teacher review claimed; all 38 of their downloads (33.6 MB) are the
  server's own files byte for byte; slide pictures are served; a signed-out visitor gets no draft content, no
  download and no copy.
- Library, in the browser: every main screen opens without an error (9 of 9); the slides viewer; Present on an
  original (the slide counter moves 1 / 56, 2 / 56, 3 / 56) and on a private copy.
- "Edit my copy": a private copy is made, an edit is saved (revision 1 to 2), read back, and the original stays
  untouched; a save from an older version is refused (409); autosave in the editor survives a reload; the copy
  exports as a PowerPoint file that holds the typed words and the draft label; the list holds only this account's
  copies; another teacher's copy cannot be read or exported from this account (404, 404).
- Class set-up through the wizard; "Use these lessons for my class" adds the week's five lessons; the lesson
  editor opens with its AI-draft notice.
- Print: the lesson's print page as A4 (594.96 × 841.92 pt) and as long bond (612 × 936 pt), three pages each; "PDF
  from server" downloads.
- The Filipino interface on the same screens; "Download my data"; phone-size screens with no sideways scrolling.
- Throughout: 0 browser errors; the host logged 0 error lines and 0 server-error responses.

**Failed**

- One cosmetic defect, in the slide engine (the release owner's lane): on a cover slide a long title that wraps
  runs under the "DRAFT — not yet reviewed by a teacher" label. The label stays readable; the teacher's last line
  is cut. Seen in the editor and in Present on the private copy. To be fixed in the next release.

**Not performed on production, and why**

- AI lesson generation (costs money per call; not needed to verify this release).
- Community posting (would publish test text to real teachers), class-list import (takes pupils' names; only
  synthetic ones would be allowed and the feature is unchanged), password change and reset, account deletion
  (the account is kept for coming releases), Google sign-in (switched off on production).
- Teacher uploads and multi-grade plans: not released yet, so not on production. They were exercised on the
  rehearsal machine only, which is not a production check.
- Opening the exported PowerPoint, Word and PDF files in Microsoft Office, Google or WPS applications: not done
  (original question 1 is still open). The files were checked by structure and by this project's own readers,
  which is not an application check.
- Cross-account checks used the one other private copy that exists on production only as a target that must
  answer 404; it was never opened. No second account was made.

## 25 Nov 2026: takeover of the release owner's role by b11-dev:12af59a8 (Opus), replacing bcd615b4 (Fable)

**Why.** Luis, relayed by the coordinator (thread `ddb4d22d`): "Assign Opus to finish off this work in Fable's place".
`bcd615b4` hit a 529 (about 12:54 Manila), resumed, then ran out of usage credits after its R2 test (about 18:00
Manila). It is idle with no pending permission. Its session, worktrees, evidence folders, approvals and attempt
history are kept as they are; it is **not resumed** and is not a second writer. From now on the coordinator and
single production release owner is `b11-dev:12af59a8-bcb2-4b40-af9b-da62a716244d`. A takeover, not a restart.

**Ground truth at 10:24 UTC (18:24 PHT)**, read before any edit: `https://tala.hiraia.org/api/v1/health` answers
`0.1.0+tala-v1-demo.13`, production; `tala.service` active, same process since 23 Nov 10:06:26 UTC, MemoryMax 1 GB;
0 error lines since the withdrawal window; no renderer unit and no R2 setting on the host; deploy lock free; this
worktree clean and equal to `origin/tala-v1-filipino` (`749d89c10`).

**Carried over unchanged**: the mapping of Luis's four answers (section above); the withdrawal of four Filipino
editions (done once at 09:47:49 UTC; not repeated, not undone); the release owner's test account (not duplicated;
credentials stay in `~/.config/tala-release-test/`); multi-grade staged as `de6bd222e` (local branch
`tala-v1-multigrade`); uploads held as `d1eb90438` (fallback `c6938a492`), 15 MiB per file, 50 MiB per account.

**Owners told of the takeover** (10:31 UTC; replies now go to `12af59a8`): uploads and multi-grade `b11-002:f500f47c`
(bridge `0b55d794…`, with one question: is the R2 change being built), forms `b11-002:2b7a1b9c` (`ee3e6f53…`),
Filipino `b11-002:7964278f` (`43f1052b…`), Science source `b11-dev:0a1a3e5f` (Paseo message). The forms hand-over
`118c66ca…` (10:14 UTC) reached `bcd615b4` after its credits ran out and was never answered; it is taken up below.

## 25 Nov 2026: R2 storage for teachers' files: scope, bucket, and the key route proven on real R2

Recovered from `bcd615b4`'s evidence (`/home/b11/tala-release-20261125/r2/` on b11-dev) and its bridge record; not
recorded here before its credits ran out.

- **Scope, from the feature owner's inventory** (bridge reply `b97b336e…`, 12:45 PH, read at `d1eb90438`; accepted
  as the basis in `825b8319…`): the server keeps exactly one kind of file a teacher brings, the uploaded deck of
  lane A (`.pptx`, `.potx`, `.ppsx`). It goes to R2, one object per upload at
  `<TALA_R2_PREFIX>teachers/<account id>/uploads/<upload id>/original`; the database keeps the record, SHA-256, size
  and key. Lane B (multi-grade) stores no file: its Word file is made in the browser. Nothing live stores a file.
  Pictures of uploaded slides are a cache (never the only copy); drawings in teacher copies of pack decks are
  Hiraia's own; plans, combined plans, edits and copies are database records; downloads (edited `.pptx`, pack
  `.pptx`, plan PDF, account export, Word) are made on request and never stored. Explicit delete of an upload and
  account deletion remove the objects; nothing else does. Two questions from the owner go to Luis: class-list
  files (kept in R2, or read and discarded as now; owner advises as now) and whether downloads were meant to be
  saved. Until he answers, neither changes.
- **Bucket and folders (read-only look, 09:56 UTC)**: `hiraia-archive`, private (no public address, no custom
  domain), only the default "abort unfinished multipart uploads after 7 days" lifecycle rule (no object expiry),
  lock rules only on `objects/sha256/` and `snapshots/`, so deletes work under `tala/`. Folders `tala/production/`
  (host) and `tala/rehearsal/` (rehearsal). No bucket, rule or other prefix was changed.
- **Keys**: short-lived, derived locally (no network call) from the parent credential in the main checkout's
  `.env.cloudflare.local` (names only: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`), the same way as
  `tools/reference-archive/mint_credentials.py`, limited to ONE prefix of `hiraia-archive`, object read-write (or
  read-only), at most 24 h. Tool: `r2/mint-tala-r2.py` (refuses any other bucket or prefix; never prints a value;
  output file 0600, never overwritten). Renewal from b11-dev to `/etc/tala/r2-credentials.json` (root:tala 0640,
  replaced by rename) is the planned route; a bucket-scoped key that does not expire may replace it later.
- **Route test on real R2, 09:59–10:00 UTC** (`route-test-20261125T095920Z-b7576e7e.txt`), synthetic 64 KiB object
  under `tala/rehearsal/route-probe/…`: write 200; read back the same bytes; HEAD 200; a second write with
  `If-None-Match: *` refused 412 and the first bytes kept; range 206; outside the folder (production folder, the
  archive's folder, a look-alike prefix, bucket root, another bucket) 403 for read and write; bucket and account
  listing 403; listing inside the folder allowed (not to be relied on); missing name 404; read-only key reads but
  cannot write or delete (403); a 40-second key works, then after expiry is refused 403 (`SignatureDoesNotMatch`,
  not `ExpiredToken`); delete 204, then 404; delete of a missing name also 204. The probe object is gone.
- **State at 10:30 UTC**: the R2 change is NOT built. The owner's branch is still `d1eb90438` and no `TALA_R2` code
  exists in its tree, although `825b8319…` (04:46 UTC) said build on the inventory and `cec15faa…` (10:01 UTC) sent
  the measured facts. Asked the owner why (`0b55d794…`).
