# Hiraia v0.4.23

Release date: September 23, 2026. Built from `hiraia-unified` in the canonical checkout.
Tala remains v0.4.3 (build 18), with its existing APK and signing certificate unchanged.

## Student APK

- Package: `com.hiraia.app`; version 0.4.23; Android version code 23; non-debuggable.
- Signed APK: `packages/mobile/android/app/build/outputs/apk/release/hiraia-v0p4p23.apk`.
- Download: https://assets.hiraia.org/models/hiraia-v0p4p23.apk
- Bytes: 435193550 (415 MiB).
- SHA-256: `6fcf04362d8d8bddb2c935a5eb44e62894b3dcdc23f0202f375ade036058c2ea`.
- MD5: `ca44f1b9aa4cbf7ab84b55d8b5e01ba8`.
- Signing certificate SHA-256: `40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35`.

## Changes

Compatible image-pack and model updates download automatically, without a learning-update
banner or consent step. APK updates retain their user-requested download and Android
installation flow. A requested APK pauses an automatic model replacement.

Settings has separate AI and illustration download controls. The AI pause persists across
launches and covers LaBSE, fact vectors, first-time tutor weights, and updated weights.
Native transfers stop, keep partial bytes, and resume from the saved offset. Installed
models remain usable while paused; duplicate callers share the same transfer. The
existing image pause/resume preference remains in force. Automatic model replacements
retain the memory/storage eligibility gate and foreground retry lifecycle.

## Image delivery repair

The previous 42-pack publication placed the current files under `models/<filename>`,
but installed apps request `models/images/<filename>`. All 42 expected URLs returned 404
before this release. Published the same immutable files at the app's expected paths,
with R2 SHA-256 read-back verification and public HTTP 200 / byte-count checks for all
42 packs. This repairs image delivery for existing v0.4.22 installs too. Old objects were
preserved. No illustrations or card content changed in this release.

Asset catalog revision 3 is pinned to app build 23 and baseline `14d7c42699fd80bd`;
validated using the app's own `parseAssetCatalog`.

## Validation

- Required model regression gate: 45/45 passed, 111 card draws, GGUF LaBSE backend.
- Six update/download test cases passed, covering catalog compatibility, corrupt-file
  rejection, rollback, independent image updates, memory eligibility, automatic resume,
  manual pause across relaunch, byte-offset resume, cancellation and duplicate callers.
- Mobile and web TypeScript checks passed.
- Release Gradle build passed; forced fresh Metro bundle. Source-map contents matched all
  seven changed runtime files exactly, including the final pre-transfer cancellation check.
- APK art validation: all 12,149 bundled illustrations match their inventory and SHA-256.
- APK package/version/non-debuggable flag and pinned signing certificate verified.
- Public CDN checks: all 42 image packs and all three model/vector files return HTTP 200
  with expected sizes.
- Versioned APK and `hiraia.apk` alias uploaded to R2, SHA-256 verified by read-back,
  and public HEAD verified. Alias cache purge succeeded.
- No new hands-on phone test was performed for this release.
