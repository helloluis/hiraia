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

## Checks executed so far

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

No waiting_for_user decision is currently pending. Native CI dispatch is owned by the
release owner after source review; this is coordination, not a request to repeat Luis's
Electron/unsigned decision.
