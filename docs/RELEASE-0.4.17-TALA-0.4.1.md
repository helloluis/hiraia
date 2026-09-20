# Hiraia v0.4.17 and Tala v0.4.1

Release date: September 20, 2026. Source: `hiraia-unified`, including the update
system in `b063aeccb` and the existing unified voice, Metro, branding and Nearby fixes.

## Artifacts

| | Hiraia | Tala |
|---|---|---|
| Package | `com.hiraia.app` | `com.hiraia.tala` |
| Display version | 0.4.17 | 0.4.1 |
| Android version code | 17 | 16 |
| Bytes | 433,347,902 | 15,067,122 |
| URL | https://assets.hiraia.org/models/hiraia-v0p4p17.apk | https://assets.hiraia.org/models/tala-v0p4p1.apk |
| SHA-256 | `5a2b78d9c338f31c39ad9cfbd1cb4b1e1555e8502393ccb53093828bd1cae83e` | `6eb2cf1a596d17bc5be303ad11af505c06e6d8248ee5bae8d2688f1be9de0db7` |
| MD5 | `89a85314e02be5752e8b52938644d3a8` | `4780127bf27bda7d9a949583df656f60` |
| Signing certificate SHA-256 | `40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35` | `50dcc69a6eb8ad94354de148087d28919be757eafcd4d304512a5db35f1703ae` |

Tala's display version was deliberately renumbered from 0.7.5 to 0.4.1 at the
user's request. Its version code increases from 15 to 16. Both APKs retain their
existing signing identities and can update existing compatible installations
without uninstalling. Tala uses a non-debuggable release variant, signed with
the same Android Debug certificate used by its existing pilot installations;
this is continuity of the pilot signing key, not a migration to Hiraia's release key.
Earlier `hiraia-tala-v0p4p1-*-debug.apk` files are preserved at their original URLs.

## Changes

- Both apps check for APK releases and offer verified, user-confirmed installation.
- Hiraia can separately offer compatible tutor weights and corrected illustration
  packs, with download verification, interrupted-download recovery and model rollback.
- The initial asset catalog is empty and targets Hiraia version code 17. This release
  does not claim to include newly trained weights or newly corrected illustrations.
- The homepage adds Tala beneath the CPT-methodology paragraph using the existing
  download-card design, a teal title bar and a gold `NEW!` starburst.
- The download section explains that Hiraia and Tala need separate phones because
  Nearby cannot transfer student activity between both apps on one device.
- Each APK's homepage link and update manifest share the measured release metadata.

## Validation

- Formal card-writer gate: 45/45 cases, 111 draws; retrieval gates also passed.
- Updater, image-install recovery, Nearby and voice suite: 27 tests passed.
- Mobile typecheck and final website production build passed.
- Fresh Metro bundle; exact inventory and SHA-256 checks for 12,373 APK illustrations.
- Signed Hiraia APK contains ARM64 libraries and the Vulkan backend. Both embedded
  English/Filipino ONNX hashes match their tracked pins.
- Both signed APK package IDs, version names, version codes and certificates checked.
- Tala updater's Android emulator tests passed during implementation.
- Homepage checked in Chromium at 1280px and 390px: no horizontal overflow or
  uncaught browser exceptions; correct Tala link and separate-phone guidance.

Publication uses the existing Cloudflare R2 publisher with full object read-back
hashing and public size/range checks. The website runs on the VPS and serves
`/api/app/manifest` for Hiraia and `?app=tala` for Tala.

## Recovery and device checks

The previous VPS source revision, download metadata and compiled website were
saved under `/root/hiraia-release-backups/20260920-v0417-tala041/` before deployment.
Prior versioned APKs and downloaded model/image files remain available.

Upgrade existing phones without uninstalling. Confirm classroom records remain,
exercise student-to-teacher sync on two physical phones, and check English/Filipino
read-aloud. Emulator and build checks do not replace a two-phone radio test.

Future asset publishing instructions: [APP-AND-ASSET-UPDATES.md](APP-AND-ASSET-UPDATES.md).
