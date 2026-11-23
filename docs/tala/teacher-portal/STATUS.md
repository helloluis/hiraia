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
