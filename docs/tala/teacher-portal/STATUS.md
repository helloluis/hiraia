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

## 25 Nov 2026 10:40 UTC: the uploads owner is blocked until 1 Dec; the R2 change is built by the release owner

**What stopped lane A.** The feature owner `b11-002:f500f47c` runs on Fable. Read on its host (its own Paseo log,
read-only, because the bridge's `messages` request fails on this Paseo version): after `825b8319…` (04:46 UTC) it
designed the whole R2 change, then stopped on `API Error: 529 Overloaded`; woken by `cec15faa…` (10:01 UTC) it
refined the design and stopped on **"You've hit your Fable limit · resets Dec 1, 4am (Asia/Manila)"**; the takeover
notice `0b55d794…` met the same limit. No line of the R2 change was written (branch still `d1eb90438`). Its design
is kept privately on b11-dev (`/home/b11/tala-takeover-20261125/uploads-owner-log-tail400.txt`, 0600).

**Decision (release owner, under Luis's "Assign Opus to finish off this work in Fable's place").** Rather than wait
six days or start a replacement worker, the release owner implements the R2 change itself, following the owner's
inventory and design point by point, as a further commit on top of `d1eb90438` (lane B untouched): worktree
`/home/b11/code/tala-wt/r2`, local branch `tala-v1-uploads-r2`. The owner's commits, branches and worktree are not
touched; when it is back it reviews the commit like any hand-over. The sandbox, its units and the 15 MiB / 50 MiB
limits stay exactly as rehearsed.

**Forms (lane of `b11-002:2b7a1b9c`): verified, held for the go-ahead.** Hand-over `118c66ca…` read back over the
pinned route: bundle sha256 `fa5bb2fd…` (10,230,376 bytes), `SHA256SUMS` `cbf0b783…`, `EVIDENCE.SHA256SUMS`
`373dc813…`, all equal to the owner's values; `git bundle verify` clean; commit `f425585bc`, tree `bc43c58a…`, one
parent `6ebaf2c96`, 126 paths, all added, all under `packages/tala-web/src/app/forms/`,
`packages/tala-web/public/forms/` or `docs/tala/forms/README.md`. Local release candidate `tala-v1-forms` =
`585232d1e` (notes tip merged with it; differs from the owner's commit only in notes and deploy tooling). Checked the
way the host builds (Node 22.23.4, frozen install, lockfile the same as the live release): types clean in all three
packages; tests core 250/250, server 288 (+1 opt-in skip), web 82/82; production build clean with the static
`/forms` route; the 123 public files byte-identical to the owner's manifest and nothing else. Its own build on a
scratch database, signed out: `/forms` 200 with the "unofficial copies" notice, the ZIP and a PDF served
byte-identical, `/api/v1/decks` 401, no cookie set. Not deployed: the forms owner recorded with `bcd615b4` that the
release owner deploys after Luis's go-ahead reaches it in the coordinator's thread, and the brief of this takeover
says no public `/forms` release unless that authorization is recovered there.

**waiting_for_user (asked once, in the coordinator's thread `ddb4d22d`, 25 Nov ~10:50 UTC)**

| # | Exact question | Owner | Dependent work |
|---|---|---|---|
| A | Original question 1, unchanged: Word and PowerPoint application checks. A person opens the samples (index link, expires 30 Nov) in Word / PowerPoint, Google Docs / Slides or WPS; or Luis says to ship without the check. | Luis | multi-grade release; uploads release |
| B | Go-ahead for the public `/forms` page, here in this thread. | Luis | forms release |
| C | The privacy line on the upload screen, drafted from Luis's rule (EN; Filipino from the Filipino owner after): "Files you upload are kept in Tala's private storage. Other teachers can't see them. They stay until you delete them or your account." | Luis | uploads release |
| D | The uploads owner's question: should class-list files a teacher imports (pupils' names) also be kept in R2, or stay read and discarded as now (owner advises as now)? | Luis | none now; until answered, as now |
| E | The uploads owner's question: did "user files" mean saving each Word or PowerPoint file a teacher downloads? Nothing downloaded is stored today. | Luis | none now; until answered, nothing stored |

## 25 Nov 2026 11:05–11:47 UTC: the R2 change built, checked on real R2 and rehearsed (not deployed)

**Identity.** Commit `e6e23c1670f5db7a0e289876cdfa9603c5c26446`, parent `d1eb90438`, tree `c75458f8e4044d105083db5e94f3df8d767a7fbe`, 22
files; local branch `tala-v1-uploads-r2`, worktree `/home/b11/code/tala-wt/r2`. Release candidate (local, not pushed,
not tagged): branch `tala-v1-uploads` = `5e5195963`, the notes tip merged with it; it differs from `e6e23c167` only in
notes and deploy tooling. It carries the multi-grade commit `de6bd222e` beneath the uploads commits.

**What it does** (the feature owner's design; details in `packages/tala-server/deploy/r2/README.md`): one object per
upload at `<prefix>teachers/<account>/uploads/<upload>/original` in `hiraia-archive`, written with no overwrite,
read back and checked before it is recorded; downloads checked against the SHA-256 before their last piece; delete
of a file or an account removes its objects, retried until done; nothing expires, lists or sweeps; staging and
production take no upload without the settings. Keys: 24 h, one prefix, renewed every six hours from b11-dev by
`deploy/r2/renew-r2-keys.py` + `tala-r2-renew.timer` (lingering is on for `b11`). The sandbox and limits unchanged.

**Checked the way the host builds** (Node 22.23.4, frozen install, lockfile the same as the live release): types
clean; tests core 303/303, server 356 + 1 opt-in skip (the earlier 338 + 1, plus 5 Signature V4 tests against AWS's
published examples and 13 storage tests against a fake S3 server), web 94/94; production build clean.

**Real R2, `tala/rehearsal/`, the server's own client, synthetic bytes** (`scripts/decks/r2-check.ts`): 12 of 12,
twice (with a key from the earlier tool and one from the new kit): write with `If-None-Match` and Content-MD5, read
back whole and in 512 KiB pieces, 412 on a second write, a wrong checksum is "damaged", 403 outside the prefix,
removed, 404. A 45-second key refused after its end (403 `SignatureDoesNotMatch`); with a renewed file renamed into
place the next request succeeded, no restart.

**Rehearsal machine** (Ubuntu 24.04.5, systemd 255.4-1ubuntu8.18 and Node 22.22.0 as on production; kernel
6.8.0-149 there against 6.8.0-147 on production; built as `deploy.sh` builds; tunnels only):
- **No R2 setting, staging**: migration `decks:005_upload_objects` applied (17 migrations, 33 tables);
  `deck_upload_storage_off` logged; a new upload refused `503 uploads_off`; an upload kept in the database by the
  earlier candidate still downloaded.
- **R2 on**: key installed by the kit's own install step (root:tala 0640, checksum equal); that earlier upload
  (648,274 bytes) moved to R2, read back, its database pieces removed; `r2-verify.ts` as the service user: ok.
- **The owner's browser walk, real slide pictures**: English 38/38, Filipino 38/38 (the original byte for byte from
  R2; another teacher 404 on all six routes, an empty list).
- **Hostile set and one minute of stress at 15 MiB**: first run 34/36: health slow 10 of 845 times (longest 4.36 s)
  with the measuring thread's own timer 3.84 s late (CPU pressure in the VM avg60 15 %, on the devbox 18 %); the
  control on `d1eb90438` right after: 36/36 (longest 253 ms); the candidate again: 36/36 (1,025 health answers, the
  longest 160 ms, timer at most 20 ms late; memory group peak 521 MB of 1 GiB; no kill, no restart). Not reproduced;
  recorded as it happened, not explained away.
- **Drawing service states**: 20/20 (service stopped: saving, the edited download and the original, identical).
- **Live outage** (the VM's HTTPS egress blocked): finishing answered `503 upload_storage_unavailable` after 11.1 s
  with every piece kept; downloads `503 download_storage_unavailable` at once; health 2 ms; saving 200; delete 200.
  Restored: finishing again resumed from the pieces, the file back byte for byte; log: unavailable once, back once.
- **Expired key on the running site**: the next download `503`, logged as refused 403; the kit renewed the file,
  the next request 200 with the same bytes, 0 restarts.
- **Rollback**: `tala-v1-demo.13` started clean (0 errors; the uploads' tables untouched; its routes absent), then
  forward: 0 migrations, 0 errors, both objects verified ok.
- **Cleanup**: every rehearsal upload deleted through the API; their objects removed by the server; the outage's
  uncertain write removed a second time ten minutes later (11:46:38); the table of intents empty; R2 lists 0 objects
  under `tala/rehearsal/`. The rehearsal machine is powered off again.

**The release candidate `5e5195963`, checked the way the host builds**: the same results (types clean; core 303,
server 356 + 1 opt-in skip, web 94; build clean with `/lessons/combine`).

**Left for a later release**: the cosmetic cover defect found on production (a wrapped title's last line under the
DRAFT label: the cover's text box ends at 6.5 in, the label starts at 6.25 in). The fix (end the text above the label
when it is shown) moves every draft cover in every teacher's copy and download, so it gets its own visual check
rather than riding along with these rehearsed releases.

**Not repeated, because the code is byte for byte the same as round 9**: the sandbox (`deploy/render/**` and
`upload-render.ts`: 100 of 100 as root), the multi-grade walk (19/19) and the 206 pack editions (no multi-grade,
packs or library code changed; the only web change is the privacy line).

**Still waiting** (asked once today): A (Word and PowerPoint application checks) and C (the privacy line's words).
The Filipino version of C came from the Filipino owner (bridge `4a8729cc…`): "Nakatabi sa pribadong storage ng Tala
ang mga file na in-upload mo. Hindi makikita ng ibang guro ang mga ito. Mananatili roon ang mga file hanggang
burahin mo ang mga ito o ang account mo." Both texts are in the candidate as drafts.

### 11:48–11:57 UTC: a production difference the rehearsal machine hid, fixed and rehearsed again

Preparing the window, the release owner read production's `/etc/tala`: **0700 root:root** (the rehearsal machine
had 0755). The web server runs as `tala` and reads its R2 key file itself (to take renewed keys without a restart),
so a key at `/etc/tala/r2-credentials.json`, the place agreed on 25 Nov, could never have been read on production:
uploads would have failed at the first teacher's file. Nothing existing on the host is changed for it instead:

- **Commit `f27868a55d1853ce0e868d3d1837e2628d4509cb`** (on `e6e23c167`, tree `62a05b43f60d869faea7a010e19e1188a0645123`):
  the key lives in a folder of its own, `/etc/tala-r2` (root:tala 0750; file root:tala 0640); the renewal kit makes
  the folder and refuses an install that the user `tala` cannot read; the server reads the key once at start and
  says "cannot be reached by this server's user" when a folder bars it. Tests: server 356 + 1 opt-in skip (one more
  check inside the credentials test), core 303, web 94.
- **Release candidate `tala-v1-uploads` = `50f0868bd`** (local; notes tip `360448ff7` + `f27868a55`), checked the way
  the host builds: types clean; core 303, server 356 + 1, web 94; build clean.
- **Rehearsal machine set like production** (`/etc/tala` 0700 root:root): with the key at the old place the server
  logged at start `deck_upload_storage_keys_unusable: the credentials file cannot be reached by this server's user`
  (the failure production would have had, now visible at start); the kit installed the key in `/etc/tala-r2`
  (folder root:tala 0750, file root:tala 0640, checked readable by `tala`, checksum equal); after the setting and a
  restart the key was read at start; `r2-check.ts` as the user `tala` with only the `TALA_R2_*` settings, given on
  standard input (so the endpoint is on no command line): 12 of 12 on real R2; the owner's English browser walk
  38/38. The rehearsal folder in R2 is empty again (0 objects); the machine is powered off.
- The window script (`/home/b11/tala-takeover-20261125/release-uploads/window-uploads.sh` on b11-dev) uses the new
  place and checks the build set against `50f0868bd` before tagging.

## 25 Nov 2026 14:11 UTC: Luis approves the public forms page (question B resolved)

**Luis, relayed by the coordinator in thread `ddb4d22d` (25 Nov 2026, about 22:10 Manila), verbatim:** "No just publish
all the forms, stop overthinking their usefulness, I'm just publishing them so I have a discussion point with
possible partners". The coordinator's note: this is Luis's explicit approval in the coordinator thread to publish
the prepared forms-only change `f425585bc503cbafe9e4a79929c1a33625f10839` at `tala.hiraia.org/forms`,
unauthenticated, with all 32 PDFs; these are partner-discussion materials, and further usefulness reviews or
current-version certification are not release prerequisites; keep the existing notices without expanding the work.

**waiting_for_user, updated**: B is **resolved** (approved). Still open: A (Word and PowerPoint application checks)
and C (the privacy line's words); D and E stay optional. The forms release goes first and takes `tala-v1-demo.14`;
the uploads release with the multi-grade plan takes the next number.

## Public forms catalogue on production: 2026-11-25 14:14–14:17 UTC (22:14–22:17 PHT) — `tala-v1-demo.14`

**Authority.** Luis's approval above (question B), relayed by the coordinator in thread `ddb4d22d`.

**Release.** Tag `tala-v1-demo.14` (tag object `31d920f16391d78b2ba6fd3f97c731d794704768`) on commit
`40b6f201edb13ff3aabc5432d8ef55393321180b` = the approval note `4a2895b5e` merged with the forms owner's commit
`f425585bc503cbafe9e4a79929c1a33625f10839`, unchanged. Its build set equals the candidate checked the way the host
builds (`585232d1e`); against `tala-v1-demo.13` nothing outside `src/app/forms/` and `public/forms/` differs. Pushed:
branch `tala-v1-forms`, the tag, and `tala-v1-filipino`, which now fast-forwards to the release commit, so that
**every later release carries `/forms`**.

**Window** (shared deploy lock held 14:14:01–14:16:56 UTC; no other work in flight): backup
`/var/backups/tala/20261125T141441Z` on the host (database `integrity_check` ok, 26 tables counted, settings copy
equal to the live one, previous release, library hashes; checksums verified); `/opt/tala/deploy.sh tala-v1-demo.14`
14:14:45–14:15:12 (build, switch, restart, health), live since **14:15:11 UTC**; no migration, no setting, no data
change.

**Verified live** (14:15–14:17 UTC):
- health `0.1.0+tala-v1-demo.14`, production; release commit on the host `40b6f201e…`; 0 restarts.
- `https://tala.hiraia.org/forms` signed out: 200, **32 forms**, the "unofficial copies" notice, no cookie set.
- **All 123 public files** fetched anonymously and **byte-identical** to the owner's manifest (`SHA256SUMS`
  `cbf0b783…`): 32 PDFs (`application/pdf`), 89 previews (`image/webp`), the ZIP, one text file. The ZIP holds
  exactly the 32 published PDFs, byte for byte.
- A fresh headless browser, desktop and phone: 32 cards; 91 of 91 pictures load (the 57 previews sit in closed
  sections and load when opened); 0 console errors; 0 failed requests; 0 cookies; no sideways scrolling. Requests go
  to `tala.hiraia.org` and to `static.cloudflareinsights.com`: Cloudflare's own analytics beacon, added at its edge to
  every page of the site (seen on `/sign-in` too), not part of this release.
- Private pages stay private: the contract's 17 private GET routes all answer **401** signed out; with the release
  owner's test account sign-in works, the Science (262 weeks) and Mathematics (6) indexes and its private copy
  answer 200, and after sign-out the session is refused (401).
- Host: 0 error lines, 0 server errors since the start; no table's row count changed (26 tables); both libraries'
  checksums unchanged.

**Rollback**: `sudo -n ssh b11-apps /opt/tala/deploy.sh tala-v1-demo.13` (code only; nothing to restore).

**Next release** (uploads with the multi-grade plan, waiting on A and C) is to be cut from `tala-v1-filipino`, which
now includes this release, and takes the next tag number.

**Uploads candidate recut on the release line (14:19 UTC).** Because `tala-v1-filipino` now carries `/forms`, the
local candidate `tala-v1-uploads` is recut there: `d59d42488` = `cae74f109` merged with `f27868a55`; checked the way
the host builds: types clean; core 303, server 356 + 1 opt-in skip, web 94; build clean with both `/forms` and
`/lessons/combine`. The window script checks the build set against it before tagging. Still waiting on A and C.

**Independent check by the forms owner** (`b11-002:2b7a1b9c`, bridge reply `bf223d25…`, signed out from b11-002 at
14:18 UTC): release identity confirmed with an anonymous `ls-remote` and a fetch into `FETCH_HEAD` only (tag object
`31d920f1…` → commit `40b6f201`, a merge of `4a2895b5e` and `f425585bc`; the forms paths identical to `f425585bc`);
`/forms` 200 with 32 cards, 32 of 32 thumbnails and 57 of 57 previews, the notice, 0 console errors, 0 cookies, one
`/api` request (`GET /api/v1/config`) and the Cloudflare beacon; 123 of 123 files byte-identical with the right
content types; the ZIP exactly the 32 PDFs; all 32 PDFs pass its field-count and fill-save-reopen checks; all 89
previews decode; all 18 existing pages identical to its snapshot of 10:15 UTC; private pages go to `/sign-in`; the
17 private GET routes answer 401. It reports to Luis itself.

## 25 Nov 2026 ~22:45 UTC (26 Nov ~06:45 Manila): Luis answers A — the application check is WAIVED (not passed)

**Luis, relayed by the coordinator in thread `ddb4d22d`, verbatim:** "You can ship without it". The coordinator's note:
this answers A; Luis authorizes skipping the Word/PowerPoint sample check; record A as resolved with the check
explicitly waived rather than passed; C (the upload privacy wording) is not answered by this message.

- **A — resolved: WAIVED.** No person opened the sample `.docx` or `.pptx` files in Microsoft Word, PowerPoint,
  Google Docs/Slides or WPS. What was checked instead stays exactly what it was: structure checks, the project's
  own readers, python-pptx and LibreOffice (rehearsals of 23–25 Nov). Nothing here should be read as "Word-checked"
  or "PowerPoint-checked".
- **What it unblocks.** The multi-grade plan (its only gate was A) is released next, on its own, on top of the live
  release (`tala-v1-demo.14` with `/forms`). Teacher uploads also no longer wait on A.
- **waiting_for_user, still open:** **C** — the privacy line on the upload screen, drafted from Luis's rule (EN:
  "Files you upload are kept in Tala's private storage. Other teachers can't see them. They stay until you delete them
  or your account."; FIL from the Filipino owner). Owner: Luis. Blocks: the uploads release only. D and E stay
  optional (defaults: class lists read and discarded; no download stored).

## Multi-grade plan on production: 2026-11-25 22:51–22:53 UTC (26 Nov 06:51–06:53 PHT) — `tala-v1-demo.15`

**Authority.** Luis's 23 Nov request (the agreed Tala improvements) and his 26 Nov waiver of the Word application
check (A), the feature's only remaining gate.

**Release.** Tag `tala-v1-demo.15` (tag object `616e11cc19643906b4b6fbd956f31946fe582321`) on commit
`7673204c2e7e2c764e8260fcfaaf23e0de152c4b` = notes `230762496` merged with the owner's commit
`de6bd222ead05526f6aec325efee092cc5f4937a` (tree `b6125b4d…`, the rehearsed tree), unchanged. Its build set equals
the candidate checked the way the host builds (`875c6fc4f`: types clean; core 270, server 288 + 1 opt-in skip, web
87; build clean with `/forms` and `/lessons/combine`); against `demo.14`, 31 files differ, all in `tala-core` and
`tala-web`. `tala-v1-filipino` now fast-forwards to it, so later releases keep it (and `/forms`).

**Window** (lock held 22:51:12–22:53:28 UTC; nothing else in flight): backup `/var/backups/tala/20261125T225143Z`
(database integrity ok, 26 tables, settings copy equal, previous release `demo.14`; checksums verified);
`deploy.sh tala-v1-demo.15` 22:51:46–22:52:11, live since **22:52:10 UTC**; no migration, setting or data change.

**Verified live:**
- health `0.1.0+tala-v1-demo.15`; host release commit `7673204c2…`; 0 restarts; 0 error lines; 0 server errors.
- `/forms` kept: 32 cards, all 123 files byte-identical to the manifest, the ZIP the 32 PDFs; `/lessons/combine` 200;
  the 17 private GET routes 401 signed out; no table's row count changed; both libraries unchanged.
- **Signed in, with the release owner's test account** (the owner's walk, production variant: it signs in to the
  existing account, leaves its profile and active year alone, and adds two rooms marked "synthetic test" with real
  pack lessons; the browser part is the owner's own): **20/20** — the way to Combine on Lessons; each grade's lesson
  offered and chosen; the period shared (5 min together, 18 + 17 with the teacher, 5 together); "All grades
  together"; one combined draft in the editor (shared start, one turn per grade, shared finish); her note kept after
  a reload, on the server and on a second browser; the source lessons unchanged; the print sheet offers A4 and long
  bond with the table layout chosen; Download as Word made on the device; the table print on A4 and long bond;
  three grades with one left empty; phone; Filipino; no browser errors.
- **The files it produced, by the owner's checker** (python-docx, pypdf; a parser check — the Word application
  check was WAIVED, not done): **19/19** — the `.docx` opens, a column per grade, one row per time block in order,
  the heading row repeats, her note, the source lessons, A4 portrait, the draft and AI-draft labels, curriculum
  references; PDFs on A4 (595 × 842 pt, 9 pages) and long bond (612 × 936 pt, 8 pages; three grades landscape
  936 × 612, 11 pages), each with the session table, the note and signature lines.

**Rollback**: `sudo -n ssh b11-apps /opt/tala/deploy.sh tala-v1-demo.14` (code only; combined plans are ordinary plan
records and stay readable). Evidence on b11-dev: `/home/b11/tala-takeover-20261125/release-mg/`.

**Still open**: C (the upload privacy wording) — the uploads release waits only on it.

**After demo.15 (22:55 UTC).** The uploads candidate is recut on the release line that now carries `/forms` and the
multi-grade plan: `tala-v1-uploads` = `086463ce5` (`a6fecee2d` merged with `f27868a55`), checked the way the host
builds: types clean; core 303, server 356 + 1 opt-in skip, web 94; build clean with `/forms` and `/lessons/combine`.
The window script (`/home/b11/tala-takeover-20261125/release-uploads/window-uploads.sh`) checks its build set against
it before tagging. The uploads/multi-grade owner (`b11-002:f500f47c`, at its usage limit until 1 Dec) was sent a
record of both releases and of the R2 commits to review (bridge `e9cf9e9b…`).

**waiting_for_user — the ONE remaining blocker**: **C**, the privacy line on the upload screen (owner: Luis; blocks:
the uploads release only). Draft EN: "Files you upload are kept in Tala's private storage. Other teachers can't see
them. They stay until you delete them or your account." FIL (the Filipino owner): "Nakatabi sa pribadong storage ng
Tala ang mga file na in-upload mo. Hindi makikita ng ibang guro ang mga ito. Mananatili roon ang mga file hanggang
burahin mo ang mga ito o ang account mo." When answered: the window's stages (apt and the sandbox installer, the
key, the settings, deploy, verify, the key-renewal timer on b11-dev) in about 45 minutes.

## 25 Nov 2026 23:45 UTC: Luis approves the upload privacy wording (C resolved); the uploads release is authorized

**Luis, relayed by the coordinator in thread `ddb4d22d`, verbatim:** "C looks good to go". The coordinator's note:
Luis approves the upload-screen privacy wording and authorizes the prepared teacher-uploads release; A remains
waived, not passed; reconcile candidate `086463ce5` with the current release and deploy through the established
backup, release and rollback process; preserve the public forms page, the multi-grade features and private
authentication; no unrelated curriculum work; no further business approval is needed for this scope.

- **C — resolved: approved.** The words on the upload screen (`up.private`) as drafted: EN "Files you upload are
  kept in Tala's private storage. Other teachers can't see them. They stay until you delete them or your account.";
  FIL (the Filipino owner) "Nakatabi sa pribadong storage ng Tala ang mga file na in-upload mo. Hindi makikita ng ibang
  guro ang mga ito. Mananatili roon ang mga file hanggang burahin mo ang mga ito o ang account mo."
- **waiting_for_user: none for this release.** A stays waived (not passed). D and E stay optional (defaults: class
  lists read and discarded; no download stored).

## Teacher uploads on production: 2026-11-25 23:45 – 26 Nov 00:03 UTC (26 Nov 07:45–08:03 PHT) — `tala-v1-demo.16`

**Authority.** Luis's "C looks good to go" (above): the privacy wording approved and the uploads release authorized.

**Release.** Tag `tala-v1-demo.16` (tag object `53502cf3563210b568123ff07a8c2937fa06aa94`) on commit
`5979b40ec4bd0c50ecc4879dcd5cd79ba8ff2b62` (tree `cf062251…`) = notes `257538f04` merged with the R2 commits
(`e6e23c167`, `f27868a55`) on the owner's uploads line. Its build set equals the candidate checked the way the host
builds (`086463ce5`: types clean; core 303, server 356 + 1 opt-in skip, web 94; build clean with `/forms` and
`/lessons/combine`). `tala-v1-filipino` now fast-forwards to it, so later releases keep uploads, multi-grade and `/forms`.

**Window** (lock held 23:45:46–00:03:08 UTC; nothing else in flight):
- backup `/var/backups/tala/20261125T234620Z` (database integrity ok, settings copy, previous release `demo.15`, rows,
  library hashes; checksums verified).
- the drawing service: `apt-get` with a simulation gate (53 new packages, 0 upgrades, 0 removals; needrestart
  suspended), `install.sh` **18/18**. `verify.mjs` without the box section **61/63**: both failures are in "turns" and
  come from one drawing instance (`tala-render@101-…`) that stayed 63 s after answering "ok" and held the single slot,
  so six simultaneous files were all turned away (and the scratch check had nothing to compare). Watched reruns:
  draw 8/8, turns 5/5, no instance stayed. Cause not found. Effect is availability only (the editor says "busy" and
  tries again; `RuntimeMaxSec=120` ends any instance) — **open item**.
- key: a 24 h key for `tala/production/` only, `/etc/tala-r2/r2-credentials.json` (folder root:tala 0750, file
  root:tala 0640), read back equal, readable by `tala`. Settings: the five `TALA_R2_*` names (endpoint over stdin),
  15 MiB per file, 50 MiB per account, the drawing socket; an unsigned request to the store is refused (HTTP 400).
- `deploy.sh tala-v1-demo.16` 23:56:14–23:56:39, live since **23:56:39 UTC**.

**Verified live:**
- health `0.1.0+tala-v1-demo.16`; seven public pages 200; the **22** private GET routes 401 signed out; `/forms` kept
  (123 files byte-identical to the manifest, the ZIP the 32 PDFs); migrations `decks:002`–`005` applied; the storage
  line says object storage, `hiraia-archive`, `tala/production/`; 0 error lines, 0 server errors, 130 MB; 33 tables
  (26 before): only `kernel_migrations` changed (13 → 17), the seven new uploads tables empty; both libraries
  unchanged. `r2-check` on production with the service's own client and key: **12/12** (no overwrite, a wrong
  checksum refused, a name outside the prefix refused for writing and reading, removal checked).
- **Signed in, with the release owner's test account** (the feature's own walk, production copy: credentials from
  the environment, no second account): **EN 37/37** — the approved privacy line word for word; a macro file refused
  before sending, the same file renamed refused by the server, a non-PowerPoint refused, nothing of them kept; upload
  to the editor in 1.4 s; real slide pictures from the sandboxed service in 2.2 s; the edit summary and what is only
  carried along; autosave, the picture following the words, a table cell, move, copy, remove, undo, redo; everything
  kept after a reload; the server holds her differences; the edited `.pptx`; **the uploaded file byte for byte**
  (read back from R2); a second file opened and **deleted from the editor's menu** (404); phone; no console errors;
  no unexpected failed request. **FIL 35/35** (the Filipino line and refusal messages word for word; byte for byte).
- **On the host, through the server's client**: the kept file's object equals its record (63,274 bytes, SHA-256),
  under `tala/production/teachers/<account>/uploads/<upload>/original` as designed, its intent "stored", no file bytes
  in the database; the object of the file deleted in the editor is **gone (404)**; an anonymous request for the kept
  object's address is refused (HTTP 400). After deleting the kept file through the API: 404 on it and its original,
  her list empty, **all three objects gone (404)**, 0 rows in the uploads, intents, pictures and sessions tables.
- **Access, with one account**: signed out, all seven routes of a real file (read, original, edited file, picture,
  list, change, delete) 401 and the file untouched; signed in, an id that is not hers 404; a made-up session 401; the
  key reaches only its prefix. **Not proven on production**: another teacher's attempts (rehearsal walks EN/FIL 38/38
  include them: list, read, download, picture, change and delete all 404) and removal on account deletion (tests and
  rehearsal) — both need a second, disposable production account, which no one has authorized.
- **Key renewal**: `tala-r2-renew.timer` (user `b11` on b11-dev, every 6 h at :17, persistent) enabled and run once at
  00:02:02 → keys until 2026-11-27 00:02 UTC; the running server read the new file without a restart
  (`deck_upload_storage_keys_read`), and a walk after it passed **31/31**.

**Rollback**: `sudo -n ssh b11-apps /opt/tala/deploy.sh tala-v1-demo.15` (code only; it ignores the R2 settings and
leaves the uploads tables alone; objects and records stay and are found again when going forward). Never an earlier
uploads candidate (`c6938a492`, `d1eb90438`). Evidence on b11-dev: `/home/b11/tala-takeover-20261125/release-uploads/`.

**Open after demo.16**: the lingering drawing instance (above); the two production-only proofs that need a second
account; A stays waived (no Word/PowerPoint application check was done); D and E stay at their defaults; the
uploads owner (`b11-002:f500f47c`, back 1 Dec) to review the R2 commits. Next in line: Luis's English curriculum
release (26 Nov 07:44 Manila), serialized after this window through the same lock, backup and rollback.

## 26 Nov 2026 07:44 Manila: Luis asks for the English curriculum on production

**Luis, relayed by the coordinator in thread `ddb4d22d` (request `rq_yjubeeyt`), verbatim:** "We were supposed to push
the English curriculum work to production as well, I think let's do that now". The coordinator's approval: release the
EXISTING English curriculum work (it supersedes the earlier Math-only/English-deferred limit) after the uploads window,
through the same lock, backup and rollback; separate curriculum inventories from complete packs; no regeneration, no
paid or model batch, no copying of the multi-grade example, no third-party readings; bounded integration so that it is
usable in the teacher views; verify signed in with the test account.

**What existed (inventory, 26 Nov).** The only English work is the curriculum harvest held on local branch `tala-v1`
(`53ae53b1d`, 14 Nov): DepEd 2026 Three-Term Budgets of Work as Tala curriculum packs, format 2. The uploads owner's
"Math-English curriculum" lane wrote no English plan (its own record: "not written"). No English teaching packs (plans,
slides, readings, worksheets, assessments) exist anywhere. Released scope, as held, byte for byte:

| Pack | Grade | Competencies (T1/T2/T3) | Source (edition, pages, SHA-256 of the archived DepEd PDF) |
|---|---|---|---|
| `reading-and-literacy-bow-2026` | 1 | 83 (30/26/27) | READING AND LITERACY — Grade 1 (2026-04-23, 13 pp, `b3d8b8c4…`) |
| `english-bow-2026` | 2 | 174 (47/61/66) | ENGLISH — Grade 2 (2026-04-23, 23 pp, `56e4447d…`) |
| | 3 | 193 (68/64/61) | ENGLISH — Grade 3 (26 pp, `32d90fd1…`) |
| | 4 | 176 (52/63/61) | ENGLISH — Grade 4 (26 pp, `ce2c3d99…`) |
| | 5 | 186 (66/62/58) | ENGLISH — Grade 5 (26 pp, `f9ce7843…`) |
| | 6 | 164 (56/54/54) | ENGLISH — Grade 6 (26 pp, `a066a6f4…`) |
| | 7 | 82 (22/33/27) | ENGLISH — Grade 7 (15 pp, `420cc3f9…`) |
| | 8 | 86 (27/27/32) | ENGLISH — Grade 8 (15 pp, `19d0a0ee…`) |
| | 9 | 81 (30/34/17) | ENGLISH — Grade 9 (15 pp, `9755113d…`) |
| | 10 | 76 (31/28/17) | ENGLISH — Grade 10 (15 pp, `75a2a201…`) |

Every entry: the competency text as printed, content standard (performance standard where printed: all but 61 of
Grade 2's), domain, term (1–3; **term placement only**: the source gives no weeks, so weeks are the teacher's or the
pacing's call), page and URL, the source file's SHA-256, a derived short title (Hiraia's label, open to correction; the
official text stays the only wording). **No DepEd codes**: the 2026 budgets print none, and no older quarter code (such
as the example's `EN3…`/`RL1…-II-…`) is attached. **Not released**: Grade 1 Language (141; a separate learning area, not
English), Senior High Effective Communication (G11, 44), and the rest of the held harvest (Filipino, Mathematics,
Makabansa, GMRC, AP, MAPEH, EPP/TLE, Kindergarten, senior high): still held.

**Source fidelity (checked 26 Nov).** All ten source PDFs on `tala-v1` have exactly the SHA-256 the packs record. A fixed
sample of 120 entries (12 per pack): 114 word for word on the named page; 3 bullet lists that run onto the next page
(G7 T3 #5, G8 T2 #6, G9 T2 #15; the pack names the first page); 3 rows decoded from the printed verb-tense / pronoun
matrix that continues onto the next page (G4 T3 #36 and #42, G5 T3 #31: every heading is printed, e.g. "using tenses of
verbs → simple → future", but the pack names page 10 where the group starts, the row is on page 11). Nothing found
that is not in the source. Evidence: `/home/b11/tala-takeover-20261125/release-english/fidelity/`.

## English curriculum on production: 2026-11-26 00:37–00:41 UTC (08:37–08:41 PHT) — `tala-v1-demo.17`

**Release.** Tag `tala-v1-demo.17` (tag object `515ec935744f504a7481bfa79bb0d5422a781f89`) on commit
`7d4b798f1c4df7ae793ebd84c960e4c76f3ef35a`, branch `tala-v1-english` = the notes tip `486533196` (demo.16 + ledger) and:
- `2418af122` the ten packs (byte for byte from `tala-v1`), the held branch's additive pack-format-2 contract fields (so
  edition, page, SHA-256 and the source documents reach the app), learning areas named from a map (the loader called
  anything that was not Science "Mathematics (sample data)"), the format ADR, server tests adapted to this data set.
- `17d27d0d7` **a fix the English data needed**: the web app took ONE curriculum version per school year (the first
  pack listed). English sorts before Science, so Science weeks, lesson competencies and setup starts would have looked
  in the English version and found nothing (shown by a control run of the data-only commit: Setup found 0 of 11 Science
  G4 and 0 of 26 Reading and Literacy starts). The version is now chosen per grade and learning area, like the server's
  `versionFor`. The lesson editor also loads the packs of the competencies a plan carries, so a multi-grade session made
  from each grade's own lesson (Grade 1 Reading and Literacy beside Grade 2–3 English, as in the DepEd example) shows,
  prints and exports competencies instead of ids. The competency picker gains a closed "Standards and source" line per
  competency: content and performance standards and the source document, edition and page, linked to DepEd's file.
- `3e0cc0e04`, `7d4b798f1` the picker's five labels on the Filipino screen: the Filipino owner's wording (bridge
  `bae96467`, answering `78c75875`): "Mga standard at sanggunian", "Content standard", "Performance standard",
  "Sanggunian", "pahina {n}". Review by a Filipino-speaking teacher is still open.

Checked the way the host builds (`7d4b798f1`): lockfile unchanged; types clean; core 303, server 357 + 1 opt-in skip, web
97 (3 new: per-area versions with English listed first, mixed-area plans); build clean. Local rehearsal of the walk
below on the same build: 34/34. Against demo.16, 22 files differ in the build set (core contract, server data and
curriculum module, web curriculum helpers, setup, new lesson, editor, picker, strings); no migration, setting, host
package or library change.

**Window** (lock held 00:37:56–00:41:12 UTC; nothing else in flight): backup `/var/backups/tala/20261126T003824Z`
(integrity ok, 33 tables, settings copy equal, previous release `demo.16`; checksums verified); `deploy.sh
tala-v1-demo.17` 00:38:26–00:38:52, live since **00:38:52 UTC**.

**Verified live:**
- health `0.1.0+tala-v1-demo.17`; ten public pages 200; the 22 private GET routes 401 signed out; `/forms` kept (123
  files byte-identical, the ZIP the 32 PDFs); 0 migrations, 0 error lines, 0 server errors, 125 MB; 33 tables, none
  changed; both teaching libraries unchanged; the uploads store's `r2-check` passed (and the key timer renewed on its
  own at 00:18:57). The public curriculum route serves English G2–10 (9 packs, 1,218), Reading and Literacy G1 (83),
  Science G3–10 unchanged (8 packs, 322); the English G2 pack arrives with standards, edition, page and SHA-256.
- **Signed in, with the release owner's test account** (`english-walk.mjs`; it adds two rooms marked "synthetic
  test": Grade 4 Luna with English and Science, Grades 1–3 Bonifacio with English for Grades 2–3 and Reading and
  Literacy for Grade 1, pacing tracks, and each grade's own lesson of the day): **35/35** — Setup offers English and
  Reading and Literacy for Grades 1–2 (Science only once Grade 4 is added) and proposes starts from each pack (English
  G2 61/61, Reading and Literacy G1 26/26, Science G4 11/11, English G4 63/63; "no pack" said plainly for English G1
  and Reading and Literacy G2; nothing saved); This Week shows the English topics and, beside them, the Science
  topics; a new English lesson starts with the day's competency; the picker lists this term's 63 Grade 4 competencies,
  narrows by a word (20 of 63 for "sentences"), shows all 176 with "All"; the standards and the source of a competency
  word for word and linked; her added competency kept after a reload and on the server; the A4 print lists the
  competencies; Word made on the device; "All grades together" takes Grade 1 Reading and Literacy and Grades 2–3
  English into one plan with a turn per grade and all six competencies by their wording (never ids), printed on long
  bond as a table with each source, and as Word; a Science lesson still shows its competencies; the Library keeps its
  Science and six Mathematics weeks and offers no English packs; Community filters by English and by Reading and
  Literacy; the Filipino screen; a phone; no browser or server errors.
- **The files it produced, by a parser** (python-docx, pypdf; no Word application was used): **8/8** — the Grade 4
  `.docx` and A4 PDF (595 × 842 pt) carry both competencies; the Grades 1–3 `.docx` carries the six competencies, a
  column per grade and each source document and edition, no ids; the long-bond PDF (936 × 612 pt, 3 pages) carries all
  six.
- **Private data**: since the backup only the test account's records changed (2 classes, 4 subjects, 15 pacing tracks,
  6 lessons, 51 sections); every other account's records are identical to the backup (owner, kind, id, revision,
  sequence, times), their sessions unchanged.

**Rollback**: `sudo -n ssh b11-apps /opt/tala/deploy.sh tala-v1-demo.16` (code and in-repo curriculum data only; lessons
already tagged with English competencies keep their ids and would show them as ids until forward again). Evidence on
b11-dev: `/home/b11/tala-takeover-20261125/release-english/` (window script, verify log, walk JSON, screenshots,
downloaded files, fidelity log, rehearsal and control runs).

**What a teacher gets, and what is still missing.** English is **curriculum only**: competencies, standards, terms and
sources in Setup, This Week, new lessons, the picker, multi-grade plans, print and Word. There are **no English teaching
packs** (no ready plans, slides, readings, worksheets or assessments) and none are claimed; making them is new content
work that needs its own decision (readings need rights cleared; nothing from the uploaded example is used). Open: a
Filipino-speaking teacher's review of the five labels; Grade 1 Language and Senior High Effective Communication (held,
say if wanted); single-grade prints show competency wording without the source line (the table print has it; as for
Science); the existing "Needs attention" line says competencies "may not fit this quarter" although the calendar is in
terms (wording older than this release, left alone); the matrix rows above name the page where their group starts.

## 26 Nov 2026 10:13 Manila: Luis approves English teaching packs, on his verbal clearance

**Luis, relayed by the coordinator in thread `ddb4d22d` (request `rq_shaxgina`), verbatim:** "Yes and we already have
verbal clearance to build English language packs". It answers question 1 of the demo.17 report ("Should we make
English teaching packs? That is new content work, and readings would need rights cleared.").

- **Decision: English teaching-pack creation is APPROVED.** It supersedes, for this work, the earlier English
  curriculum-only / no-new-content limit. Not to be asked again; no blanket written-clearance gate.
- **Clearance, as recorded:** user-provided **verbal** clearance (Luis's statement, accepted in good faith), not an
  independently inspected written licence. Kept: each source's own restrictions and credits; the uploaded 33-page
  multi-grade example is for evaluation and is not republished; no unrelated commercial passage is assumed covered.
  Materials are original, covered by the clearance, or from other permitted (openly licensed) sources, credited. A
  specific source that turns out not to be covered gets one precise question; it does not stop other authoring.
- **First acceptance artifact:** a complete Grade 1 Reading and Literacy + Grades 2–3 English multi-grade pack (Luis's
  example's shape), without narrowing the English program to those grades. Term-level curriculum: any week sequence is
  Tala's proposal, labelled as such; no DepEd week mapping or old quarter code is invented.
- **Placement:** coordination, release and production stay with the release owner on b11-dev; long-running unattended
  pack production goes to b11-002 through the bridge. No overnight batch on b11-dev, no unbounded paid batch, no
  default to the old DeepSeek route. Drafts are labelled AI drafts, not teacher-approved, and are not called deployed
  until released through the lock, backup and rollback pipeline.
- **Still waiting_for_user (unchanged):** (2) release Grade 1 Language (141) and Senior High Effective Communication (44)?
  (3) may the release owner create one disposable production account to prove cross-teacher isolation and account-
  deletion removal of uploads on production?

## 26 Nov 2026: English teaching packs — first set built and checked (not released in the app)

**Set `eng26-mg123-t2-s01`**: one multi-grade week, Grade 1 Reading and Literacy + Grades 2–3 English, the shape of
Luis's example (nothing taken from it). Original story *Seven Ducks in the Rain*; five 60-minute combined periods
(Tala's proposal) in a fixed rotation — whole class, then each grade with the teacher in turn while the others work
alone or as buddies, then whole class. Grade 1 works in its first language (Filipino as the worked L1, letters n and g),
as its competencies require. Competencies (Term 2, Tala set 1 — a proposed sequence, no DepEd weeks or codes claimed):
Grade 1 R&L t2.1, t2.3, t2.15, t2.16; Grade 2 English t2.1, t2.2, t2.4, t2.38, t2.39; Grade 3 English t2.2, t2.3,
t2.40, t2.41 — all taught and assessed.

**Artifacts** (workspace `/home/b11/tala-english-packs/`, delivery `delivery/tala-english-eng26-mg123-t2-s01-20261126`,
archive SHA-256 in `delivery/published-20261126.json`): five combined plans (Tala's multi-grade template, exported
with the app's own print and Word code: DOCX, A4, long bond), four editable decks with notes (100 slides), three
grades' lesson plans, teacher guide with a merged print list, readings and cards booklet, 49 worksheets in tiers,
answer keys, Day 5 checks with oral record sheets. Published for 7 days through the report relay
(`https://lnj.b11.dev/reports/<token>`, expires about 2026-12-03 05:00 UTC); 23/23 links verified (HTTP 200, same SHA-256).

**Checks**: deterministic checker 0 errors (ids, time blocks, minutes, coverage, keys, decodability: Grade 2 reader all
CVC or 8 sight words; Grade 3 passage all 17 targets; Grade 1 reader only the allowed letters); independent Opus review
in two rounds (r1: 5 must, 20 should, 16 nice, all acted on; r2: 19 fixed, 6 partly, 0 open, plus 2 must and 3 should,
fixed); 33/33 file parser checks; LibreOffice opened all 4 decks and 5 Word files; Tala's editability audit passes on
all decks; coordinator's visual inspection of contact sheets. **Not done**: teacher review, Microsoft Office check,
classroom trial; the 285 Filipino lines wait for the Filipino owner's editorial pass (bridge `15afb687…`); six Grade 1
words are teacher sketches (no Hiraia drawing).

**Release state**: not in the Tala app (files only). Production unchanged (`tala-v1-demo.17`). Workers: four authors
and one reviewer, Claude Opus 5.5 subagents on b11-dev, attended, bounded; nothing was run unattended or overnight,
and no paid model batch. **Next (not started)**: the unattended production lane on b11-002 (registered `hiraia`
project; the Math pilot renderer is there; English branches not yet fetched there; no English owner) for the next
bounded sets with this brief, checker and two-round review. **Still waiting_for_user (unchanged)**: Grade 1 Language
and Senior High Effective Communication; the disposable second account.

### 26 Nov 2026: English set eng26-mg123-t2-s01 revision 2 — Filipino owner's editorial pass applied

The Filipino owner (b11-002:7964278f) returned its pass (bridge `49c6c004…`): 33 corrections, applied verbatim (92
places), and 8 lines flagged for the set's owner, resolved by the coordinator with the owner's own or unchanged wording
(Day 3 buddy gesture follows where /g/ is heard, both grades' sheets aligned; colour-sheet titles use the owner's
first-sound sentence; the nose test compares n and g only; cue boxes mark the sound's position; the ducks walk toward
the river; two teacher cues clarified in English; one deliberate false statement kept). Resolution sent back as a
record (bridge `english-packs-fil-flags`). Rebuilt as attempt 04: checker 0 errors, editability pass on 4 decks,
LibreOffice opened 4 decks and 5 Word files, 34/34 file checks. Republished (7 days, 23/23 links verified); the
revision-1 links remain until they expire and show the earlier Filipino. Still open: a Filipino-speaking teacher's
review, any teacher review, a Microsoft Office check; not in the app.

## 26 Nov 2026 14:46 Manila: Luis answers "1. Yes 2. Yes" (rq_bkgebqxp): both open questions approved

**Luis, relayed by the coordinator in thread `ddb4d22d` (request `rq_bkgebqxp`, 26 Nov 2026 14:46 Asia/Manila),
verbatim:** "1. Yes 2. Yes"

**Mapping** (the coordinator mapped it after reading the release owner's latest report; the release owner checked it
against that report and this ledger: they agree, no discrepancy):

| # | Question as returned in the latest report | Same question earlier in this ledger | Answer and what it allows |
|---|---|---|---|
| 1 | "Should Grade 1 Language and SHS Effective Communication be released?" | (2): Grade 1 Language (141) and Senior High Effective Communication (G11, 44) | **Yes.** Release the two held curriculum packs, unchanged from the harvest, through the lock, backup and rollback pipeline. Curriculum only: no teaching packs exist for them. Not a release of any other held area or of the English draft teaching packs. |
| 2 | "Can we have a spare second account on production to test that accounts can't see each other's files and that account deletion works?" | (3): one disposable production account for cross-teacher isolation and account-deletion removal of uploads | **Yes.** ONE disposable synthetic production account (never a real teacher's), used with the existing test account on synthetic files only (owner allowed; another teacher and signed-out refused; private R2), then deleted through the app to prove the explicit-deletion cleanup in the database, the API and R2. |

**waiting_for_user: both cleared.** No other question is mapped to this answer.

## Grade 1 Language + Senior High Effective Communication on production: 2026-11-26 07:08 UTC (15:08 PHT) — `tala-v1-demo.18`

**Authority.** Luis's "1. Yes" (rq_bkgebqxp, question 1 above). Release owner b11-dev:12af59a8.

**What.** Two curriculum packs of the held harvest, byte for byte (branch `tala-v1`, 53ae53b1d), and one test; no code
change (the server and web app already named and served both areas). Commit `515a54137f81` on `tala-v1-language-shs`
(parent: the notes tip e63140812), tag object `ce17c636…`. **Curriculum only: no teaching packs exist for these
subjects, and the Library offers none.**

| Pack | Competencies (T1/T2/T3) | Source (as archived) |
|---|---|---|
| `language-bow-2026-g1` (Grade 1, elementary) | 141 (46/46/49) | LANGUAGE — Grade 1, edition 2026-04-23, 14 pp, SHA-256 `24157544…` |
| `shs-effective-communication-bow-2026-g11` (Grade 11, senior high core; fixed over three terms) | 44 (20/14/10) | EFFECTIVE COMMUNICATION — Grade 11, edition 2026-04-17, 13 pp, SHA-256 `c0837f6b…` |

Every entry carries its content and performance standards, domain, term (no weeks: the sources give none), page, link
and the file's SHA-256; no codes. **Source fidelity, all 185 entries** (not a sample): both PDFs have exactly the
recorded SHA-256; 183 entries are printed word for word on the named page, 2 run across a page break (SHS T1 #6 pages
3–4, T3 #1 pages 9–10; the footer and running header fall between the halves). Page numbers are the PDF's own: the
printed footers start after the cover ("Page 2 of 12" is PDF page 3), as in the English packs.

**Before the window:** commit check as the host builds (frozen install, types 0 errors, tests core 303/303, server 358
pass + 1 skipped, web 97/97, production build); on a local production build: the new walk 33/33 and its files 9/9, the
English walk 34/34.

**Window** (lock held 07:07:40–07:11:16 UTC): push of the branch and tag; backup `/var/backups/tala/20261126T070806Z`
(integrity ok, 33 tables, checksums verified); `deploy.sh tala-v1-demo.18` 07:08:10–07:08:37, exit 0, "healthy on
tala-v1-demo.18", 0 restarts.

**Verified live:** health `0.1.0+tala-v1-demo.18`; 10 public pages 200; the 22 private GET routes 401 signed out;
`/forms` 123 files identical to the manifest; the curriculum served: English G2–10 (1,218), Reading and Literacy G1 (83),
Science G3–10 (322), Language G1 (141, 46/46/49), Effective Communication G11 (44, 20/14/10), each new entry with page,
link and file hash; 0 migrations, 0 error lines, 0 server errors, 128 MB; 33 tables, 0 rows changed; both teaching
libraries (Science, Mathematics) unchanged; 20 curriculum pack files, the two new ones byte-identical to the commit
(`284546c7…`, `1a11a8d2…`); R2 store check passed. **Signed in with the test account:** the new walk **34/34** —
Setup offers Language (Grade 1) and Effective Communication (Grade 11) and starts each from its pack (46 of 46, 14 of
14), says plainly where a grade has no pack; This Week shows their topics; a new Effective Communication lesson starts
with the day's competency; the picker lists the term's 14, filters, shows all 44, the standards word for word and the
source (document, edition, page, link); her choice survives a reload and is on the server; print A4 and long bond and
Word carry the competencies; a Grade 1 Language lesson prints and downloads as Word; the Library offers no Language or
Effective Communication packs and still has Science and Mathematics; Community filters by both; Filipino screen; phone;
no errors — and its files **9/9** by parser. The English walk again: **35/35**, files **4/4** (multi-grade, Science,
Library, Community).

**Not performed:** Word/PowerPoint application checks (parsers only); any teacher review. The walks added synthetic
rooms and lessons to the test account only ("… synthetic test").

**Observed, unchanged:** This Week's "Needs attention" line says "may not fit this quarter" although the calendar has
terms (existing wording). Test fix only: subject lines on This Week are capitals with a no-break space before the dot;
the English walk's week check was reading mixed-case "Science" elsewhere on the page and now reads the subject line.

**Rollback:** `sudo -n ssh b11-apps /opt/tala/deploy.sh tala-v1-demo.17` (code only; nothing to undo in data). Evidence:
`/home/b11/tala-takeover-20261125/release-language-shs/`.

## Cross-account isolation and account deletion on production: 2026-11-26 07:17:54–07:21:50 UTC — one disposable synthetic account, made and deleted

**Authority.** Luis's "2. Yes" (rq_bkgebqxp, question 2). Live release `tala-v1-demo.18`; the shared deploy lock was
held for the whole test.

**Inventory first.** Production had 4 accounts: two synthetic ones on a reserved test domain — Beanie's
`beanie-reg-20261120-1205@example.com` (20 Nov) and the release owner's test account
`fable-release-test-20261125@example.com` (Luis's answer 4 of 25 Nov) — and two others (not listed). No earlier
disposable second account existed. The test account before: 0 uploads, 1 slide copy (sci26-g5-t3-w07; left untouched).

**Accounts.** A = the release owner's test account (kept). B = ONE disposable account,
`tala-disposable-isolation-20261126@example.com`, "Disposable Isolation Check (synthetic)", registered through the
public route (auto-verified), id `ac4e703b…`. Its password was generated into an owner-only file on b11-dev, never
printed, and the file was destroyed after the deletion.

**Synthetic fixtures, for each account:** a PowerPoint upload (the invented "Parts of a Plant" test file), edited,
slide pictures drawn by the sandboxed renderer; an unfinished upload; a slide copy of the English Grade 3 Term 2 Week 10
Science pack, edited; a synthetic class and lesson plan with a revision.

**Isolation, executed on production** (the API routes the app uses; for each account's things, the other account and
a signed-out caller):
- upload: read, original file (from R2), edited file (export), slide picture, draw pictures, change (a valid body, even
  with `force`), delete → the other teacher **404**, signed out **401**;
- unfinished upload: send a piece, finish, cancel → 404 / 401;
- slide copy: read, PowerPoint export, drawing, change (valid body, `force`), reset, delete → 404 / 401;
- lesson plan: server PDF, a past revision → 404 / 401; the revisions list → signed out 401, and for the other teacher
  an empty list byte-identical to the answer for a plan that never existed (the list is scoped to the caller: nothing
  shown, nothing to tell apart);
- the other teacher's lists, account export and sync pull hold none of the owner's ids; signed out, the lists, export
  and pull are 401; a made-up session token 401;
- each owner still reads everything, unchanged (same rev and title; the original byte for byte from R2; the edited
  file; a picture; the copy's PowerPoint and drawing; the plan's PDF and revisions). Control: the same valid change
  body saves on the caller's own file, so the 404s are ownership, not shape.
- **Private R2** (on the host, with the server's own key, the two synthetic accounts' folders only): each upload is one
  object under its owner's folder, whole (size and SHA-256); each folder held exactly its own object; the object's
  address without a key is refused (HTTP 400 InvalidArgument, no bytes).

**Deletion, executed.** Before deleting, the signed-in account was confirmed as B by id and address (not A); a wrong
password was refused (403, nothing deleted); B deleted itself through the app (`POST /account/delete` with its
password) at 07:20:19 UTC; its session then answered 401 ("This account was deleted.") and sign-in 401. Read back:
- **Database:** no row in any table mentions B's id, B's address or any of its upload, session, copy, plan or class ids
  (before: 35 rows by account id in 8 tables, 7 slide pictures, its address once). Removed exactly: `core_users` 1,
  `core_records` 14, `core_sync_mutations` 15, `core_plan_revisions` 1, `decks_decks` 1, `decks_uploads` 1,
  `decks_upload_previews` 7, `decks_upload_sessions` 1, `decks_upload_objects` 1. Log: `account_deleted` (5 modules),
  `deck_upload_object_removed` at once; the object row was gone within 12 s.
- **R2:** B's object 404; B's folder 0 objects.
- **API:** B's upload, original and copy answer A 404; its former plan's revisions give the never-existed answer.
- **A intact:** A's rows unchanged in every table by the deletion; A signs in; its file byte for byte from R2, its copy,
  its plan; the rows of the other accounts unchanged in every table.
- **What deliberately remains:** `core_ended_tokens` +1 (a session token's hash, reason `account_deleted`, no account
  id: an old device is told the account was deleted), a hashed failed-sign-in counter from my own after-deletion
  sign-in check, hashed rate-limit counters. No plain id or address remains.
- **The policy as built:** in one transaction the deletion removes the account, its sessions, synced records,
  revisions and sync log, slide copies (and drawings no copy shows any more), uploads with their pictures and
  unfinished uploads, generation jobs, roster drafts, community posts and AI quota (past AI spend is kept as a monthly
  sum without the account); R2 objects are marked and removed by the background work at once, retried until gone.

**Clean-up of A's test fixtures:** its test upload, test copy and unfinished upload deleted through the app (404 after;
R2 object 404; A's folder 0 objects). A is back to 0 uploads and its one earlier copy. Left in A: the labelled
synthetic class and lesson of this test ("Grade 6 – Isolation (A, synthetic test)") and the walks' synthetic rooms.

**Before → after the whole test:** 4 → 4 accounts; 27 of 33 tables identical; the other accounts' rows unchanged in
every table (the six tables that differ hold A's labelled test lesson and hashed session/sign-in counters); server 0
error lines, 0 server errors, 0 warnings, 0 restarts; both teaching libraries unchanged.

**Checks:** 83 recorded by the test script, 74 passed. The 9 that failed are test-design errors, none a product defect,
each superseded by a corrected check that passed: 2 fixture runs picked a week with no English pack (no copy was made,
checked; redone 2/2); 4 change attempts sent bodies that failed validation (400 before any lookup; redone with valid
bodies 4/4, plus 2 controls); 3 revisions-list probes expected 404 (the list is caller-scoped; confirmed identical to
a never-existed plan, 3/3). Plus the host's R2 and database read-backs above.

**Not performed:** class-list import and AI generation jobs across accounts (pupil names; paid calls), community
posting, account merge, Google sign-in (off), password reset (no mail service), the R2 removal retry path (removal
succeeded at once), attempts through the browser UI (the API was used directly), Office application checks. The
rehearsal-machine results of 24–25 Nov are not counted as production evidence. Evidence (no secrets):
`/home/b11/tala-takeover-20261125/isolation-20261126/`.

## 27 Nov 2026 11:36 Manila: Luis's six Lesson Plan items (rq_cqeyj7c8; item 1 corrected 11:41, rq_tdngzpga) — implementation started

**Luis, verbatim:** "Couple of feedback that we wanna work on immediately: 1) Lesson Plan - Materials 2) Presentations
should be displayed prominently in the Lesson Plan view, so the teacher already knows that they need to edit it to
coincide with their lesson plan. There should be an AI regeneration button on the slides too. 3) Multigrade
presentations should be dynamically assembled in the Lesson Plan view. 4) Saturday and Sunday classes need to be
supported because some schools don't have a choice when they will hold their classes. So just make it selectable and
then just do a best-guess on what they would need to cover on that day. 5) I noticed some weird titlebar issues in the
Lesson Plan view. A long title will get a scrollbar, when it should just wrap normally as a normal text header. 6) in
the Lesson Plan view, the REWRITE WITH AI button should be on the top right of each section. The "required" pill
should be right beside the title of the section." **Item 1 clarified (11:41, verbatim):** "1) Lesson Plan - Materials
- there was something wrong with the "GENERATE WITH AI" button there but i didnt get an error message" — the task is
to reproduce and fix that silent failure (the earlier generic materials-list assumption is withdrawn).

**Authority:** implementation and testing now. Deploying this UI release is not covered by the curriculum approvals:
the candidate will be finished and verified first, then one waiting_for_user question is recorded.

**State at start:** production `tala-v1-demo.18`, healthy; base `tala-v1-filipino` 9abe019ca; no other agent running
on b11-dev; every Tala owner on b11-002 idle (only an unrelated Let's Read agent running).

**Lanes and edit scope (one integrator):**
- Release owner, worktree `tala-wt/plan`, branch `tala-v1-lesson-feedback`: items 1, 5, 6 (Lesson Plan editor,
  section AI sheet, lesson generation checks and prompts) and the integration of the other two lanes.
- Worker W (internal subagent), worktree `tala-wt/weekend`, branch `tala-v1-weekend-days`: item 4 (setup, class
  edit, This Week, pacing, plan/timeline/recommend helpers; minimal hunks in the generation input/schedule).
- Worker P (internal subagent), worktree `tala-wt/slides`, branch `tala-v1-plan-slides`: items 2 and 3 (slide copies
  module, slide prompts, multi-grade assembly in tala-core, slides UI, a new presentation panel the integrator mounts).

**Item 1, evidence before any fix (production, metadata only, no lesson text or account shown):** all 4 Materials
rewrites ever run on production (3 multi-grade, 1 single-grade, the latest 27 Nov 03:33 UTC) finished as `done`
with EMPTY results (0 items; 0 characters per grade), each in about a second, and every one came from a class with no
listed resources. Cause: every lesson prompt says "materials: ONLY exact names from profile materials/textbooks",
and the server check rejects any other name, so a class without listed resources can only get an empty list. That
empty list passes, is saved over the section as a success ("Part rewritten"), and nothing tells the teacher why.

**Ledger:** 1 running (root cause found) · 2 running (worker P) · 3 running (worker P) · 4 running (worker W) ·
5 running · 6 running.

### 27 Nov 2026 12:18 Manila (04:18 UTC): items 1, 5, 6 built and verified locally (branch `tala-v1-lesson-feedback`, not deployed)

- **Item 1 (Materials "Rewrite with AI" silent failure) — fixed, commits 94039e89c, e2534953d.** Server: a
  Materials rewrite for a class with no listed resources is refused before any job or model call (`invalid_input`,
  reason `no_class_resources`); a part that comes back empty fails as the new reason `empty_output`. Sheet: says
  what is missing and lets the teacher list the class's materials right there (saved to the class), one request at
  a time, every failure at the top with Try again, an empty answer never applied, cancel reported. A rewrite queued
  offline that fails is shown in its lesson (never dropped). An empty Materials section in a class without listed
  materials says why. Local walk with the REAL provider (DeepSeek, same models as production): prerequisite → rewrite
  in 2.7 s → items only from the class list → two fast clicks = one request → kept after reload and on the server →
  class materials saved; existing lesson rewritten with the previous version kept in History; provider down (broken
  keys): the message at the top of the phone sheet, Try again safe, materials unchanged, both jobs failed; offline
  queued + provider down: the notice in the lesson. Tests: core +1, server +2 (and the old test that expected an
  empty Materials answer to succeed now uses a class with resources), web +5.
- **Item 5 (title scrollbar) — fixed, 94039e89c.** The title field grows with its text (the three-line cap and its
  inner scrollbar are gone; a locked title is no longer clipped); the header gives the title the free width. Measured
  at phone, foldable, desktop and 200% zoom, English, Filipino and one unbroken 126-letter word: all text visible, no
  inner scrollbar, no sideways scroll, 28 px type.
- **Item 6 (section actions) — fixed, 94039e89c + 700bc1fe1.** Every pre-class section: Rewrite with AI at the top
  right (short "Rewrite"/"Isulat ulit" label below 840 px, full name for screen readers), Required right after the
  title (on a narrow phone it wraps directly under the title, never under the actions); post-class parts have no AI.
  Measured at the same widths and languages: no overlap, no sideways scroll, touch-sized; keyboard focus reaches the
  button, which names its section, and Enter opens that section's sheet.
- Regression: the English release walk on this branch 34/34. Filipino lines for these items: the Filipino owner's
  pass applied (bridge 85a08f60: 6 rewordings, 4 OK; one later line still a draft).
- Items 2, 3 (worker P) and 4 (worker W): running.

## 27 Nov 2026: separate task — interface motion and AI drafting feedback (owner: Fable agent b11-dev:b3a74512)

**Luis, verbatim:** "Assign a separate Fable 5.2 agent to add some interface flourishes across the app to make it
feel sophisticated and professional. No need to change any of the text content, just add some nice things like a
transition animation when moving blocks within the lesson plan timetable, or floating arrows the fade in to show where
you're supposed to go next (and fade out after a second or two). When using AI to draft a plan, there should be
working animation and some reassuring captions so the user doesnt feel like they're just staring at the page."

- **Owner:** Paseo agent `b11-dev:b3a74512-8775-42ec-95d0-8e28610a05e9` (Fable 5.2, created by the coordinator,
  "Tala — refined motion, next-step cues and AI drafting feedback"). The release owner stays the single integrator
  and release gate; this task is NOT part of the six Lesson Plan items and does not hold their release.
- **Scope (coordinator):** restrained timetable reorder motion, next-step arrows that fade after 1–2 s, real AI
  drafting loading/status/error feedback with truthful captions (no fake stages, percentages or delays), reduced
  motion, accessibility, performance; no existing text or lesson content changed; no new features competing with the
  Materials fix or the slide regeneration. Source and test authorization only; no deploy authority.
- **Coordination sent (27 Nov, `paseo send`, file `motion-coordination/to-fable-1.md`):** base = `e2534953d` (the
  integration branch with items 1/5/6); its own worktree/branch; file boundaries — its own: the timetable
  (`SectionEditors.tsx`, `FlowTimeline.tsx`, `blocks.ts`), the full-draft page (`features/generate/*` except
  `GenerationRunner.tsx`), new motion/cue/status components, additive animation tokens; the release owner's, worker
  W's and worker P's files listed; `components/ui.tsx` ask-first; RegenSheet's working state swapped by the
  integrator (or by it after rebase); next-step cues inside This Week/setup wait for worker W's merge; new captions in
  one i18n block for the Filipino owner's review. Hand-off: verified branch + commit range to the integrator.

### 27 Nov 2026 13:48 Manila: all six items built, merged and verified locally — candidate `d4ca418e3` (not deployed)

**Candidate:** branch `tala-v1-lesson-feedback` (local), commit `d4ca418e3` on `tala-v1-filipino` 9abe019ca (= demo.18):
the integrator's items 1/5/6, worker W's item 4 (merge 2c86566cf), worker P's items 2/3 (merge 2599f8ace), and the
integrator's follow-ups (e2f39aa78, c08a8bbf1, 1453a46d6, d4ca418e3 = the walk script only). Lockfile unchanged; one additive migration
(`decks:006_lesson_presentations`); two new AI features (`slides.generate`, `slides.rewrite`) on the existing daily
allowance and monthly budget.

**Ledger:** 1 done in candidate · 2 done in candidate · 3 done in candidate · 4 done in candidate · 5 done in candidate ·
6 done in candidate. Deployed: none (production `tala-v1-demo.18`).

- **Item 2/3 (worker P):** a lesson's slides in the Lesson Plan view (pack copy for the day, or AI slides for a lesson
  without a pack), the alignment cue, Present/Edit/Download, AI rewrite with explicit scope (one slide / all) as a
  suggestion applied only on the teacher's choice, every replaced version kept (Earlier versions, restorable), the
  stale cue when the lesson changed (never regenerated by itself); multi-grade sessions assembled live in block order
  from each grade's own lesson, with grade labels, notes and a stand-in slide for a grade without slides; PPTX from the
  same assembly. Owner-only routes (another account 404, signed out 401; tested), new tables owner-scoped (audited: the
  one id-only job lookup was unused and is removed).
- **Item 4 (worker W):** see the merge record above; follow-ups by the integrator: AI week plans keep the scheduled
  weekdays; a week plan is sized from its own grid (Saturday-only = one session); the offline fallback keeps the plan's
  days; undated days named by weekday; Library "Use this pack" places a pack's days on the class's own days.
- **Found and fixed on the way (not in the six, all silent failures):** a failed local save read "Saved"; a full AI draft
  over a lesson with any teacher-written part was thrown away (foreground "not accepted"; background polled forever).
  Both found by the motion task owner's probes. Now: "Not saved" + Try again; `applyDraft` keeps her parts and says so.
- **Filipino:** the Filipino owner reviewed every new Filipino line (bridges 85a08f60, 9a3817c7, 22c46aff); all its
  wording applied; its audience/behaviour flags led to four corrections (Start over keeps the previous version, so its
  confirmation no longer says "cannot be undone"; the stand-in slide no longer projects a teacher instruction; the
  session description says when changes show; the weekend hint says the suggestion can be changed).
- **Checks on `d4ca418e3`:** clean export as the host builds it: frozen install, 0 type errors, tests core 326 / server 376 + 1 skipped / web 132, production build; lockfile unchanged from the live release. Walks on a local production build (real
  DeepSeek where marked; broken keys for failure phases): Lesson Plan items 1/5/6 33/33 (real AI: the Materials prerequisite, the rewrite, two fast clicks = one request, reload, an existing lesson with History) · slides 46/46 over six phases (real AI: a slide rewrite, rewrite all, an English deck, a Grade 1 deck made from a session; two- and three-grade sessions; Filipino) · weekend classes 51/51 · English release regression 34/34 · Grade 1 Language/SHS regression 33/33 · broken provider keys: Materials 6/6, queued offline 5/5, slides 4/4 · device full (simulated) 5/5 — 217 checks, all passed; 14 real model calls, $0.067; no secret in any server log. Screenshots (28, 7 days): https://lnj.b11.dev/reports/18d09ae77abdf62e13dc69cd5ce7ae3d0c92e12ba3005e928d0084c2d09365ed.
- **Not done:** production checks (not deployed); Microsoft Office application checks of the new PowerPoint files;
  a teacher's review; the existing pacing quirk (early topics resurface late in long terms) left for Luis.

**waiting_for_user (asked once, thread ddb4d22d):** "Deploy the six Lesson Plan changes to tala.hiraia.org now? Candidate `tala-v1-lesson-feedback` @ `d4ca418e3` on top of the live demo.18; it becomes `tala-v1-demo.19`; one additive database change; rollback is demo.18; slides AI uses the existing daily AI allowance and $20 monthly budget." Prepared window (refuses to run without this approval recorded): `release-lesson-feedback/window-lesson.sh`. The separate motion task (Fable b3a74512) is not part of this release.

#### 27 Nov 2026 14:00 Manila: candidate updated to `0f7b8b38b` (one fix in `applyDraft`)

The motion task owner measured on its rebased branch that `applyDraft` treated Tala's own pre-filled template
(hand-written origin, never edited by the teacher) as her text: after a queued full draft the model's objectives and
materials were dropped and the lesson said "your own text was kept". Fixed as it suggested: only what she edited is
hers; pre-filled parts are replaced and never reported as kept (unit test; clean export check green: core 326, server
376 + 1 skipped, web 132, build). The browser walks of `d4ca418e3` stand for everything else (the change is confined to
`applyDraft`, used by background full drafts); the motion owner re-runs its queued-draft browser check on the fix.
The release question above stands, now for `0f7b8b38b`. Its nine status captions went to the Filipino owner (batch 3,
bridge 2db386b4).
- **Browser check of the `applyDraft` fix (motion owner, its branch rebased onto `0f7b8b38b`): 8/8** — a draft queued
  after the pre-filled template is written (one job, one model call; objectives and materials are the model's; no
  "your own text was kept"); "Queue it" after a failure asks again and writes the draft; a lesson with one objective
  she wrote keeps it, the rest drafted, the banner names Objectives. Model replaced by a labelled local stand-in;
  the real-provider runs are those above.

#### 27 Nov 2026: follow-ups logged (pre-existing, outside the six-item release; release owner's lane)

Seen by the motion task owner in its recordings, not caused by any current branch:
- The draft page's Competencies row shows raw competency ids for a few tenths of a second while the curriculum packs
  load (GenerateScreen falls back to the id; since 14 Nov, 1429cae0a). Fix: a "still loading" state from the packs
  hook so the row waits instead of showing ids.
- After a full page reload an English-language account sees the app shell in Filipino for an instant (the default
  language applies until the profile loads).
Both stay open; neither changes saved data. The motion owner was allowed one more real-provider full draft on its
final build (the earlier three are used, ~US$0.0016 each).

#### 27 Nov 2026 17:04 Manila: motion task hand-off received; combined candidate staged separately

- **Hand-off** from the motion task owner (Fable `b11-dev:b3a74512`): branch `tala-v1-motion`, range
  `0f7b8b38b..a1fd881ed` (20 commits, fast-forward on the six-item candidate; last app commit c6b5967d5), hand-off
  note `docs/tala/motion/README.md`. Its checks: unit core 326, server 376 + 1 skipped, web 169; motion walk 149/149
  on c6b5967d5 (reorder 41, reduced motion 15, cue 31, surfaces 12, AI waiting state with a stand-in model 35,
  recordings 15); the release owner's no-model walks green on its build; real provider 4 full drafts + 2 rewrites,
  US$0.0079 answered. Evidence page (unlisted, expires 4 Dec): in the hand-off message.
- **Review by the release owner:** shared-file hunks exactly as agreed (ui.tsx two data attributes; EditorScreen Lock
  cue and `settled` prop; WeekParts cue; nine i18n keys with the Filipino owner's wording; one additive CSS block);
  listeners, timers and animation frames cleaned up; prefers-reduced-motion honoured; no server or core file touched.
- **Combined branch** `tala-v1-lesson-feedback-motion` (worktree `tala-wt/combined`) = `a1fd881ed` +
  `f3e6f52a9` (release owner: the section rewrite sheet shows the real waiting state through `<AiStatus>`; the
  multi-grade walk waits for the blocks). Clean export check green (core 326, server 376 + 1 skipped, web 169, build).
  Full walk suite running on it.
- **Approvals stay separate:** the six-item candidate stays `0f7b8b38b` (question asked above); the motion work
  needs Luis's own go-ahead (asked once, with the verified combined candidate).
- Four pre-existing loading flashes seen in the motion recordings are logged above as follow-ups (two more added by the
  hand-off: This Week's empty state for a moment after a reload; "This lesson is not on this device" for a moment
  before sync).
- **Combined candidate verified (17:20 Manila): `f3e6f52a9`.** Local production build, one
  database, real DeepSeek then broken keys: Lesson Plan 33/33, slides 46/46 over six phases, weekend 51/51, English
  34/34, Language/SHS 33/33, multi-grade 19/19 (race fixed), motion walk 88/88 (reorder 41, reduced motion 15, next-step
  cue 31, seed 1; the reduced-motion phase's one draft went to the real provider here, not a stand-in), broken keys:
  Materials 6/6, queued offline 5/5, slides 4/4, device full 5/5 — 324 checks, all passed; 15 real model calls,
  US$0.069; no secret in either server log. Evidence: the motion owner's page (in its hand-off) and the section sheet's
  new waiting state https://lnj.b11.dev/reports/d6dca7a73aac9148c82266d2cc4db7f5492b4e04ea52bd0d211c6cd3303ae001
  (7 days). **waiting_for_user (asked once):** "Include the interface motion work in the release too? If yes, I deploy
  `f3e6f52a9` (the six items + motion) instead of `0f7b8b38b` (the six items alone)." Both still need Luis's go-ahead
  to deploy at all.

## 27 Nov 2026 17:28 Manila: Luis answers "Proceed" (rq_fpm7ghfr): the combined Lesson Plan + motion release is approved

Luis's complete answer: "Proceed". The coordinator mapped it (thread ddb4d22d) to an explicit, concrete deployment
approval for the **combined** candidate `f3e6f52a9` (the six Lesson Plan items + the motion task's work) as
`tala-v1-demo.19`. It answers both open questions above at once: deploy (yes) and include the motion work (yes).

- **Lesson Plan release approved** (27 Nov 2026 17:28 Manila, rq_fpm7ghfr): deploy branch
  `tala-v1-lesson-feedback-motion` at `f3e6f52a9` (plus a docs-only merge of this notes branch) as `tala-v1-demo.19` on
  top of `tala-v1-demo.18`, through the established window: the single-writer lock, a verified backup, `deploy.sh`
  (health-checked, rolls itself back) and only the service's own restart. Rollback stays `tala-v1-demo.18`. After the
  deploy: live identity and health, then signed-in production flows with the retained synthetic test account (no new
  account; the deleted disposable account is not recreated and the deletion test is not replayed), representative
  curriculum, upload, forms and multi-grade regressions, and the logs.
- **Not authorized by this answer:** the long-term pacing quirk, the held subjects, publishing the English draft packs.
- The six-item-only candidate `0f7b8b38b` is superseded (the combined branch contains it unchanged).
- **waiting_for_user: both cleared** (the deploy question and the motion inclusion question). No other question is
  mapped to this answer.
- **Reconciled before any write (09:30 UTC):** production `tala-v1-demo.18`, healthy, active since 26 Nov 07:08:36 UTC
  with 0 restarts; deploy lock free; no other agent running; the combined worktree clean at `f3e6f52a9`; the motion
  branch unchanged at `a1fd881ed` since its hand-off; notes tip `f242d6208`; no production write had started.

## Lesson Plan items + motion on production: 2026-11-27 10:06–10:27 UTC (18:06–18:27 PHT) — `tala-v1-demo.19`

**Authority.** Luis's "Proceed" (27 Nov 17:28 Manila, rq_fpm7ghfr), recorded above: the combined candidate `f3e6f52a9`.

**Release.** Branch `tala-v1-lesson-feedback-motion` at `7388fac20` = `f3e6f52a9` + a docs-only merge of the notes
(`f86e79b58`; the build set is byte-identical by tree hash: core, server, web, brand, lockfile). Tag `tala-v1-demo.19`
(tag object `f9865dc7…`, commit `7388fac20d5c…`), pushed with the branch. Clean export check of `7388fac20`: 0 type
errors, tests core 326 / server 376 + 1 skipped / web 169, production build. Lockfile unchanged from demo.18; 106 build-set
files differ. Window `release-lesson-feedback/window-lesson.sh` (refuses without the approval line); the hiraia deploy
lock held 10:05:52–10:27:53 UTC (free beforehand; two non-Tala agents running, neither holding it).
- **Backup** `/var/backups/tala/20261127T100625Z` (database with integrity check ok, settings, previous release
  demo.18, rows per table, library hashes; checksums verified). **Deploy** 10:06:32–10:07:02 UTC, `deploy.sh` exit 0,
  "healthy on tala-v1-demo.19"; only the service restarted; 0 restarts since. **Rollback:**
  `sudo -n ssh b11-apps /opt/tala/deploy.sh tala-v1-demo.18` (code only; demo.18 ignores the new tables and columns).
- **Live checks:** health `0.1.0+tala-v1-demo.19`; 10 public pages 200; the contract's 26 private GET routes (4 new:
  a lesson's presentation, its AI job, its PowerPoint, a deck's earlier versions) 401 signed out; `/forms` 123 files
  identical to the manifest; the curriculum served unchanged (English 1,218, Language 141, Reading and Literacy 83,
  Science 322, Effective Communication 44, every new entry with page, link and file hash); migration
  `decks:006_lesson_presentations` applied once (10:07:01.949Z): 4 new tables, three new columns on slide copies (the
  2 existing copies: origin `pack`); no rows changed in any existing table except `kernel_migrations`; both teaching
  libraries unchanged; the R2 store check passed.

**Signed in, the release owner's test account** — production copies of the candidate's own walks
(`release-lesson-feedback/walk/*-prod.mjs`, made by script from the release commit: same checks, but they sign in instead
of registering, add labelled synthetic rooms to the account's active year and read no database: requests are counted
in the browser and jobs read through the API). Rehearsed first on a local build of `7388fac20` with an account shaped
like the test account. Real AI where marked.
- **Item 1, Materials: 48 checks, all passed.** The empty-materials hint; the sheet names the missing class materials
  before sending and offers a field ("Save and rewrite" waits for it); two fast clicks made exactly one request; REAL
  rewrite listing only the class's materials; after a reload and on the server; the typed materials saved to the class;
  an existing lesson: "Tala chooses only from them" and the edited-part warning, REAL rewrite, the previous list kept
  as a revision on the server. Connection dropped in the browser (simulated; no request reached the server): "No signal
  right now. Your work is safe on this device…" at the top of the sheet, in view on a phone, with Try again; nothing
  written; Try again ran once (REAL) and persisted. Offline: queued and told, nothing sent; back online the background
  runner sent it once (REAL), applied, persisted, no failure notice. Device full (simulated): "Not saved" with Try
  again, never "Saved"; saved after Try again, survives a reload.
- **Items 5 and 6** (inside the 48): long titles wrap and grow with no inner scrollbar at phone, foldable, desktop and
  200% zoom (English, Filipino, one unbroken word); Rewrite with AI at the top right of every pre-class section and
  Required beside the title, no overlap, touch-sized, keyboard reachable.
- **Items 2 and 3, slides: 47 checks, all passed.** The slides panel at the top of the Lesson Plan view; a pack day's
  slides as her own copy with the "match your lesson plan" cue; a slide edited in the editor is saved; "Rewrite this
  slide with AI" (REAL) proposes and writes nothing until used, then only that slide changes; Earlier versions puts her
  words back and keeps the AI version too; Present; PowerPoint with her words and the credits; the lesson changed →
  the stale cue, slides untouched; "Rewrite all slides" (REAL) replaces only that day's slides. An English lesson with
  no pack: slides made with AI (REAL), kept only when she says so, labelled as AI drafts (PowerPoint too). Multi-grade:
  a two-grade session put together from each grade's own lesson in block order (Grade 5 without slides said plainly);
  a three-grade session (Grade 1 Reading and Literacy, Grades 2–3 English) with Grade 1's slides made from the session
  panel (REAL); a change to the session plan on another device shows in its PowerPoint; Filipino panel.
- **Item 4, Saturday and Sunday: first run 20/28, follow-up 34/34.** First run passed: Add a class offers all seven
  days with the weekend note, proposes starting points, the days are saved and reach another device, the school year
  is untouched, the week runs Monday to Sunday, Sunday's class shows its topic and label, "Later" moves to the next
  week. Its 8 failures were the walk's premises, not the product: this account is not weekday-only (two multi-grade
  rooms seeded on 25 Nov meet all seven days, which demo.19 now honours) and its first class has lessons without a start
  time (Up next stays on today all day, an existing rule), so its Saturday checks read the wrong card. Follow-up run
  (rehearsed under the same conditions), Saturday read from its own row: the class's Saturday lessons with topics and
  the weekend note; a Saturday plan saved on Saturday with that day's competencies; the class screen keeps Science
  Saturday+Sunday; adding Sunday to English persists with its old period ids; English shows on Sunday; the English week
  plan is laid out Monday, Wednesday, Saturday, Sunday; the Filipino note and day picker.
- **Motion: 85 of 87.** Moving Session Flow blocks and Procedure steps 41/41 (movement, identity, focus, persistence);
  reduced motion 15/15 (nothing travels; one REAL draft); the next-step arrow 29/31. **Live defect (cosmetic):** on This
  Week with a long list (29 lessons today on this account) the arrow is placed at the screen edge pointing to an
  off-screen "Write a plan", and there it overlapped a neighbouring "Write a plan" (desktop) and a line of text (Filipino
  phone); a later capture shows it in the left gutter over a card's border, and on the phone not shown. It lasts about
  1.8 s and never takes the click. The live AI waiting state: "sending", then "queued" once the server held the job,
  gone the moment the answer was in (a 1.2 s Materials rewrite), its stages from the server.
- **Regressions:** English 35/35; Grade 1 Language + Effective Communication 34/34 and their files 9/9 by parser;
  multi-grade lesson plans 20/20; uploads 35/35 (its upload deleted, the stored object removed).
- **AI:** the test account made 9 model calls, US$0.0117; its allowance after: 1 full and 10 section of 5/15.

**Teacher data:** every other account's rows are identical to the backup in every table (records, sync log,
revisions, slide copies, uploads, AI jobs and usage), except one other account's session last-seen and expiry (its own
use during the window) and hash-only counters (ended sign-ins, rate limits, the sequence); content-addressed slide
pictures: the 15 existing rows unchanged, 9 added for the test account's new decks. The test account's earlier copy
(sci26-g5-t3-w07) unchanged. No other account has a Saturday or Sunday slot or weekend teaching days (0 of 6 subjects,
0 years): the weekend rule changes nothing in their weeks. Accounts 5 → 5. Logs since the deploy: 0 errors, 0 server
errors, one known startup notice (auto-verify), no key-like string.

**Evidence** (7 days, each file verified byte for byte):
https://lnj.b11.dev/reports/73eb368e8289da4799dc2b1bcefaea8306c854f3a0cb3373e73022c31dad48b9 (35 screenshots).
Files: `/home/b11/tala-takeover-20261125/release-lesson-feedback/prod-walk-demo19/`.

**Ledger:** 1–6 deployed in `tala-v1-demo.19`; the motion task's work deployed with them.

**Open follow-ups:** (1) the next-step arrow's edge placement on long lists must apply the same "covers nothing" test
as its other places (motion task; not fixed in this release); (2) the loading flashes logged above (competency ids on the
draft page, Filipino shell after a reload, This Week empty state, "not on this device"); (3) Microsoft Office application
checks of the new PowerPoint files (parsers only); (4) a teacher's review; (5) the existing pacing quirk, for Luis;
(6) the test account now holds seven-day rooms and a class without start times: weekday-only checks need their own rooms.
**Not part of this approval and not done:** the held subjects, publishing the English draft packs, the pacing quirk.

## 27 Nov 2026 21:31 Manila: separate task — the public homepage (owner: Fable agent b11-dev:bea7a699)

Per the owner's scope declaration to the release owner (13:4x UTC, citing Luis's request rq_yrx5hmd6, assigned by
rq_uvwqkxp7, thread ddb4d22d): improve `/` below the hero (the hero stays as it is): three visual features in this order —
the multi-grade lesson planner, the slideshow generator, the breadth of DepEd Science curriculum coverage — in place of
the screenshot carousel and the seven feature cards; rewrite the Filipino of "Ang pangako namin". Branch
`tala-v1-homepage` (worktree `tala-wt/home`, local), base `f2a154a08`. The owner has no deploy authority; the release
owner integrates; deploying needs Luis's own go-ahead (demo.19's approval does not cover it). **Nothing deployed.**
- **Shared files agreed:** only `landing.*` i18n keys (`landing.footerDeped`, the non-affiliation line, unchanged); one
  additive block at the end of `globals.css` (after the motion block, reduced motion honoured); `PublicShell.tsx`
  untouched. Nothing else in flight on those files (checked 13:42 UTC: only the two agents running; the arrow and
  loading-flash follow-ups not started). New Filipino lines go to the Filipino owner through the release owner.
- **What the page may claim** (live public API, 13:4x UTC): Science curriculum mapped for Grades 3–10 from the DepEd
  2026 three-term Budget of Work, 322 competencies, each with its document, edition, page and link; Science teaching
  packs for 103 of the 262 weeks (English 103, Filipino 99), every one an AI draft (0 reviewed by a teacher), opened only
  when signed in; Mathematics: six pilot weeks; English teaching packs are not published. Not to be claimed: teacher or
  DepEd review or affiliation, complete coverage, verified opening in Microsoft Office (parser checks only).
- **27 Nov 22:2x Manila:** the homepage owner's Filipino batch 1 (35 items: new feature lines, the "Ang pangako namin"
  rewrite, words inside two screenshots) relayed to the Filipino owner (bridge `0250ddbe…`; file published as a 7-day
  link, sha256 `c98e7c60…`, checked byte for byte). Flagged with it: item 26's proposed Filipino says more about the
  offline app than the English does.
- **Pack content note (for the packs lane, not fixed):** `sci26-g5-t2-w10` (Grade 5, Term 2, Week 10) day 1, slide
  `d1s7`: its title, lines and teacher notes are about dropping a stone (EN "The stone falls without a push", FIL "bato"),
  but its picture is a falling mango (`falling-mango-gravity`). The science is right; the words and the picture disagree.
  Found by the homepage owner; its screenshot shows a teacher's corrected copy on a local server, the live pack unchanged.
- **27 Nov 22:27 Manila:** the Filipino owner answered homepage batch 1 (bridge `4f94a29f…`): 19 items reworded (23
  lines), 11 flags, the rest OK; relayed verbatim to the homepage owner
  (`/home/b11/tala-takeover-20261125/bridge/home-fil-batch1-answer.md`, sha256 `258ad4b9…`). Accuracy points kept:
  "check the Science before class"; a page number, not a page copy; offline named as the Android app, weak signal
  only (item 26 resolved); learners may record that both balls land together. Item 31's longer line is the copy
  owner's call; any later Filipino change goes back to the Filipino owner.
- **27 Nov 23:23 Manila:** homepage batch 1 applied by the homepage owner exactly as answered; batch 2 (one line: the
  no-number sentence shown until the Library answers) relayed to the Filipino owner (bridge `d12265f1…`). Asked in the
  same message, for the APP (release owner's lane): should the multi-grade label `carryOn` ("Ituloy ang gawain nang
  kayo lang:") become the reviewer's "Ituloy ninyo ang sariling gawain:"? A change would ship in a later app release.
- **27 Nov 23:3x Manila:** the Filipino owner answered batch 2 (bridge `2e41a780…`): item 36 OK (the homepage candidate
  has no unreviewed Filipino line); the APP label `carryOn` becomes "Ituloy ang sariling gawain" (stored without the
  colon; the combiner adds it). Made by the release owner: `637d135d9` on local branch `tala-v1-carryon-fil` (one line in
  `tala-core/src/plan/combine-words.ts`; tsc clean, core tests 326/326), to ship with the homepage so its Filipino
  planner picture matches the app. New combined plans only; teachers' saved plans keep their text. Not deployed.

## 28 Nov 2026 08:40 Manila: homepage hand-off — candidate `abe80ccac` (not deployed)

- **From the homepage owner** (Fable bea7a699): branch `tala-v1-homepage` @ `abe80ccac` (local), base `f2a154a08`, last
  app commit `766ce4b3b`, including the release owner's `637d135d9` (one Filipino multi-grade label). Its checks: clean
  export green on `abe80ccac` (core 326, server 376 + 1 skipped, web 182, build; `/` stays static, 7.28 kB / 207 kB first
  load against 204 kB on demo.19); its walk 182/182 with the live site as reference; the hero pixel-identical to live at
  four widths in both languages; 29 evidence links verified:
  https://lnj.b11.dev/reports/1357f50335ee1ffbe10513ca0b2a394935599bff3119827b48e7c85da335c2b5 (7 days). Filipino
  batches 1–3 applied as the Filipino owner answered (bridges `4f94a29f…`, `2e41a780…`, `60a7758f…`): nothing unreviewed.
- **Release owner's review:** scope as agreed (only `landing.*` keys, `landing.footerDeped` unchanged; one appended CSS
  block; `PublicShell.tsx`, the server, the lockfile and migrations untouched; 20 old screenshots deleted and referenced
  nowhere); the reveal hides nothing without script, with reduced motion or in print; pack counts are asked fresh on
  each visit (`/api/v1/packs/index`, no-store, about 7 KB compressed) and shown only when the server answered. Own
  checks: clean export of `abe80ccac` identical; the owner's walk on my build 182/182 (hero against live); a Filipino
  combine on the release build writes "Ituloy ang sariling gawain:" on screen and on the server, the old label
  nowhere: 6/6. The live hero photographed beforehand (8 shots, deterministic) for the after-deploy comparison. Window
  `release-homepage/window-homepage.sh` prepared (refuses without a "- **Homepage release approved" line): it would
  tag `tala-v1-demo.20`; rollback demo.19.
- **waiting_for_user (asked once, by the homepage owner, thread ddb4d22d):** "Release the redesigned Tala homepage to
  tala.hiraia.org? It is branch tala-v1-homepage on top of the live demo.19 and would become tala-v1-demo.20: the
  three-showcase section in place of the carousel and the seven feature cards, the reworded Filipino 'Ang pangako
  namin', and one Filipino label inside the app's multi-grade plans ('Ituloy ang sariling gawain'). No database change,
  no new setting; rollback is demo.19." Blocked on it: push, tag, deploy window.
- **Follow-ups found by the homepage owner (release owner's lane, not blocking):** the "Built with QVAC SDK" footer
  link is 40 px tall on phones; English readers see a small shift when the hero's server-rendered Filipino is swapped
  for English (also live today; grouped with the "Filipino shell after a reload" item); lesson editor, Filipino, phone:
  the timeline's end label "Pagtatapos ng klase · 60 min" runs past its card; the four editor pictures need a re-shoot
  if the lesson or slide editor changes before this ships.

## 28 Nov 2026 09:39 Manila: Luis answers "Yes release it" (rq_amzzvgnq): the homepage release is approved

Luis's complete answer: "Yes release it". Mapped by the coordinator (thread ddb4d22d) to the homepage owner's release
question above: explicit, concrete approval to deploy the verified candidate `abe80ccac` as `tala-v1-demo.20`, rollback
demo.19.

- **Homepage release approved** (28 Nov 2026 09:39 Manila, rq_amzzvgnq): branch `tala-v1-homepage` at `abe80ccac` (plus
  a docs-only merge of these notes) as `tala-v1-demo.20` on top of `tala-v1-demo.19`: the three showcases in place of
  the carousel and the seven feature cards, the reviewed Filipino "Ang pangako namin", and the reviewed Filipino
  multi-grade label "Ituloy ang sariling gawain:" (new combined plans only; saved plans unchanged). Through the
  established window: the single-writer lock, a verified backup, `deploy.sh`, only the service's own restart. Rollback
  `tala-v1-demo.19`. Not covered: unrelated code, content publication, English packs, dependency or host changes.
- **waiting_for_user: cleared.** No other question is mapped to this answer.
- **Reconciled before any write (01:41 UTC):** production `tala-v1-demo.19`, healthy, active since 27 Nov 10:07:00 UTC
  with 0 restarts; deploy lock free; running: the release owner and an unrelated Beaniebot agent (`bac224b`, not
  holding the lock); `tala-v1-homepage` and the release worktree both at `abe80ccac`, clean; no `tala-v1-demo.20` tag
  or homepage branch on origin or the host; no deploy or package process on the host.

## The homepage on production: 2026-11-28 01:45–01:57 UTC (09:45–09:57 PHT) — `tala-v1-demo.20`

**Authority.** Luis's "Yes release it" (28 Nov 09:39 Manila, rq_amzzvgnq), recorded above.

**Release.** Branch `tala-v1-homepage-release` at `4736715b5` = the approved candidate `abe80ccac` + a docs-only merge
of the notes (`af127781a`). The app payload is byte-identical to `abe80ccac` (same tree hash for core, server, web,
brand, the lockfile and the workspace files; the only differing file is this ledger). Tag `tala-v1-demo.20` (tag object
`3bdc4407…`, commit `4736715b5d94…`), pushed with the branch. Clean export of `4736715b5`: 0 type errors; tests core 326,
server 376 + 1 skipped, web 182; production build. Lockfile unchanged; 61 build-set files differ from demo.19 (the
homepage, its pictures and scripts, one tala-core line). The hiraia deploy lock held 01:45:12–01:56:39 UTC (free
beforehand; an unrelated Beaniebot agent was running, not holding it).
- **Backup** `/var/backups/tala/20261128T014539Z` (database with integrity check ok, settings, previous release
  demo.19, rows per table, library hashes; checksums verified). **Deploy** 01:45:41–01:46:12 UTC, `deploy.sh` exit 0,
  "healthy on tala-v1-demo.20"; only the service restarted; 0 restarts since. **Rollback:**
  `sudo -n ssh b11-apps /opt/tala/deploy.sh tala-v1-demo.19` (code only; nothing to undo in data).
- **Live checks:** health `0.1.0+tala-v1-demo.20`; `/` 200 and no cookie; 10 public pages 200; the contract's 26 private
  GET routes 401 signed out; `/forms` 123 files identical to the manifest; the curriculum served unchanged; 0
  migrations; 0 rows changed in any of the 37 tables at the verify step; both teaching libraries unchanged; R2 check
  passed.
- **Hero:** photographed on live demo.19 before (twice, identical) and on demo.20 after: 8 of 8 pairs (1366, 768, 390,
  360 px; English and Filipino) with 0 differing pixels.
- **Homepage walk on the live site** (the homepage owner's `home-walk.mjs`, signed out, read-only): **164/164** —
  English and Filipino at 1366, 390, 360, 768 px and 200% zoom; the language switch; the three showcases, their pictures
  (right file per language and layout, boxes kept) and their links (every on-site link 200 without a cookie; the
  outside links answer); the curriculum map is the shipped map and its pack marks and sentence are what the Library says
  now (English 103 of 262 weeks, Filipino 99); a slow and an unreachable Library (simulated in the browser: the no-number
  line, nothing moves); without script; reduced motion; keyboard, touch sizes, contrast; no sideways scrolling; the
  promise section and the DepEd disclaimer word for word in both languages.
- **The Filipino label, signed in with the test account:** a two-grade plan combined in the Filipino interface on the
  live bundle shows "Ituloy ang sariling gawain:" and the saved plan on the server carries it, the old label nowhere:
  **7/7** on the second run. The first run (3/5) stopped because the combine screen opened before the browser's first
  sync had brought the new room (on this large account) and fell back to another room (`CombineScreen` keeps the
  fallback even after the room arrives; existing behaviour since demo.15, logged below); it had written only the room,
  its subject and ten pack lessons, which the second run reused (no second room). Changed for the retry: wait for the
  room on the device and choose it; rehearsed first on the local build (7/7).
- **Saved plans unchanged:** all 1,141 of the test account's records that existed at the backup are unchanged (0
  changed, 0 gone). Before the release no record anywhere held the old Filipino label; after it, exactly one does hold
  the new one (the check's new plan); the English label is in the same 8 records.
- **Signed-in smoke (the English walk): 33/35.** Its two This Week checks read the home week, which on this Saturday is
  Nov 23–29 with Up next "Today, Saturday" (the test account has weekend classes), so the new room's weekday lessons are
  already past. Checked instead on the following week: the Grade 4 English sessions with 13 English-pack topics and the
  Science sessions with 7 Science-pack topics. Everything else in the walk passed (setup proposals, a new English
  lesson, the picker, print and Word, a multi-grade plan, Library, Community, phone, Filipino, no browser errors).
- **Other teachers' data:** every other account's rows identical to the backup in every table, apart from the
  account-free rate-limit counters and the sync sequence. Logs since the deploy: 0 errors, 0 server errors, one known
  startup notice, no key-like string; 30 client errors = the 26 signed-out probes plus 4 "no slides yet" lookups for
  lessons made seconds earlier by the walks.

**Evidence** (7 days, each file verified byte for byte):
https://lnj.b11.dev/reports/faed4b94cf661bdda5a75a901a534c28bbdb4ea20c860bed22c69d157f486665. The homepage owner's
pre-release evidence: https://lnj.b11.dev/reports/1357f50335ee1ffbe10513ca0b2a394935599bff3119827b48e7c85da335c2b5.
Files: `/home/b11/tala-takeover-20261125/release-homepage/`.

**Open follow-ups (release owner's lane, not in this release):** the combine screen should wait for the first sync
before falling back to another room; the 40 px "Built with QVAC SDK" footer link on phones; the hero's Filipino→English
swap shift for English readers (with the "Filipino shell after a reload" item); the Filipino phone timeline end label
running past its card; the next-step arrow on long This Week lists (from demo.19); the loading flashes; Office
application checks; a teacher's review; the pacing quirk (Luis). Not performed: Microsoft Office checks; a teacher's
review; any real teacher's account.

## 28 Nov 2026 17:10 Manila: separate task — the Tala desktop app (unsigned Electron, Windows and macOS)

Owner: `b11-002:648960f2` (per its bridge requests `9c04e455…` and `dc6d25f7…`: Luis reassigned the existing task
to it; predecessor `b50662a3` stopped writing, ACK `af9e2458…`; the owner is the sole writer). Base: demo.20
`4736715b5` (its worktree is on b11-002). The release owner integrates and releases; **nothing is approved; nothing is
deployed or published.** No earlier decision exists for a Tala desktop app (the V1 PRD lists it among later items;
this ledger had no entry).
- **Agreed boundaries** (release owner's bridges `6cfa6d96…`, `be725678…`): the owner alone changes
  `packages/tala-desktop/**`, `docs/tala/desktop/**` and one new `.github/workflows/tala-desktop.yml`. Untouched:
  Hiraia's workflows and its own Electron app (`packages/desktop`), tala-core/server/web, the deploy kit, the host.
  The root `pnpm-lock.yaml` stays byte-identical; the package keeps its own npm lock **and** one line
  `!packages/tala-desktop` goes into `pnpm-workspace.yaml`. Tested on a copy of the release tree with the host's own
  install command: without that line `pnpm install --frozen-lockfile --filter "@hiraia/tala-web..."` fails with
  ERR_PNPM_OUTDATED_LOCKFILE (any release containing the package would fail to deploy); with it, the lockfile check
  passes.
- **Builds:** push-tag triggers only (`tala-desktop-preview-*` tags pushed by the release owner on the owner's branch;
  `tala-v1-demo.*` builds once the package is in a released commit), never `pull_request`, no self-hosted runner;
  GitHub-hosted macos-14 / macos-13 / windows-2022. Previews are Actions artifacts kept 3 days, no GitHub Release
  (the repository is public, so artifacts can be downloaded by any signed-in GitHub user: unlisted, not private).
  Promotion is a separate manual dispatch by the release owner after Luis approves.
- **Access:** no interactive Mac or Windows machine is known to the release owner; the self-hosted `hiraia-native`
  Mac runner belongs to Hiraia's pipeline and is off-limits. Test accounts: a local tala-server with throwaway
  accounts; production signed-in checks only by the release owner on b11-dev with the retained account; no credential
  over the bridge or into GitHub secrets.
- **For Luis with the candidate (not now):** unsigned builds bring macOS Gatekeeper and Windows SmartScreen warnings;
  signing and notarization costs; where downloads are hosted; the update channel. The /download page's desktop
  section comes as a separate commit (release owner integrates; new Filipino via the Filipino owner).
- **Release-owner follow-up:** before any release containing the desktop package, add the host's install command on
  the FULL tree to the release check (the clean export covers only the build set and would not catch a new workspace
  package).
- **28 Nov 17:21 Manila — desktop preview 1** (no production change, nothing published): bundle `b768e279…` (68,119
  B) read back from b11-002 and verified; tip `dbb27f4f0` on base `4736715b5`; 19 files, all in the agreed paths; root
  `pnpm-lock.yaml` byte-identical; tala-core/server/web/brand trees unchanged. Workflow: tag-only, `contents: read`, no
  secrets, actions pinned to official release tags (checkout v4.4.0, setup-node v4.4.0, upload-artifact v4.6.2,
  download-artifact v4.3.0); builder `publish` never, credential discovery off, hardened fuses; the shell is sandboxed
  and locked to tala.hiraia.org; the npm lock pins 299 packages from registry.npmjs.org with integrity. Release owner's
  host-folder-set check of `dbb27f4f0` green (pnpm 9.15.9 frozen install, 0 type errors, tests 326 / 376 + 1 / 182,
  build). Pushed branch `tala-v1-desktop` and tag `tala-desktop-preview-1` (tag object `40fc07fa…`) → Actions run
  46130068906: Windows x64 and macOS arm64 built, installed and passed the packaged shell checks (8/8 each); macOS Intel
  built and its DMG, codesign check and ad-hoc signature verified, then the step stopped on the test's own architecture
  check (`lipo` says `x86_64`, the script looked for `x64`), so its shell checks did not run; the complete set was
  correctly withheld. The owner fixes the check in its next commit; no unchanged retry. The commit's author line is
  "Codex <codex@users.noreply.github.com>" (left as reviewed; later commits use a neutral identity).
- **Correction to the desktop entry above:** "any release containing the package would fail to deploy" is wrong. The
  production host's repository is a sparse clone holding only the root files, `patches/`, `scripts/fix-qvac-win32.mjs`
  and packages tala-core, tala-server, tala-web and brand, so `packages/tala-desktop` never reaches it. The exclusion line
  stays (right for full checkouts). Found at the same time: in a FULL checkout the root frozen install already fails at
  demo.20 on `packages/tala-mobile/package.json` (existing lockfile drift; not on Tala's host). The owner was told
  (bridge `8ae66959…`).

## 28 Nov 2026 18:00 Manila: incident — the desktop task's local test wrote to production; waiting_for_user: cleanup

- **What happened** (reported by the desktop owner, bridge `e8b2e85d…`): its local Electron walk relied on request
  interception (`app.context().route`) to keep it on a local fixture, but the app's windows use the persistent
  partition `persist:tala`, which the interception did not cover, so the walk talked to the real tala.hiraia.org.
- **Read-only check by the release owner** (counts and ids only): 5 accounts "Synthetic Desktop Teacher"
  (`desktop.<uuid>@example.com`), created 09:18:47–09:24:23 UTC, auto-verified; each holds 1 record (made at
  registration); 1 session still open (on the first account); no plans, AI jobs, model calls, slide copies or uploads;
  no server errors; each followed register → sign out → sign in → sign out → failed sign-in. No real teacher's data
  touched; no cost. One unrelated account created at 07:30 UTC was not inspected.
- **The GitHub preview run** (46130068906) made no sign-in or registration call; its packaged checks serve a fixture
  through the same interception, so they may have loaded real pages read-only (the fixture-dependent checks passed,
  which indicates the fixture was served).
- **Containment:** the owner stopped every walk and retry against the production origin and withdrew its earlier
  "local sign-in passes" claim; preview-2 (`58138574a`) is held and untagged until fail-closed isolation is proven
  (local HTTPS test origin with a nonce and a database check before any write; packaged checks under Chromium
  host-resolver rules mapping tala.hiraia.org to a local TLS fixture, everything else refused, with a negative control).
- **waiting_for_user (asked once by the release owner, thread ddb4d22d):** "Delete the 5 synthetic desktop-test
  accounts from production (5 accounts, 5 records, 1 open session; a scoped delete after a verified backup), or leave
  them in place?" Owner: Luis. Blocked: only that cleanup. Until he answers they stay as they are (they hold nothing
  else; the open session expires on its own).

## 28 Nov 2026 17:55 Manila: Luis allows synthetic test accounts and data (rq_czqd79ie), relayed by the desktop owner

- **His complete words:** "Yeah of course I'm allowing the synthetics" (thread ddb4d22d, rq_czqd79ie), relayed to the
  release owner by the desktop owner (bridge `bab3d0f1…`) with the coordinator's scope: synthetic Tala accounts and data
  for desktop verification, including bounded intentional production testing where needed; reuse known synthetic
  accounts and fixtures; never use or edit a real teacher's account or copy production records as fixtures; the five
  accidental registrations and the withdrawn local evidence stay exactly as they are (the approval is not retroactive
  isolation); fail-closed CI stays separate from clearly labelled production checks; no change to the publication
  gate, the Mac hold or any security protection.
- **waiting_for_user:** the general question whether synthetic test accounts and data are allowed is cleared. The
  separate cleanup question (delete the five accidental accounts, their five records and one open session) stays
  open: his words do not approve that scoped delete. They stay in place meanwhile.
- **Synthetic inventory on production** (read-only, accounts on the reserved example.com test domain only; full ids
  kept owner-only on b11-dev and given to the desktop owner over the bridge): `b684d160…`
  beanie-reg-20261120-1205@example.com (Beanie, 20 Nov); `998655af…` fable-release-test-20261125@example.com (the
  release owner's retained account, 25 Nov); the five accidental desktop accounts `b2478178…`, `54423778…`, `453135d7…`,
  `22dd3051…`, `ce3a1e2f…` (desktop.<uuid>@example.com, 28 Nov 09:18–09:24 UTC). The other 4 accounts are real and were
  not inspected.
- **28 Nov 18:15 Manila — desktop preview 2 (isolated)** (no production change, nothing published): the replacement
  bundle `e33cdad2…` → tip `c6be9cde6` (contains the held `58138574a`) reviewed. Its tests use no request interception:
  a real local HTTPS fixture with an ephemeral certificate pinned by SPKI only, `--no-proxy-server` and Chromium
  host-resolver rules (tala.hiraia.org to the fixture, every other name refused) from launch, a health nonce before any
  check, negative controls and a network-log check of loopback-only connections; the collector requires that evidence
  from each platform. Pushed branch `tala-v1-desktop` to `c6be9cde6`, tags `tala-desktop-preview-2` (run 46131252524) and
  `tala-desktop-preview-failure-2` (run 46131283828). Results: Windows passed in both; every Mac job passed six shell
  checks in about six seconds and then hung inside the seventh ("print iframe, keyboard, fullscreen and resize") until the
  35-minute bound cancelled it (Intel's architecture check now passes); the deliberate Intel failure worked; both complete
  sets were withheld. Preview-3 (`a9ba7c090`, a real-feature walk on a local server inside CI) reviewed and HELD
  untagged until the Mac hang is fixed. Production-walk design (one throwaway synthetic account per platform, two AI
  requests, deletion in the same process, hand-pushed tag only) approved in principle with conditions; nothing run.
- **28 Nov 18:30 Manila — desktop preview 3** (`0a1b39471`: the isolated real-feature walk on a local server, bounded
  native checks, macOS fullscreen waits) reviewed and tagged `tala-desktop-preview-3` → run 46134794220: all three
  native jobs failed while building the unchanged Tala web app on the runner, before any desktop test; the complete
  set was withheld. **Cause: a latent Tala web defect since 19 Nov** — `features/library` has `Prose.tsx` and
  `prose.ts`, imported without extensions; on case-insensitive file systems (macOS, Windows) `./Prose` resolves to
  `prose.ts` and `next build` fails. Linux (the host, every release check) never showed it; a Mac development build
  would. The only such pair in core/server/web/brand/desktop. **Fix:** `ee9d02b94` on branch `tala-v1-prose-case`
  (`prose.ts` → `prose-text.ts`, its test renamed, three imports; tsc 0, web tests 182, build ok; no behaviour change),
  pushed to origin and given to the desktop owner as a bridge export; not deployed — it rides the next web release.
- **28 Nov 18:55 Manila — desktop preview 3b** (`0f550538c`: preview 3 + the production-check code, gated off on this
  tag + the case fix cherry-picked) tagged `tala-desktop-preview-3b` → run 46135509603: **both Macs passed everything**
  (24 checks each on arm64: the 10 isolated shell checks including the fixed fullscreen check, and the 14 local
  feature checks against a local Tala server — registration, English/Filipino, session relaunch, editor, Word, PDF,
  visible Materials AI failure, Saturday/Sunday timetable, multi-grade, presenting, PowerPoint upload/edit/download,
  loopback-only); Windows failed in the owner's own unit test of the workflow gating (before any build); the complete
  set was withheld. The production-check code (`3ad34d112`) is reviewed with no blocking finding; running it still
  waits for all three platforms to pass. Owner mode on b11-dev: its library preflight (no credentials) exits 2 —
  missing libcairo, libcups, libgtk-3, libpango, to be unpacked privately before any owner run.
- **28 Nov 19:00 Manila — desktop preview 3c** (`d2a3c74a7`: 3b + the owner's line-ending fix for its workflow unit
  test) tagged `tala-desktop-preview-3c` → run 46136398872: **both Macs passed everything again**; Windows passed its
  unit tests, the web build, the installer and all 10 isolated shell checks, then the local feature walk stopped at its
  first check: the local Tala server never answered its health check in 60 tries (the server process stayed up). This
  is the first run in which Windows reached that walk, so it is not a regression; the server's own log stays private on
  the runner by design, so the cause is not yet known. Complete set withheld, nothing published, no retry or new tag
  until the owner identifies the cause; the evidence and a log excerpt went to the owner as a reviewed bridge export.
- **Owner mode** (the bounded real-AI check from b11-dev with the retained synthetic test account, under Luis's
  synthetic allowance): it created its one labelled lesson (9 sections), then timed out before asking the AI for the
  section rewrite. No AI request was sent (usage rows unchanged, no cost) and nothing else was written. Not retried; the
  owner diagnoses first. The labelled lesson stays in the test account by design.
- **28 Nov 19:20 Manila — desktop preview 3d** (`a41832acb`: startup diagnostics only — the local test now keeps the
  health status, exit code and one scrubbed error line; no app or workflow change) tagged `tala-desktop-preview-3d` →
  run 46138434327: both Macs passed again; Windows failed at the same first local step, and **the cause is now known**:
  GitHub's Windows runner checks files out with Windows line endings, so the server's curriculum packs (which record
  their own byte size) no longer match, and the server refuses to start its API ("Invalid curriculum pack metadata").
  A test-environment problem only: production runs Linux, and the desktop app does not include the server. The fix
  belongs in the desktop owner's own workflow (keep line endings unchanged on checkout); preview 3e follows after
  review. Nothing published; the production-check tag stays held. The owner also corrected my note on what one AI
  rewrite writes (every section of the lesson is re-saved, not only the rewritten one); the revised production test
  is still local work awaiting review.
- **28 Nov 19:35 Manila — desktop previews 3e and 3f.** 3e (`b2158605a`: line endings kept as committed on the Windows
  runner + an early check of the curriculum files' sizes) → run 46139259436: both Macs passed; **Windows passed every
  check for the first time** (10 shell + 14 local feature checks), then crashed while shutting the test down (the local
  test proxy wrote an error reply after a reply had already started). 3f (`2078b7f5d`: a safe proxy shutdown and a rule
  that the full set needs a completed shutdown; the reviewed real-AI test revision, still switched off on preview tags;
  a local rollback rehearsal script, not run) reviewed with no blocking finding and tagged `tala-desktop-preview-3f` →
  run 46140401357. The revised real-AI test reuses the one labelled lesson from run 2, adds one labelled school year and
  class, never touches the profile, and allows exactly the one save the rewrite makes; it has not run. Nothing
  published; the production-check tag stays held.
