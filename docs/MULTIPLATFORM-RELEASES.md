# Android + ChromeOS releases

The website renders a platform registry (`packages/web/src/config/platforms.ts`), with
an actual screenshot, requirements, install details and verification hashes per platform.
Windows is a planned entry, with no fictitious executable or download link. Published
release facts live separately in `platform-releases.json`; an unpublished platform has
no download and no offered in-app update. The existing Android 0.4.26 URL is unchanged.

`pnpm apk` is the canonical native build, at either the root or `packages/mobile`.
It builds and signs both platforms and records a complete manifest only after every
platform succeeds. Versions must match; native OTA fingerprints must differ. See
`packages/mobile/BUILD.md` for the local build and paired publishing commands.

## Automatic builds on trusted pushes

`.github/workflows/native-apps.yml` targets app/content changes on `main` and
`hiraia-unified`, and manual dispatch. It deliberately does not run pull request code
on the machine holding the signing key. It uses the same `pnpm apk` command, keeps
the APKs and provenance together for seven days, and does not publish to the website.

**Not activated yet:** the repository has no registered native runner. The existing
GitHub-hosted job only compiles JS/web; it cannot build and sign these native releases.
Host selection is still needed before enabling the workflow. Provision the runner:

1. Use a dedicated macOS ARM64 runner labelled `hiraia-native`, with Node 22, pnpm 9,
   Python 3.11+, JDK 17, Android SDK + NDK 29.0.14206865, and the same `llama-server`
   used for the local regression gate. Set `ANDROID_HOME` in the runner environment.
   Keep enough disk for the repository, QVAC native toolchain and two APKs per run.
2. Put the six ignored inputs listed in `deploy/restore-native-build-inputs.py` in a
   private directory **outside** the Actions checkout, preserving their relative paths.
   Keep the directory owner-only. Never place these credentials in an Actions artifact.
3. Set repository variable `HIRAIA_BUILD_INPUTS_DIR` to that directory and
   `HIRAIA_NATIVE_BUILDS=enabled`. Run one manual build before relying on push triggers.
4. Require the native job for release promotion. A red model gate, stale voice, wrong
   signing key, source change during the pair or missing ABI must stop the release.

The workflow is gated on the explicit repository variable so an unprovisioned host does
not leave every push waiting indefinitely for a nonexistent runner. Until it is enabled,
automatic per-push APK generation is **not** configured; local paired builds do work.

## Release boundary

The public 0.4.26 Android URL already contains different bytes from this development
build. It is immutable. Publishing the new pair requires a new app version/code and
the normal release authorization; never overwrite 0.4.26 or make up a ChromeOS URL.
The paired publisher writes the website candidate only after both uploads pass read-back
and public HEAD checks. Update `asset-updates.json` bounds with the actual new app code.

ChromeOS remains a preview. The tested desktop Android emulator and native x86 QVAC
probe are documented in `CHROMEOS-20260929.md`; school Chromebook/ARC deployment is
still unvalidated. [Google's testing guide](https://developers.google.com/chromeos/app-development/develop/deploying-apps)
explains the ADB installation limits, including managed devices.

## Verification record

- Website checked at 1440, 390 and 320 CSS pixels, including expanded checksums.
- Legacy Android, explicit Android, ChromeOS and Tala manifest routes remain separate.
- Guard tests cover missing platforms, wrong ABIs, changed bytes, version/runtime
  mismatch, source drift, failed regression and partial upload failures.
- Initial model gate: 44/45; the existing stochastic grade-register water-cycle case
  failed. The unmodified full rerun passed 45/45 (111 draws). The failed log is retained.
- The new post-build verifier initially missed the local JDK environment after signing.
  Fixed its JDK discovery; the subsequent full paired run passed another 45/45 gate
  and produced `build/app-releases/20260929T143219Z/release.json`.
- Final pair: Android 437,250,921 bytes, SHA-256
  `8cf66153b20dbbb0e1d508cf444515bf1e3b368f1674043b3856afc9df77b158`;
  ChromeOS 522,058,276 bytes, SHA-256
  `1c40d2a282b566e501e5283e01c0b67634b590dcdb3ac85c47b94624d569fb41`.
  Both are development builds at 0.4.26/code 26, signed with the established release key.
  They are **not** the public Android 0.4.26 artifact and must not overwrite it.
- Both contain identical Hermes app code, with distinct native fingerprints:
  Android `cb431b6a516d1f6f2ad35eff6736f9bfe9ccf03e`,
  ChromeOS `d8c3d7055f94793cb57fd96260b4d776d193b9aa`.
  All 129 native libraries match the earlier native-Intel-tested ChromeOS build.
- Installed APKs on `emulator-5586` (phone) and `emulator-5584` (desktop) were hashed
  on-device and match the final pair exactly (`paired-installed.json`). The two website
  screenshots are unedited ADB captures from those packages using Guest profiles;
  their image/APK hashes are recorded in `download-screenshot-provenance.json`.
- Final desktop offline QVAC: model loaded and semantic/generation ready at 22:44:57
  GMT+8; CPU warm-up completed at 22:45:19 (21.708 s, 23 prompt tokens). The first
  semantic startup took 75.713 s while the Activity was briefly backgrounded during
  keyboard dismissal; this is a functional check, not a reliable performance benchmark.
- Production Next build and TypeScript pass. The inherited ESLint config reports missing
  type-aware parser setup; lint has not passed and has not been disabled.

Build logs, artifact hashes, final screenshots and current installed-build details are
retained under ignored `build/app-releases/` and `build/chromeos-20260929/`.
