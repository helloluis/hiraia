# Hiraia v0.4.15 — hands-on test release

Built 2026-09-19 from the unified branches, including the English/Filipino voice
updates, question cards, Fraunces branding, student Nearby and Metro build improvements.
This is a test release before evaluating v0.5.0.

## Artifact

- Android package: `com.hiraia.app`, version `0.4.15`, version code **15**.
- Download: https://assets.hiraia.org/models/hiraia-v0p4p15.apk
- Exact size: **433,311,038 bytes** (413 MiB rounded).
- SHA-256: `918e7b74a3ebaa305035c7779d2f54e61eb3c430fbd189455728bab5b2ec2a92`.
- MD5: `fc4eb430cb502198965172cf6cf64b9b`.
- Signing certificate SHA-256: `40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35`.
- Signed with the existing release key, preserving Android upgrade identity.

## Image and download fixes

The APK pins image manifest `c8379ff0126aa457`: 12,373 bundled illustrations plus
23,272 downloadable illustrations in 42 immutable packs. The exhaustive local audit
found zero missing required images for every grade from 3 through 10. All packs were
published and verified through the public CDN before this release.

The app now uses the verified `assets.hiraia.org/models` origin directly. Release
preflight caught a missing legacy VPS redirect for `vectors-labse-90318bad81dd.i8.bin`;
the route was added, checked with `nginx -t`, and verified at the origin. Cloudflare's
previous 404 could remain cached because the available purge token returned 401.
The APK's direct CDN URLs avoid that cached error. Existing model filenames and
integrity hashes are unchanged. An identical duplicate telemetry location was removed
from the tracked nginx template; the live change only added the vector redirect.

## Validation

- Previous unified/image-fix regression suite: 134 mobile tests and four Python image
  audit tests passed. No card, model or image content changed during versioning.
- Release preflight checked both voice hashes, all grade manifests, database/tokenizer
  freshness and complete image-pack coverage.
- Final Gradle release build passed in 48 seconds with a fresh Metro bundle.
- APK inventory verified all 12,373 bundled illustration SHA-256 values.
- Both ONNX files were read from the signed APK and matched their pinned EN/TL hashes.
- APK contains ARM64 libraries only and includes the Vulkan backend.
- Release signing certificate and embedded version/code verified.
- Mobile typecheck and website production build passed.
- All three model/vector CDN URLs returned HTTP 200 and exact expected sizes.

## Device checks

Upgrade an existing install without uninstalling, then check Settings version,
English/Filipino read-aloud, illustrations after grade download, offline card/quiz use,
and teacher/student Nearby sync with two physical phones. Native compilation does not
replace these device checks. No v0.5.0 tag is created by this release.

## Recovery

The previous public APK and image packs are retained. The VPS's previous source diff,
release metadata, built website and nginx configuration were backed up under
`/root/hiraia-release-backups/20260919-v0415/` before deployment. Original local worktrees
and the September 19 unification backups remain intact.
