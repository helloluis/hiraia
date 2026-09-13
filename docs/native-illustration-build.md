# Native Android illustration packaging

Implemented on `unified`, 2026-09-12. Android loads the existing bundled illustrations
from `asset:/illustrations/<slug>.png`. iOS retains the existing Metro image map.

## Measured build results

| Measurement | Previous | Native assets |
| --- | ---: | ---: |
| Metro bundle | 819.955 seconds | 10.916 seconds |
| Metro modules | 14,356 | 1,984 |
| Gradle release build | 14m 23s | 2m 37s |
| Unchanged illustration task | — | UP-TO-DATE (Gradle invocation: 4s) |

Gradle times exclude the build script's curriculum preflight checks. These measurements
are from local runs, not controlled benchmarks. The existing conservative bundle cleanup
remains enabled; no stale-bundle protection was removed to obtain these results.

## Build contract

- `src/generated/imageMap.ts` remains the generated source of truth for bundled selection.
  `scripts/gen-image-map.mjs` and the art-pack keep list are unchanged.
- `scripts/stage-bundled-art.mjs` validates the selection and PNG headers, preserves each
  image's actual dimensions, copies only changed bytes, and prunes only its owned output
  directory. It generates `bundledArt.generated.json` and a SHA-256 packaging manifest.
- `scripts/illustration-assets.gradle` registers a separate incremental task. It declares
  image files and the map as inputs, generated assets/inventory as outputs, and runs before
  codegen, JS bundling, and native asset merging. Direct Gradle builds use the same task.
- `plugins/withBundledIllustrations.js` registers the task in clean Expo/EAS prebuilds;
  `post-prebuild.mjs` also registers it in existing local Android trees.
- `src/generated/imageMap.android.ts` loads the small inventory and resolves native URIs,
  preserving dimensions, grade-suffix fallback, and absent-image handling.
- `scripts/verify-bundled-art.py` checks the actual APK for an exact image inventory and
  SHA-256 equality for every image, and rejects duplicated legacy Metro illustrations.
  `build-apk.sh` runs this verification before reporting success.

Build and sign with the existing commands:

```sh
bash packages/mobile/scripts/build-apk.sh
bash packages/mobile/scripts/sign-apk.sh
```

## Cloud and download compatibility

The bundled selection still contains exactly 12,373 images / 139,930,351 source bytes.
No image transcoding, first-launch extraction, or new downloads were introduced.
Downloaded illustrations retain priority over bundled images through the existing
`artSourceFor` / `artUri` registry. Image-pack selection, filenames, hashes, receipts,
cache directories, model URLs, and download integrity/resume behavior are unchanged.

SHA-256 snapshots confirmed no edits to `imageMap.ts`, `artPack.keep.json`,
`imagePacks.generated.json`, `images/installer.ts`, `images/format.ts`,
`engine/modelDownload.ts`, or `config/model.ts`.

The requested VPS upload uses a new versioned file. R2 objects, the mutable APK alias,
the production update manifest, and model/image-pack downloads are not modified.

## Validation

- Native staging tests: identical reruns perform no writes; equal-size edits with restored
  timestamps still update; stale selections are removed; invalid inputs fail before changes.
- Native resolver tests: original cropped dimensions, grade fallback, missing images, and
  compatibility with the downloaded-art registry.
- Existing image-installer and history-gesture tests passed. TypeScript passed.
- Existing release gate passed 45/45, including its retrieval preflights.
- Every illustration in both the unsigned and signed APK passed exact inventory/hash checks.
- Release source map contains `imageMap.android.ts` and zero illustration PNG modules.
- Production-signed APK installed and ran offline in a disposable Android emulator.
  Onboarding and feed illustrations rendered. A left-edge pull stopping before center
  stayed on the current card; crossing center restored the previous card and illustration.
- Signing certificate matches the existing pinned production certificate.

An existing `image-packs.test.mts` grade-coverage test fails for
`pufferfish-poison-no-cooking-g4: missing ffct-01503`. That test only consumes unchanged
pack files, the pack manifest/selection code, curriculum tags, and card index; it never
loads either image resolver. The pack round-trip/integrity tests passed. This independent
grade-to-pack coverage mismatch was not changed by the native packaging migration.

## Artifact

Version 0.3.2, Android versionCode 5. Signed APK: 311,424,306 bytes.

SHA-256: `11ad1da9c7a1907ab56e93fcebd60c5df671b5c1da8d254c49da3d774db0ef6d`

Local path: `packages/mobile/android/app/build/outputs/apk/release/hiraia-signed.apk`.
