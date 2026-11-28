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
| Installer, launch, relaunch, uninstall | Preview-2 passed | Preview-3b passed, ad-hoc signature verified | Preview-3b passed, ad-hoc signature verified |
| Shell isolation/navigation/network recovery | Preview-2 10/10 | Preview-3b 10/10 | Preview-3b 10/10 |
| Registration/login/logout and session continuity | Unverified | Actual local server passed | Actual local server passed |
| EN/FIL, timetable, weekends | Unverified | Actual local server passed | Actual local server passed |
| Lesson/Materials controls and real missing-provider error | Unverified | Actual local server passed | Actual local server passed |
| Real AI success, section rewrite and slide generation | Unverified | Unverified | Unverified |
| Multigrade combining, PPTX editing, session presenting | Unverified | Actual local server passed (placeholder session slides) | Actual local server passed (placeholder session slides) |
| Uploads and PDF/DOCX/PPTX saved bytes | Unverified | Actual local server passed; Office opening unverified | Actual local server passed; Office opening unverified |
| Native print dialog and external browser | Unverified | Unverified | Unverified |
| Resize, keyboard, accessibility | Automated shell input passed; accessibility unverified | Automated checks passed; accessibility unverified | Automated checks passed; accessibility unverified |
| Full pipeline and controlled failure | No complete set; failure gate held | No complete set; failure gate held | No complete set; intentional failure gate held |

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

## Mac preview-2 wait; preview-3 held

Public GitHub job metadata and release-owner bridge c779b10ad1d04c919aa42e2a1e3be09e
agree: Windows passed the isolated shell checks in both runs. The deliberate failure
stopped the Intel job in the failure run as designed. Both normal Mac jobs and the
failure run's arm64 job remain inside the packaged test step. GitHub's log endpoint
answers 404 until they finish; the 35-minute job limit is around 10:11–10:12 UTC.
No complete set is available. The release owner is collecting the final logs/evidence.

`a9ba7c090` (the 14-check feature walk) was reviewed but **not tagged**. Hold request:
cb8ace1a31014d378f4a75695a4bb7f2. Do not dispatch it unchanged while the common Mac
shell wait is unexplained. Keychain access for encrypted cookies is a hypothesis only.
Electron's upstream [test change](https://releases.electronjs.org/pr/53790) documents
the same class of unsigned-app test wait, but these run logs must establish where it
stopped before selecting a remedy. App security settings remain unchanged.

Next-test diagnostics add a deadline around every check, progress receipts, bounded
Electron shutdown and a failure screenshot only on an ephemeral GitHub-hosted Mac.
Only the Electron subprocess started by the test may be killed. Source Linux shell
checks pass with that harness. The Mac minimum OS declaration is corrected from 12
to 13, following [Electron 44's removal of macOS 12](https://www.electronjs.org/blog/electron-44-0).
No older-OS support is claimed from the previous metadata.

## Mac final diagnosis and replacement candidate, 28 November

Release-owner bridge `34cd72b1b1e24005861682ada8305622` supplied the final logs.
Normal preview-2's two Mac jobs and failure-2's arm64 job were cancelled at the
35-minute limit (10:11:43–10:12:07 UTC). DMG verification, mount/copy, strict ad-hoc
signature and architecture checks passed. All three stopped after the sixth shell
PASS line, inside check seven: print iframe, keyboard, fullscreen and resize.
The cookie/relaunch check never began. **The earlier Keychain hypothesis is withdrawn.**
No mock Keychain or shipping security change was made. Windows passed in both runs;
complete-set was skipped and no artifacts were promoted.

Check seven creates a print iframe but never invokes a print dialog. Its fullscreen
exit immediately followed DOM fullscreen entry. Electron documents macOS fullscreen
transitions as [asynchronous](https://www.electronjs.org/docs/latest/api/browser-window#winsetfullscreenflag):
the native entry/exit events must precede dependent actions. The replacement waits for
`enter-full-screen` before exit and `leave-full-screen` before resize on macOS. Other
platform checks remain in place; resulting window bounds are now also asserted.
Every substep is logged before execution, bounded, and recorded with native/HTML window
events. A failure retains partial progress and an ephemeral runner screenshot.

Linux source shell checks pass 10/10 with the new substeps. The bounded local feature
harness also passed its 14 checks on Linux. This is a candidate fix for the native Mac
stall, **not yet a confirmed Mac result**. A replacement reviewed preview-3 range is
required; the earlier `a9ba7c090` range must not be tagged on its own.

## Explicit synthetic-test approval — rq_czqd79ie

Luis, 28 November 2026 17:55 Asia/Manila, thread
`ddb4d22d-ceed-4509-a864-0d4dfd12f047`, complete message:

> Yeah of course I'm allowing the synthetics

Approval covers synthetic Tala accounts and data for desktop verification, including
bounded intentional production testing where needed. No general synthetic-data permission
gate remains and this permission must not be asked again. Prefer existing identified
synthetics where accessible; never use/edit real teacher accounts, lessons or files, and
never copy their production records into fixtures. Exact IDs/files must be inventoried
before cleanup. This is not blanket deletion authority: the separate five-account cleanup
question above remains with the release owner until Luis resolves it.

The accidental five production registrations/profiles and one session remain an incident;
their withdrawn local-only results stay withdrawn. Isolated CI continues fail-closed.
Any intentional production checks must be separately labelled with their synthetic identities
and bounded operations. This approval does not release the held Mac run, weaken sandbox or
network protections, grant publication approval, or turn unperformed checks into passes.

## Replacement preview-3 and bounded production candidate

Release-owner bridge `49bf6c7a94804bdeaab880bc97e5d536` reviewed the replacement bundle
(25,230 bytes, SHA256 `ef87f534b4bbe44a959ce4393bc744b6e318905660bf23e38d21b046ec3f1c28`)
and pushed `tala-desktop-preview-3` at `0a1b394711d6e20018230faa0f2845c67e1ba538`.
Run: https://github.com/helloluis/hiraia/actions/runs/46134794220 . Native results pending.
This is a normal isolated run; it contains no production-test invocation.

The separate production design was accepted in principle in bridge
`46cb8899c51e4bdfa6a642546a2dd28b`. Its implementation is now a review candidate in
`PRODUCTION-VERIFICATION.md` and `test/production-*.cjs` / `production-seed.mts`.
It remains unexecuted against production. An owner-reviewed dedicated tag is required
after all three native local checks pass. Existing synthetic credentials never enter CI.
The retained-account owner mode creates one new labelled lesson and rewrites Content
once; native mode creates one bounded cohort account, also generates one new deck,
then self-deletes in finally. No upload, existing-record edit or production host action.

Offline verification: seven Node tests pass, including adversarial request-guard cases,
write/AI caps, reserved self-deletion, owner-account protection, production-tag gating
and complete-set rejection on missing/uncertain production cleanup evidence. The seed's
ten new records validate against the unchanged Tala schema/sync engine without any
network call. Two publisher tests pass, including real loopback HTTPS read-back,
controlled HTTP 503 preservation and whole-set rollback with synthetic bytes. These
results do not claim real-AI success, a native production walk, or published installers.

## Preview-3 stopped at the native web build; owner-supplied fix

Release-owner bridge `00fc7f40458f4127b9bdd847cb2f2f4b`: all three native jobs failed
at the unchanged web build, before packaging or shell tests. `Prose.tsx` and `prose.ts`
in the web library feature collide during extensionless resolution on case-insensitive
filesystems. Linux production/build checks did not expose the defect. Complete-set
was skipped. The Mac fullscreen candidate and native feature walk remain unexercised.

The release owner supplied and explicitly authorized cherry-picking `ee9d02b94` only:
rename `prose.ts`/its test to `prose-text.ts` and update three imports, with no behavior
change. Reviewed bridge export SHA256
`94d021705e78727649361291936e68fb450eedbe03015aaaf69f4bf04d432969`, 14,614 bytes,
received through request `0c129bcb9c12498ab814fe6186b9000c`. The exact fix was applied
as `72be6d30d`; the web tree matches the owner's fix commit byte-for-byte. This is an
owner-supplied exception to the desktop-only edit boundary, not an independent web edit.
The owner reported 182 web tests, type checking and Next build passing; six renamed
prose tests also pass here. Root lockfile remains unchanged. A fresh normal preview-3b
can now reach the native shell/feature checks without repeating the known build failure.
Production-check tagging and publication remain separately held.

## Preview-3b running; Linux owner-mode prerequisites

Release-owner bridge `0fb70c2b1b3c479da8d78d8ccb1fef80` reviewed and tagged
`0f550538c40ce401d8081887eb2154ef9d6fbb7c` as normal `tala-desktop-preview-3b`:
https://github.com/helloluis/hiraia/actions/runs/46135509603 . They approved the
bounded production code with no blocking finding; execution still requires all-three
native local success. No production check from this harness has run.

The release owner's Linux host lacks a display server. Electron 45.5.0's explicit
`--ozone-platform=headless` passed all ten isolated shell checks and fourteen real
local feature checks here with DISPLAY and WAYLAND_DISPLAY unset. No sandbox,
webSecurity, certificate, GPU-security or session-encryption flag was changed.
Next was rebuilt after the owner's prose rename and passed. This remains Linux
source evidence, never native Windows/Mac evidence.

Owner bridge `081ae66db6634f84ab37ddb9a806ddc0` requested a library preflight.
`test/linux-preflight.cjs` runs ldd on the selected Electron binary and reports only
missing library names; owner mode stops before credentials/profile/network if it
fails. A negative control supplies a missing library and verifies that early exit.
Nine Node tests pass. On b11-dev, the owner reports missing GTK 3, cups, pango and
cairo; they own any private dependency prefix under their locked-package policy.
No package or service changes have been made on that host by this lane.

## Preview-3b: both Macs pass; Windows test-parser defect

Release-owner bridge `65e7b99ef9134ed1ae509950182330ef` confirms both native Mac jobs
passed all ten shell and fourteen real local-server feature checks. The fullscreen
transition fix works on both architectures, and persistent secure cookies survive
relaunch with the cookie-encryption fuse enabled and no Keychain workaround. Installer removal also completed. Windows
failed before building at `workflow.test.cjs` because its LF-specific regex did not
find the production step in the Windows checkout. Complete-set was skipped.

Reproduced with Git's actual CRLF checkout conversion:
`git -c core.autocrlf=true cat-file --filters HEAD:.github/workflows/tala-desktop.yml`.
The converted bytes contain CRLF; the old regex fails and normalization makes it
match. The test now normalizes input and runs the full gating assertions against
both LF and CRLF cases. No workflow condition or application behavior changes.
A normal preview-3c is required for Windows's first native local feature walk and
the first complete set. Production execution remains held until that set passes.

## Preview-3c Windows diagnosis; owner-mode run 2

Run https://github.com/helloluis/hiraia/actions/runs/46136398872 at `d2a3c74a7`:
both Macs passed again. Release-owner bridge `41960af4598c4974972039a02c8931cf`
confirms Windows installed, passed all ten packaged shell checks, and uninstalled.
Its first local feature step failed: sixty health probes did not return OK, while the
Next process remained running. No Electron feature page launched and no fixture API
request occurred. The previous harness discarded response/error details and deleted
its private server log, so the cause is not yet known. No complete set was collected.

The reviewed Windows evidence ZIP was received through bridge request
`aec08900a8c2466aae9ac8d78b883342`; its 3,294 bytes and SHA256
`5c567e938bc0fae6515005dcad462cef90000d80632d84cd82c5aa9bbbfc6533` match the
owner's GitHub export. The actual shell receipt confirms packaged=true, ten passes
and zero non-loopback TCP connections; the local receipt confirms no health nonce.

The next diagnostic candidate records measured health status/error code, process exit
code and one bounded, scrubbed startup-error line before any registration. Raw server
logs and bodies are not retained. Eleven Node tests, including redaction controls, pass;
the modified startup path and all fourteen local feature checks also pass on Linux.
This instrumentation supplies missing evidence; it is not a claimed Windows fix.

Owner production mode ran on b11-dev only, 10:45:57–10:46:26 UTC, run
`owner-20261128-2`, with the retained synthetic account. It created one labelled plan
and nine sections, then timed out before any AI submission. Five total write requests
(three seed, login, logout); zero section/slide requests, zero blocked requests and
no new generation jobs/provider calls/cost, confirmed by the owner's read-only audit.
The labelled lesson remains for reuse. Run 1 failed in a non-git export before network
contact; the owner corrected that prerequisite with a sparse worktree for run 2.
Reviewed receipt SHA256:
`eb4beefc024245d0262c3bab2e2f3b2b767f58fe5677d6da61c710dcd585f99e`, 13,326 bytes.

Source establishes a necessary correction: `EditorScreen.tsx` renders Rewrite only
when `ed.cls` exists. The standalone fixture cannot show it, regardless of wait time.
Owner bridge `1134f96bc4894947b797aef9f75eef7e` accepts a revised bounded fixture for
review: one separate labelled school year/class, link only the existing test plan,
no profile change or existing class edit, and consistent grade-group IDs. Owner mode
retains these test records; ephemeral native mode deletes them with its account.
The revised production code must be reviewed before another run; no blind retry.

## Preview-3d names the Windows startup cause

Release-owner bridge `883a3c96bc6f4bc09c337af6e402d786`: run
https://github.com/helloluis/hiraia/actions/runs/46138434327 passed both Macs again;
Windows passed build, install and ten isolated shell checks, then health returned 500.
The new diagnostic named `Invalid curriculum pack metadata: english-bow-2026-g10.json`.
The committed pack declares 153,117 bytes. Windows Git checkout adds 2,602 carriage
returns, yielding 155,719 bytes, and the unchanged server correctly rejects it.
The desktop app does not contain this server; production Linux uses the original bytes.

The workflow now disables Git CRLF conversion on the temporary Windows runner before
checkout. An early check compares every curriculum pack to its exact Git blob and its
declared byte count; it never rewrites data or relaxes server validation. The actual LF
packs pass, and a deliberate CRLF conversion fails both independent checks. A normal
preview-3e is needed for native verification. Production-check execution and publication
remain held; no complete installer set exists yet.
