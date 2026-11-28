# Tala desktop candidate — 28 November 2026

**Verified unsigned preview; not published.** Windows x64, Mac Apple silicon and Mac
Intel installers exist and passed native hosted-CI checks. Manual checks listed below
remain unverified, so this is not a claim of exhaustive feature parity. Publication,
permanent hosting and the download-page release require Luis's specific approval through
the existing release owner. No production host or current download was changed.

## Download the tested candidate

Version **0.1.0**, Electron **45.5.0**; release `tala-desktop-preview-production-1`.
Full source commit: `c8d99c04851ea824877975e7f8503974d3382886`; sourceDirty=false.
These exact installed binaries also passed the bounded real-AI production checks.

| Platform | HTTPS preview ZIP | Installer inside | Installer bytes |
|---|---|---|---:|
| Windows x64 | [Download](https://github.com/helloluis/hiraia/actions/runs/46142209678/artifacts/15262481793) | Tala-0.1.0-win-x64.exe | 121,509,249 |
| Mac Apple silicon, macOS 13+ | [Download](https://github.com/helloluis/hiraia/actions/runs/46142209678/artifacts/15262681226) | Tala-0.1.0-mac-arm64.dmg | 120,573,315 |
| Mac Intel, macOS 13+ | [Download](https://github.com/helloluis/hiraia/actions/runs/46142209678/artifacts/15262696631) | Tala-0.1.0-mac-x64.dmg | 126,586,012 |

[All three installers and original manifest](https://github.com/helloluis/hiraia/actions/runs/46142209678/artifacts/15262930570)
are available in one 368,671,271-byte ZIP. SHA256 of that **ZIP**:
`c4a8eca1cce1a8ed9c2ba68c39715ec9a9814b457c5bd6f29f5adc64b57ba521`.

GitHub sign-in is required. These artifacts are unlisted in a public repository, not
private, and expire **1 December 2026 around 11:59–12:02 UTC (19:59–20:02 Manila)**.
They are immutable run/artifact URLs while retained, not permanent distribution links.
Verified copies are retained in the existing desktop handoff on b11-002 and the release
owner's reviewed export. Do not redistribute them as an approved release yet.

SHA256 of each **installer**, not its containing ZIP:

| Installer | SHA256 |
|---|---|
| Windows x64 | `a0e6922e9f321a397b9dd199d6d674191a9652e7c0754374e29ce41c9c241b7c` |
| Mac arm64 | `fb99be74891a89652d28b210a07e2ed104bab0ade1564aaaa7d2fad9103f9274` |
| Mac x64 | `04cdc7a069c3ebb071ccdd71cbc83613cfd0edab520fdd03dda2e4528c5e127d` |

The [original machine-readable manifest](evidence/desktop-release-production-1.json)
records platform, architecture, version, signing, bytes, digest, build time and source.
Its original 2,129 bytes have SHA256
`c87fbd2cfba9687e58e5e4238882a03aca7d572c5fd8aee9313d40416d0cf035`.

The release owner downloaded the complete archive over GitHub HTTPS and compared it
with GitHub's upload digest. This lane independently rehashed the transferred archive,
the unchanged manifest and all three installers, checked PE/UDIF headers, and matched
public GitHub API metadata. Transfer used the supported reviewed-asset bridge. Native
evidence proves execution; headers and packaging alone are not treated as parity proof.

## Evidence and practical limits

| Evidence | Result |
|---|---|
| [Normal native run 46141524544](https://github.com/helloluis/hiraia/actions/runs/46141524544) | All three native jobs and complete-set passed; 10 shell + 14 real local-server feature checks per platform; teardown completed |
| [Production check 46142209678](https://github.com/helloluis/hiraia/actions/runs/46142209678) | All three local walks passed again, followed by one real Content rewrite and one real slide generation/application per platform; complete-set passed |
| Production cleanup audit | All three ephemeral synthetic accounts and their scoped records/jobs/decks were removed; exactly 6 provider calls, no retries, US$0.006358; no teacher-data edits or file/R2 uploads |
| [Controlled failure 46142841866](https://github.com/helloluis/hiraia/actions/runs/46142841866) | Intel deliberately failed; other two passed; no Intel/complete artifact and no production-check execution |
| [Real-installer rollback report](evidence/actual-artifact-rollback-20261128.json) | 5/5 passed; 19 loopback HTTPS requests; failed Mac read and stale pointer preserved latest; rollback restored the original pointer byte-for-byte |

The [native summary](evidence/native-verification-20261128.json) records measured
counts and receipt digests without synthetic identities. The complete
[test matrix and attempt history](STATUS.md) separates Linux source, native isolated
and explicitly authorized production evidence. Local Chromium traffic was confined
to loopback with a nonce, network-level mapping and negative controls. Production
checks were separate, bounded, owner-reviewed runs under the deploy lock.

Automated native coverage includes install/launch/relaunch/uninstall, secure-session
continuity, email/password auth, EN/FIL screens, timetable/weekends, lesson/Materials
controls and a real missing-provider error, multigrade combination/editing, uploaded
PPTX editing/export, PDF/DOCX bytes, real generated-deck editing/presenting, keyboard,
resize/fullscreen, hostile navigation/popups, denied permissions and network recovery.

Remaining limitations:

- No interactive consumer Windows/Mac machine was provided. SmartScreen/Gatekeeper
  warning flow, native Save/print dialogs, physical printing, actual external-browser
  handoff, opening PDF/DOCX/PPTX in installed applications, and screen-reader/manual
  accessibility have not been verified. Hosted-CI install tests do not establish these.
- The Save dialog is bypassed for byte checks; printing uses printToPDF. DOCX/PPTX
  archives are inspected without Microsoft Office. External dialog/browser calls are
  mocked in the policy checks. File chooser interaction is observed through Playwright.
- Multigrade presentation uses visible placeholders for absent grade slides; successful
  real deck generation is a separate test. A generated multigrade deck and successful
  Materials AI rewrite remain unverified; real Content rewrite and Materials error
  handling passed.
- Native menus/recovery are English. Website EN/FIL is covered. Device permissions
  are denied; any future camera enrollment or Google OAuth feature needs separate work.

The app uses the live Tala site, with no embedded backend or feature fork. Renderers
have Node off, context isolation, sandbox and web security enabled. No preload/IPC or
embedded credentials are exposed. Navigation is restricted; allowed document downloads
use the native save flow and are never automatically executed.

## Install, update and release behavior

Windows is unsigned. Both Macs have verified **ad-hoc** signatures, without Developer
ID or notarization; this is not Apple approval. Expect OS warnings. Use the specific
app's offered override only after checking the source/hash and within device policy;
never disable OS protections globally. See [installation and rebuild instructions](README.md).
Removing the app does not request cloud-account deletion; local profile data is preserved.

The reviewed tag workflow automatically builds on `tala-v1-demo.*` after integration
into a released commit, and on owner-pushed `tala-desktop-preview-*` tags. It does not
build every feature branch. Matching metadata and all three native jobs are required
before a complete set is collected. A desktop failure does not change or block a web
release and cannot advance the desktop download set. Root pnpm-lock.yaml remains
byte-identical (`561eb926163ec08bcd719ec14cd98c01d6be5caaa890d3293022fd1dcb92ff45`).

**There is no installed-binary auto-updater.** Hosted features update with Tala's website;
teachers download and reinstall a newer desktop binary when released. Current CI produces
three-day preview artifacts only; no latest pointer or production download page exists yet.

## Concrete release-owner handoff

The proposed publication candidate is the exact production-check-1 set above. The prior
[preview-3g complete set](https://github.com/helloluis/hiraia/actions/runs/46141524544/artifacts/15261848904)
is a second verified build and the local rollback baseline. Both manifests remain original;
their release names differ and their source commits match. Their differing bytes are not
claimed to be reproducible builds. Neither set is currently published as a product release.

The [hosting/download proposal](PUBLICATION-PROPOSAL.md) uses the existing Tala host at
`https://tala.hiraia.org/download/desktop/`, immutable release/commit directories and one
whole-set latest manifest. It includes a tested staging/promotion tool, strict manifest
parser, download section and reviewed English/Filipino strings. The release owner owns
the disk read, nginx rules, page integration, exact approved-release restriction and
web release. Android remains intact. No new paid service or CI deployment secret is needed.

After reviewing this handoff, the release owner asks Luis once whether to publish these
specified unsigned installers and the download section with these limits. They own the
approved deploy window, HTTPS production read-back and pointer backup/rollback. This
document does not grant publication approval. Interactive checks and any resulting fixes
remain outstanding; a new binary would require its own matching native evidence.

The separate earlier five-account cleanup question stays open. Its incident and withdrawn
local-only claims are preserved in STATUS.md; synthetic authorization did not rewrite them.
