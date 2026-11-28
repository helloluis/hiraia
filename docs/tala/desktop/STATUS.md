# Tala desktop — active implementation, not a release

Owner: b11-002:648960f2-bdb0-446e-b241-210032e302ff (original Codex account,
Astra 6.0). Release/integration: b11-dev:12af59a8-bcb2-4b40-af9b-da62a716244d.
Delivery thread: ddb4d22d-ceed-4509-a864-0d4dfd12f047.

## Takeover and authorization, 28 November 2026

Luis requested online Windows/Mac parity and automated installer builds at 16:45 Manila,
selected unsigned Electron at 16:49, and assigned Astra 6.0 at 16:59. No signing purchase,
new service, production deployment or publication has been authorized. Implementation,
builds and tests are authorized. The release owner will ask once about a concrete candidate.

Predecessor b11-002:b50662a3 stopped writing, had no children, processes, builds, commits or
pending permissions. Explicit bridge ACK: af9e245844c34d74aff6cdd4956666bd.
Handoff outside the repo: `/home/debian/code/tala-wt/desktop-handoff/HANDOFF.md`,
SHA256 `8b3db7255e1e55021e485e066db46fdaacb67485e1f93c3ef3adef9357cd8200`.
Same clean worktree resumed: `/home/debian/code/tala-wt/desktop`, `tala-v1-desktop`,
base `4736715b5d94d1f886f8e701c7f7d45447399330` (live demo.20).
Unrelated main-checkout `finetuning/eval/cpu-weekend/` was preserved.

Release owner agreed scope via bridge 6cfa6d968bc54e599c7c875f804ee717,
be725678e9cd4f43ad494484375cd879 and 30ee0b255b2c438e816592db5aa58376:
new package, these docs, one new workflow, and one workspace exclusion line only.
Root lockfile remains identical, before/after SHA256:
`561eb926163ec08bcd719ec14cd98c01d6be5caaa890d3293022fd1dcb92ff45`.
`CI=true npx --yes pnpm@9.15.9 install --frozen-lockfile --filter '@hiraia/tala-web...'`
passed, exit 0. No source changes to web/server/Android or their release workflows.
This checkout is sparse (the relevant web/core/server source is present); the release
owner will repeat the install in their integration checkout before pushing.

## Initial checkpoint (superseded by dated results below)

- Policy tests and complete-set collection failure tests: 3 passing.
- Electron 45.5.0 on Linux x64, real sandbox enabled (`chromiumSandbox: true`):
  8 synthetic integration checks pass. These cover Node isolation, hostile navigation,
  same-origin child windows, external-link confirmation, denied permissions, print iframe,
  keyboard input, persistent secure cookies after relaunch, and network failure/retry.
  This is shell evidence, **not** live feature parity or native Windows/macOS evidence.
- First Linux test launch: missing xauth. Private Xvfb then revealed missing GTK 3.
  Installed Debian libgtk-3-0 and xauth; tests now pass with sandbox enabled.
- First Windows cross-build: produced an unpacked Windows executable, then stopped at
  NSIS with `spawn wine ENOENT`. No installer claimed. Do not repeat without a changed
  prerequisite. Native Windows CI is the next build route.
- No native builds or CI run completed at this checkpoint. No installer preview links yet.

## Required matrix — do not replace unverified cells with assumptions

| Check | Windows x64 | Mac arm64 | Mac x64 |
|---|---|---|---|
| Installer, launch, relaunch, uninstall | Unverified | Unverified | Unverified |
| Shell isolation/navigation/network recovery | Unverified | Unverified | Unverified |
| Registration/login/logout and session continuity | Unverified | Unverified | Unverified |
| EN/FIL, timetable, weekends | Unverified | Unverified | Unverified |
| Lesson creation, real AI success/error, Materials and rewrites | Unverified | Unverified | Unverified |
| Multigrade, slideshow generation/editing/presentation | Unverified | Unverified | Unverified |
| Uploads, PDF/DOCX/PPTX save and open | Unverified | Unverified | Unverified |
| Native print dialog and external browser | Unverified | Unverified | Unverified |
| Resize, keyboard, accessibility | Unverified | Unverified | Unverified |
| Full pipeline and controlled failure | Unverified | Unverified | Unverified |

## Dependencies and remaining work

- Preview source goes as a reviewed git bundle to the release owner, who pushes
  `tala-desktop-preview-*` tags. GitHub-hosted Windows/macOS only; the self-hosted Mac
  `hiraia-luis-mac` is explicitly off-limits. No interactive Windows/Mac route was provided.
- The release owner's suggested older Mac labels were corrected using current official
  docs: `macos-15` arm64, `macos-15-intel` x64, `windows-2022`. A real run must verify them.
- Native installed-app CI smoke, actual local Tala feature walks, downloads and failure
  exercise remain to run. Production test credentials stay with the release owner.
- Publication storage choice, stable latest manifest and download-page integration remain
  proposals for the release owner. Workflow only creates 3-day preview artifacts and
  never publishes or advances latest. Production publication approval is **not yet asked**.
- Camera/microphone/location/notification/device permissions are denied. Camera-based
  QR enrollment needs a scoped permission implementation/test if desktop parity requires it.
- Google sign-in is disabled in the live configuration; if enabled later, it needs a
  system-browser OAuth flow. The hosted app's email/password flow is the current target.
- Native menus/recovery currently use English. Website EN/FIL remains the existing UI.

At the initial checkpoint no waiting_for_user decision was pending. Native CI dispatch is owned by the
release owner after source review; this is coordination, not a request to repeat Luis's
Electron/unsigned decision.

## Preview-1 result, 09:23 UTC

Source `dbb27f4f0f67c50b88788d3708f0544f370d9091`, tag `tala-desktop-preview-1`.
Run: https://github.com/helloluis/hiraia/actions/runs/46130068906 .

- Windows x64: NSIS build, silent install, all 8 packaged shell checks, relaunch,
  uninstall and artifact upload **passed** on windows-2022.
- Mac arm64: DMG build, mount/copy, strict ad-hoc signature check, all 8 packaged
  shell checks, relaunch, removal and artifact upload **passed** on macos-15.
- Mac Intel: DMG build, CRC/mount/copy and strict ad-hoc signature check passed.
  The test incorrectly searched lipo output for `x64` instead of `x86_64`; it stopped
  before Electron launch. No Intel artifact was uploaded. Corrected in preview-2.
- Complete-set job skipped, as required. No current release or production pointer changed.
- Release owner's independent host-folder-set gate passed: core 326 tests,
  server 376 plus 1 skipped, web 182, type checks and Next build. Their correction:
  production is sparse and does not see the desktop package; the exclusion protects
  full checkouts. A separate pre-existing tala-mobile lock mismatch prevents a clean
  full-repository frozen install at demo.20; it is not introduced by this task.

## Local feature-test routing investigation — evidence withdrawn

An uncommitted local feature walk initially appeared to pass registration/language/session
checks. A seeded local account then could not log in from Electron although direct API
login succeeded. Instrumentation found no intercepted API calls. The walk was stopped;
**its local-only/auth parity claims are withdrawn** until routing is proven fail-closed.
The release owner was asked in bridge e8b2e85d21714134a6bea3e58f981034 to inspect whether
synthetic `desktop.*@example.com` / `Synthetic Desktop Teacher` registrations accidentally
reached production. No real teacher data or AI generation was touched. Do not rerun that
walk against the production hostname; use a separate local HTTPS origin and verify a unique
local health marker and local DB account before any writes. Any corrective cleanup belongs
to the release owner. The script is not part of preview-2 or CI.

Preview-2 also preserves/intersects the site's CSP instead of overwriting it and validates
the immediate download URL as well as the redirect chain. Publication helper tests cover
failed read-back, stale-pointer detection and complete-set rollback with synthetic bytes.
The publication/download-section files remain **proposals**, with no host/web edits.

## Confirmed test incident and replacement isolation, 09:32 UTC

Release owner bridge 1326ae4c5ede4715861978b4c5237e05 confirmed five synthetic accounts
were created on production between 09:18 and 09:24 UTC. Footprint: five users, five
initial profile records and one open session; no plans, AI jobs/calls, uploads, slides
or changes to real teachers. The predecessor and native CI did not create them.
The local walk was stopped, its evidence withdrawn, and Luis informed in the task thread.
Production cleanup is owned solely by release owner 12af59a8 and awaiting their single
specific approval request (backup + delete exactly those five synthetic accounts, or
leave them). No cleanup has been performed by this implementation lane.

The first preview-2 bundle at `58138574a` was **held, never tagged**, pending a safe fixture.
The replacement test does not use `app.context().route` at all:

- A real ephemeral HTTPS fixture runs on 127.0.0.1. Its key is deleted at test end.
- Before Electron's first load, `--host-resolver-rules` maps tala.hiraia.org to that local
  fixture port, all other hostnames to NOTFOUND; `--no-proxy-server` prevents proxy bypass.
- Only the generated certificate's SPKI is pinned for that process. No system trust store,
  global TLS bypass, sandbox or webSecurity change.
- Every launch must fetch the local fixture's unique nonce. Requests are counted by the
  server. A production-API-path POST is deliberately refused with 403 by that local server,
  and another production hostname cannot resolve. No credentials are submitted.
- The full-startup Chromium net logs are checked for TCP_CONNECT_ATTEMPT destinations;
  all must be loopback. Successful Linux run: 11 fixture requests, zero non-loopback TCP
  connections, 10 checks passed. Receipt: `evidence/isolation-linux-x64.json`.
- Complete-set collection now requires this isolation evidence from each native platform.
  Preview-1's native shell evidence is provisional until rerun under the proven boundary.

The source feature walk has separately moved to an actual 127.0.0.1 HTTPS origin, with
unique local build ID, environment=local, and temporary SQLite checks before registration.
It is not part of the replacement preview yet. No further production-origin feature walks.

## Preview-2 accepted; local feature walk, 09:46 UTC

Release owner accepted the replacement isolation review and tagged `c6be9cde6`:

- Normal run: https://github.com/helloluis/hiraia/actions/runs/46131252524
- Deliberate Intel failure: https://github.com/helloluis/hiraia/actions/runs/46131283828

Await the owner's native result/export. No independent retry, tag or publication.

The replacement local source walk now passes **14 checks** with the unchanged demo.20
web/server. Receipt: `evidence/features-linux-x64.json`. It verifies local DB registration,
sign-in/out, relaunch/session continuity, EN/FIL, Materials failure with preserved inputs,
Saturday/Sunday schedule persistence, multigrade combining and an editable session note,
actual session presentation and keyboard navigation, DOCX ZIP contents, PDF rendering,
and synthetic PPTX upload/edit/download with saved text in the resulting archive. The
session presenter honestly uses the app's placeholders where grade slides are absent;
this does not demonstrate AI-generated slides. Native dialogs are not automated: the
test sets the download destination and uses `printToPDF`, and does not open Office.

The feature-walk candidate uses the already proven DNS/SPKI boundary for installed apps,
builds the original web source on each hosted runner, and requires its native receipts
before a complete set can be collected. The server refuses inherited model/storage
settings and live Next environment files. Synthetic upload bytes stay in its temporary
SQLite database. Nothing adds a backend to the downloadable app. Native execution of
these feature checks remains unverified until the release owner's next reviewed tag.

### waiting_for_user — cleanup only

Decision owner: Luis. Operation owner: release agent
`b11-dev:12af59a8-bcb2-4b40-af9b-da62a716244d`. The release owner asked once in thread
`ddb4d22d-ceed-4509-a864-0d4dfd12f047`; there is no Luis response/request id yet.
Exact question: **“Delete the 5 synthetic desktop-test accounts from production (5
accounts, 5 records, 1 open session; a scoped delete after a verified backup), or leave
them in place?”** Blocked operation: only that cleanup. Default: leave them unchanged.
Authoritative ledger: `docs/tala/teacher-portal/STATUS.md` on `tala-v1-filipino`,
commit `fcd02f14f`, entry “incident — the desktop task's local test wrote to production”.
No duplicate question from this lane. Publication is separately unrequested until the
release owner has a concrete verified candidate and its remaining limitations.
