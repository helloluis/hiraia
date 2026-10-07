# Hiraia 0.4.40 — release and local provisioning preparation

Recorded 7 October 2026, GMT+8. Branch: `codex/cebuano-curriculum-alignment-20261007`.

**Local preparation is verified. On 7 October at 15:41 GMT+8, the user authorized
committing/pushing this branch, running Windows CI, and activating the local server
after validation. Production activation is pending that CI build. The production
provisioning LaunchAgent is staged, not running. Public release publication is
outside this activation.**

## Content and native builds

This candidate includes the completed [Cebuano curriculum alignment](CEBUANO-CURRICULUM-ALIGNMENT-20261007.md),
keeps the audited English/Filipino curriculum, and sets student versionName 0.4.40 /
versionCode 40. The asset catalog is revision 9, limited to code 40. All 61 image pack
identities remain unchanged. Shared model metadata now lives in
`packages/mobile/src/config/modelAssets.json`, consumed by the app and mirror.

The canonical `pnpm apk` pair completed successfully. Formal regression passed
45/45 cases with 185 generated answers. Exam and native artifact gates passed.
The first attempt stopped on stale generated database timestamps; canonical
regeneration and full pool/database verification passed before the second build.
No freshness guard was bypassed.

Local build manifest: `build/app-releases/0.4.40-20261007-002/release.json`.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Android ARM64 | 282,162,190 | `6c0d1232bbe51c723071f006db11f19b3775de09e32180ea3fb95f61d232f72e` |
| ChromeOS ARM64/x86-64 | 366,969,545 | `e20173a567a45c9dfca30386b0cd4fab25ef436ac5411d0b1a33da2c1ffa7454` |
| Hiraia Setup 0.4.4 (9) | 266,349 | `8e98b926ceb58cbd8c2fa8c6586db193b3d11fcac76df2e93dbb98237537e629` |

Both Hiraia artifacts retain certificate SHA-256
`40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35`.
Setup retains certificate SHA-256
`321aad0ae3ee615ba30aa7ba514be6f1f7bcdb2c4aaec1dc9aa8d02dba304fed`.
Windows has not been packaged or tested for this candidate. The local APKs are
pre-commit candidates; do not pair them with unrelated CI Windows evidence.

## Existing fleet and mirror

The existing server identity and registry were backed up with an integrity-checked
SQLite backup before work. All 98 existing registrations are retained. Their last
recorded Setup version is 0.4.3 (8); the registry does not establish their installed
Hiraia versions. The 98 registered JP1 devices report 3.67 GiB RAM, so their complete
mirror does not require the large optional tutor model.

The required mirror is complete: **64 files / 1,072,293,365 bytes**, consisting of
61 image packs, LaBSE, current search vectors and downloadable Tagalog voice.
Every file was checked against the app's size and MD5 pins; restoration also
checked source SHA-256. Twenty-one files were added from verified local sources,
with zero network downloads. Existing mirror files were preserved. English voice
is bundled in the APK. Assets for larger-memory phones require `--with-llm`.

The 0.4.40 vectors have not been published publicly. They are present under the
exact current filename in the local mirror. A general Internet release must also
publish and verify that asset before updating public release pointers.

## Provisioning fixes and verification

Setup 0.4.3 swallowed transient download failures after provisioning, causing a busy
server's HTTP 503 to defer another attempt to the normal two-hour check-in. Setup
0.4.4 returns retry status to JobScheduler, handles boot check-ins, and bounds
unreachable-server retries to a 15-minute window. A newly authenticated update
offer renews that window. The server can require Setup versionCode 9 before offering
the larger Hiraia APK, so an old Setup installation receives its own fix first.

The server reads the app's shared model metadata and downloadable voice inventory.
`--require-complete-mirror` rejects missing or corrupt required assets before serving.

Validation evidence is under `build/provisioning-0.4.40/`:

- 125 server tests: 123 passed; the two real-APK cases initially skipped without
  JAVA_HOME, then both passed with JDK 17 against the actual signed APKs.
- Setup JVM suite: 25 cases, 23 passed, two optional local-artifact cases skipped.
  The release APK's actual certificate and manifest were checked separately.
- Four service activation cases plus the three existing all-platform guard cases
  passed. Missing Windows evidence, a different APK, or incomplete exam/voice
  validation prevents activation.
- 38 app delivery tests and mobile TypeScript checks passed.
- Isolated Android 14 emulator with released Hiraia 0.4.24 and Setup 0.4.3:
  Setup updated itself to 0.4.4, received an injected local HTTP 503, retried
  automatically after the slot was released, and silently installed Hiraia 0.4.40.
  Internet traffic was blocked during this upgrade. Sentinel app data and the
  registered device identity survived; managed restrictions point to the local
  content mirror.
- Actual reboot check-ins passed. With the disposable server temporarily unavailable
  at boot, Setup established its retry window and recovered automatically when
  the server returned. The emulator resets Wi-Fi at boot, so attempts to use
  persisted disabled Wi-Fi were invalid test setups, not proof of that condition.
  Another initial test sampled before the app received BOOT_COMPLETED; the corrected
  test waits for the app's actual retry window. These diagnoses are retained.

The first Setup test run failed because four original APK signer fixtures had been
omitted by an ignore-aware import. The fixtures were restored byte-for-byte and
explicitly unignored; the corrected build passed. No failing test was removed.

No physical phone has been attached for this preparation. The emulator proves the
upgrade mechanism; fleet Wi-Fi, vendor scheduling and battery behavior still need
observation on the actual JP1s.

## Activation and operation

Use the [provisioner runbook](../packages/provisioner/README.md#persistent-mac-service).
The installer stages immutable source/config/APK snapshots and a LaunchAgent under
`~/.hiraia/provisioner/`. It preserves `~/.hiraia/provisioning` and the sibling issued
ID log. Production ports are HTTP 8080 and pinned TLS 8443. The local-only dashboard
is <http://127.0.0.1:8080/>. The current Mac LAN address is 192.168.68.66; the existing
TLS key and mDNS service allow registered phones to discover an address change.

Before activation, commit/push the reviewed branch with user authorization and run
`.github/workflows/native-apps.yml`. Require its complete three-platform manifest,
including packaged Windows exam/history/keyboard/accessibility, native CPU and voice
checks. Activate using that exact CI APK pair and matching combined manifest.
Do not claim a running fleet update from the staged candidate alone.

Keep the Mac powered, logged in, awake with its lid open, and on the same Wi-Fi as
the phones. Existing Setup 0.4.3 phones need their first old-style check-in, normally
within two hours subject to Android scheduling. **Check for an update** in Hiraia
Setup triggers that first contact sooner. Once Setup 0.4.4 arrives, subsequent boots
schedule a check-in immediately. No phone reset or new enrollment is required.

The silent APK update and content readiness are separate: Hiraia fetches its optional
content after the app opens. The complete mirror keeps those downloads local while
the Mac is reachable. Its existing Internet fallback remains useful away from the
provisioning network.
