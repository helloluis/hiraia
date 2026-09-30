# Hiraia 0.4.27 — Android and ChromeOS

Released 30 September 2026 (GMT+8), Android versionCode **27**.
Tala remains at its existing release; no teacher APK or telemetry contract changes.

The wide reader shows up to 3.5 cards with all controls in two compact top rows.
Touch, mouse, trackpad, keyboard and screen-reader navigation are supported;
large text and smaller windows show fewer cards. Quiz content and continuation
controls scroll without being cropped. Phone portrait keeps the vertical feed.

Hiraia.org now has separate Android and ChromeOS download rows with real emulator
screenshots, per-platform requirements and verification details. Windows is planned,
with no download until an executable exists. The updater uses the installed build's
explicit distribution label, so ChromeOS never receives the phone-only APK.

## Published pair

Build manifest: `build/app-releases/20260929T232521Z/release.json`.
Source commit: `1b06f850d40be4340fd258dd4df86a48ddca0d81`.
Source input SHA-256: `08299b928301b18bf71cfbf5151edf3d5510e0de0913ed98a5a6d93be6ff3c47`.

| Platform | File | Bytes | OTA runtime |
| --- | --- | ---: | --- |
| Android | `hiraia-v0p4p27.apk` | 437,250,921 | `6946cb84c3bfedfdce13d6fb604fd0f368660753` |
| ChromeOS | `hiraia-v0p4p27-chromeos.apk` | 522,058,276 | `a79b1e8c4bcd07f8030d4a6bc92ea6663b9bd414` |

**Android**: [download](https://assets.hiraia.org/models/hiraia-v0p4p27.apk).

- SHA-256: `20e7cebd5d2282200b7cedc4060eaf774e232b93ce2f654edcc84c86ca3bc15a`
- MD5: `081467698d806fd8fac5e68f1fe142f7`
- ABIs: arm64-v8a

**ChromeOS**: [download](https://assets.hiraia.org/models/hiraia-v0p4p27-chromeos.apk).

- SHA-256: `076f20c33185b86f7c95f04aed91e69276af2ecbf507b417774b5e1bed482fbd`
- MD5: `3fddcef35d5223fdf6157e5b478aab29`
- ABIs: arm64-v8a, x86_64

Both APKs use the established release certificate:
`40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35`.
The public v0.4.26 immutable files are retained unchanged.
The asset catalog is revision 5, restricted to code 27 with image baseline
`14d7c42699fd80bd`; the app's `parseAssetCatalog` accepts all 42 packs.

## Validation

- Formal regression: 45/45 cases, 111 draws. A separate fresh Actions checkout
  passed another 45/45 gate before building both platforms.
- Post-release run `36648181847` stopped before building at 44/45: the existing
  grade-register photosynthesis case produced identical Grade 3/10 wording in all
  three sampled pairs. Queued run `36648182032` passed 45/45 on the same source with
  no gate/model changes. Grade steering remains an intermittent model limitation;
  failed gates must continue to block APK creation.
- Platform/update/publisher failure guards and adaptive reader/review tests pass;
  TypeScript passes. The inherited type-aware ESLint configuration remains broken
  and is not claimed green. The old generic CI workflow remains disabled as found.
- Signed installed APK hashes match the published pair. All 58 Android and 129
  ChromeOS native libraries, and the Hermes application bundle, match the validated
  development pair. Native x86 QVAC probe evidence is in `CHROMEOS-20260929.md`.
- Phone cold launch after a fresh emulator process: 2.595 s, with networking disabled.
  Desktop cold launch after a fresh emulator process: 2.924 s; repeated fully offline
  launch: 2.421 s. Cached QVAC initialized with no network route: semantic ready in
  5.804 s, model loaded, CPU generation warm-up 0.557 s, semantic/generation both ready
  at 07:52:05 GMT+8. These are smoke checks, not hardware performance benchmarks.
- An unfinished quiz survived the upgrade. All answers, the explanation and Continue
  were reachable and visible (Continue bounds `[379,449][987,507]` in a 1366×768 window).
- Initial emulator checks failed under concurrent build load: the Android system and
  launcher reported a GPU fence hang predating the installation, and the phone had
  a process-start timeout. Restarting the emulator host process restored normal
  startup. Logs are retained; this was not hidden as a passing first attempt.

Live verification after deployment: Android, ChromeOS and legacy manifests offer the
measured code-27 artifacts; Tala remains 0.4.4; unknown platforms return 400. The public
page loads both screenshots without horizontal overflow at desktop and phone widths.
Both aliases and versioned CDN URLs return the measured sizes and byte-range support;
the existing 0.4.26 URL remains unchanged. The standalone telemetry collector is active.

## Automatic builds

The user's Mac is registered as `hiraia-luis-mac` and starts the runner at login.
Trusted app/content pushes to `main` and `hiraia-unified` produce a signed Android +
ChromeOS pair; the workflow also supports manual dispatch. When the Mac is offline
or sleeping, work waits for it. Native jobs keep artifacts for seven days and never
publish automatically. Release signing inputs stay outside the disposable checkout;
a pre-job hook rejects PRs, forks and other workflows before checkout. Actions are
pinned to full commit SHAs. The first setup attempt failed on a duplicated pnpm
version setting; the workflow now uses `package.json`'s pinned pnpm 9.15.9.

First successful run: https://github.com/helloluis/hiraia/actions/runs/36646218435
Artifact `11068941631` contains both signed APKs and provenance (877,984,650-byte archive).

Final configuration verified: https://github.com/helloluis/hiraia/actions/runs/36648182032
Both builds passed with lower process priority, two Gradle workers and no persistent
Gradle daemon. Artifact `11069203468` contains both signed APKs and provenance
(959,754,204-byte archive). The temporary checkout's signing credentials were removed;
the runner finished online and idle. These verification builds do not replace the
immutable published pair listed above.

Provisioning and commands: `MULTIPLATFORM-RELEASES.md`.

## Limits

ChromeOS remains **Preview**. This validates an Android Desktop emulator and native
Intel QVAC, not a physical Chromebook's ARC environment, an AMD Chromebook, or school
management policy. The site says so and explains APK installation requirements.
No Google Cloud resources were created for this release.

Release logs, read-back publication receipts, installed-package hashes and screenshots
are retained under ignored `build/chromeos-20260929/` and `build/app-releases/`.
