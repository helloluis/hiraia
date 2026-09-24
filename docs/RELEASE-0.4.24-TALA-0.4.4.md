# Hiraia v0.4.24 and Tala v0.4.4

Built and published September 24, 2026 from `hiraia-unified` (release commit `13d489287`).
Server side deployed first (telemetry collector, then the web app); neither APK has been
tested on a physical phone pair.

## Student APK

- Package: `com.hiraia.app`; version 0.4.24; Android version code 24; non-debuggable.
- Signed APK: `packages/mobile/android/app/build/outputs/apk/release/hiraia-v0p4p24.apk`.
- Download: https://assets.hiraia.org/models/hiraia-v0p4p24.apk (and the `hiraia.apk` alias, purged).
- Bytes: 437168945 (417 MiB).
- SHA-256: `653caede387177bbdb1a56383f2a0e70170750e152afd20f81c268ff034de12a`.
- MD5: `f505f688ed77c5fb49ac3b7f3bdb8c0d`.
- Signing certificate SHA-256: `40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35`.
- OTA runtime (fingerprint): `986ad1df7cad9e576e09954665d858e6776aff5a`.
- OTA code-signing certificate: `packages/mobile/certs/certificate.pem` (CN=Hiraia, valid to
  2046-09-24, SHA-256 `3E:48:E4:FA:…:FD:60:96:DA`). Private key: `~/.hiraia/ota-keys/` only.

## Tala APK

- Package: `com.hiraia.tala`; version 0.4.4; Android version code 19; non-debuggable.
- APK: `packages/tala/android/app/build/outputs/apk/release/app-release.apk` (copy:
  `/tmp/release-0424/tala-v0p4p4.apk`).
- Download: https://assets.hiraia.org/models/tala-v0p4p4.apk
- Bytes: 15578868.
- SHA-256: `dd78002292a3363d4aea16f690450ce139b55f8768c9f09842ea55e039023d64`.
- MD5: `64f7c47092a49878d4018bf357f8c8c3`.
- Signing certificate SHA-256: `50dcc69a6eb8ad94354de148087d28919be757eafcd4d304512a5db35f1703ae`
  (the established pilot key).

## Changes

**Classes are per student, not per phone.** Each profile on a shared phone (Guest included)
joins, syncs to, and leaves its own class. A sync sends a teacher only the names and activity
of that class's students. Phones on 0.4.23 must re-join: the old phone-wide class is dropped
on upgrade, each student sees a notice to scan again, delivered events are remembered per
class (no resend on re-joining the same class), and the old class is told which students left
(delivered to a Tala 0.4.4 of that class within 30 days). History with no known owner
(pre-0.4.15 rows) is no longer sent to any class.

**Tala 0.4.4** advertises a short class hint so phones skip other classes' teachers without
connecting, returns the class name to the phone, records students who left, and adds
**Remove from class**. It also carries the by-day, subcategory student page (card catalog of
49,262 cards / 25,963 quiz facts, append-only, build-guarded).

**Over-the-air updates.** 0.4.24 is the first build that can receive signed JS updates from
`https://hiraia.org/api/updates/manifest`: checked automatically on Wi-Fi only, applied at the
next launch, never downloading on mobile data by itself. Fixes that change only JS no longer
need the full APK.

**Fixes found on the way:** class name lost after a restart; a phantom Guest tile on the
teacher's roster from every launch; overflow reports filed under Guest; a stuck typed-code
attempt; telemetry writes dropped when two database writers met at startup.

## Release order (required)

The server side first — see `packages/mobile/BUILD.md` → "Release order". The web deploy and
the separately deployed telemetry collector must accept `ota_update_id` before any 0.4.24
phone or Tala 0.4.4 syncs, test devices included. Asset catalog revision 4 (min 23, max 24,
baseline `14d7c42699fd80bd`) is staged in `packages/web/src/config/asset-updates.json` and was
validated with the app's own `parseAssetCatalog` (22 rejected, 23 and 24 accepted).

## Validation

- Regression gate: GREEN, 45/45, 111 card draws, GGUF LaBSE backend — re-run on the exact tree that built the APK.
- Student: `qa:tala` 44/44 (session engine + classroom simulation); telemetry store 37/37 on
  real SQLite (0.4.23 migration, rollback-safe inserts, lock-retry); profiles/activity 8/8;
  server validator 13/13; mobile and web TypeScript clean.
- Tala: JVM 17/17; instrumented 35/35 on an emulator.
- OTA: relay 14/14; publisher 26/26; a manifest signed with the real key verified against the
  shipped certificate.
- Adversarial review: 16 confirmed findings (0 high), all fixed with regression tests and
  independently re-verified.
- Build: `createReleaseUpdatesResources` ran fresh; APK fingerprint equals the tree's; updates
  enabled, Wi-Fi only, launch wait 0; all 12,149 bundled illustrations verified by SHA-256.
- QVAC worker: code byte-identical to 0.4.23 (only the embedded `package.json` differs,
  which is why its bundle id changed).
- Emulator upgrade test (signed 0.4.23 → 0.4.24, offline, real app databases): no crash;
  embedded update launched; no profile inherited the old class; delivered ids kept per class;
  leave notices written for both students and the Guest; the re-join notice shown per student.
- **Not tested:** Nearby sync between a real phone and a real Tala (emulators have no radios),
  against both Tala 0.4.3 and 0.4.4; an OTA end to end (needs the server side live).
