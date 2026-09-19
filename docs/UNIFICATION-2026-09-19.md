# Branch and worktree unification — 2026-09-19

## Integration target

Use `hiraia-unified` as the integration branch and `main` as its final destination.
The new integration checkout is `/Users/luis/Code/hiraia-integration-20260919`.
The pre-existing `/Users/luis/Code/hiraia-unified` directory is still on
`student-tala-nearby`: directory names are not branch names. Do not keep building
new releases from an old checkout just because its directory is named “unified”.

This integration does not change the public release label, publish an APK, deploy
servers, restart training/audits, or create a v0.5.0 tag. The app and existing web
APK manifest remain at 0.4.14. A candidate release needs a new monotonic Android
versionCode and newly measured APK hashes before publication.

## Preserved inputs

| Input | Saved checkpoint | Integrated content |
|---|---|---|
| student-tala-nearby / quiz-retranslation | `d5e254107` | Current mobile runtime, audited questions, EN/TL voice pins, student Nearby, camera and telemetry changes |
| question-cards | `95758abbe` | Website, Fraunces wordmark/glyph, Tala teacher 0.7.4, report service, audit and voice-training tools |
| unified / buildmd-reality | `e3328df98` | Build documentation and corrected retrieval-vector pin |
| main-telemetry | `94603e90f` (snapshot), `15c5dd837` (main checkpoint) | Pilot dashboard, ingestion, mirror and CDN tooling |
| origin/main | `ed91f957a` | Published main history, retaining the newer 0.4.14 download metadata |

All original local branch tips were already ancestors after these merges; older
card-ui, loading-window, TTS and release changes are included through their history.
The final integration also retains the native asset staging, shrinking, ARM64-only
packaging, Vulkan inclusion checks and incremental Gradle build behavior.

Before integration, every original branch received a `safety/2026-09-19/<branch>`
reference. Working patches, index patches, selected source archives, branch hashes
and untracked-file inventories are in
`/Users/luis/Code/hiraia-integration-backups/2026-09-19/`.
Original worktrees are retained. Large ignored training corpora, audit run records,
checkpoints and experimental untracked outputs remain in those original directories;
they were not swept into Git or deleted. Older dirty experimental worktrees are
preserved as patches and working files, not overlaid onto the newer app runtime.
Do not remove those directories as “cleanup” without reviewing their inventory.

## Conflict decisions and build corrections

- Preserve the student branch's exact question bank, card pool, fact bank and voice
  metadata. Preserve newer shared/node exports, demo retrieval behavior, stable card
  IDs and card-pipeline paths instead of reverting to older versions.
- Keep the newer website Fraunces branding, feedback delivery, geo metrics and
  public APK metadata. Retain the app's Android 10 / optional local-model behavior
  in download copy and FAQ. Historical capability outputs remain recoverable in
  their source snapshots; the combined tree keeps the question branch's fuller run.
- Combine the pilot dashboard and Tala reports under the existing authenticated
  admin service; install scripts now include both sets of modules.
- Track the student native Nearby module source even though generated top-level
  Android trees remain ignored. Keep its build outputs ignored.
- `pnpm apk` now loads the existing Metro static directory cache only into release
  build processes. It retains caller NODE_OPTIONS, forces fresh JS output and keeps
  native caches. Development watchers must not use the static cache.
- Release preflight checks the actual EN/TL ONNX SHA-256 against each voice.json.
  Matching weights are staged in this integration checkout and separately backed up.
  EN: `b9b22875c9833bf48189dfe5455d93992a5afa9269c3993b7582f2a48c59c533`.
  TL: `28d68857286c77cf5649ff8c3e86426a336cc8783ee7bda3b7d824ca57591d14`.
  Git alone does not contain these ignored weights; see `packages/mobile/BUILD.md`.
- Regenerate cards.db / tokens.bin from the merged inputs and record their matching
  resident-index database hash. The builder now also writes the tokenizer freshness
  marker required by the release wrapper, so a fresh worktree needs no manual marker.
- Telemetry tests now resolve the mobile source in their own checkout, not a sibling
  worktree. Their legacy-event assertion includes the newer unique-card metric.
- Keep the 33 published image-pack references and verified local copies. Generating
  packs from the current shard inventory produces different unpublished names;
  those generated references were not adopted.

## Validation and remaining release checks

- Frozen offline dependency install succeeded with Node 22 / pnpm 9.15.9.
- Mobile, web and shared TypeScript checks passed.
- Website production build passed (all 16 pages/routes generated).
- Mobile regression suite: 133/134 passed after restoring local build inputs;
  the sole remaining failure is the pre-existing grade image-pack selection case
  below. The total includes the new voice preflight test.
- Telemetry tests: all 19 passed after updating the stale legacy-count assertion.
  The standalone HTTP ingestion / retry-deduplication smoke test also passed. Metro's cache equivalence test
  verifies unchanged hashes, scales, files and platform selection while sharing
  directory listings.
- Pilot/dashboard Python: 21 passed. Tala report Python: 7 passed, 2 skipped
  because their optional environment dependencies are unavailable.
- Android prebuild succeeds from the new checkout. All six managed Gradle properties
  pass their idempotence check. Native module sources are discovered by autolinking.
- Release APK build succeeded from a fresh Android tree in **3m 56s**; Metro
  bundled 2,051 modules in **11.18 seconds**. The APK verifies 12,373 illustrations
  against the exact inventory and hashes, contains both pinned ONNX models, and
  contains only ARM64 native libraries. Vulkan presence also passed.
  `packages/mobile/android/app/build/outputs/apk/release/app-release.apk` is
  **432,145,827 bytes**, SHA-256
  `22660e8871c1ee900d445a2c8ee17cea5d1624b9428062b41c338a848dffea35`.
  This local build uses Expo's debug signing configuration despite the release
  build variant; it is a verification artifact, not a production-signed update.
  Use the established release signing process before any distribution.

Known pre-existing issue: `image-packs.test.mts` reports
`pufferfish-poison-no-cooking-g4: missing ffct-01503` in the grade-selected downloads.
This exact failure was reproduced in the original student-nearby checkout. All 33
published pack files pass their content hashes and round-trip tests; the defect is
which packs are selected for a grade. Resolve selection/manifest coverage and publish
any changed packs before calling the release fully validated. Do not silence the test.

Still requires physical-device evaluation: read-aloud quality and continuity for
both voices, student/teacher Nearby sync with two phones, permission flows, offline
behavior, and an upgrade from the deployed APK. Host/native compilation cannot
certify classroom connectivity or voice quality. No v0.5.0 tag is justified by the
merge alone.
