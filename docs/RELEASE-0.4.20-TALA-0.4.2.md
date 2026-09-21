# Hiraia v0.4.20 and Tala v0.4.2

Release date: September 21, 2026. Built from the canonical `hiraia-unified`
checkout, preserving the consolidated mobile, voice, Nearby and Metro work.

| | Hiraia | Tala |
|---|---|---|
| Package | `com.hiraia.app` | `com.hiraia.tala` |
| Display version | 0.4.20 | 0.4.2 |
| Android version code | 20 | 17 |
| Bytes | 435244910 | 15087602 |
| URL | https://assets.hiraia.org/models/hiraia-v0p4p20.apk | https://assets.hiraia.org/models/tala-v0p4p2.apk |
| SHA-256 | `f06c4a5cf41482dd7572cd6dc484af9dfe6fb87ded920cbea99be2c99d02f196` | `745462eec48585978171108e8454fe7ebe8bf6c9ee1f0d5e1ed7cc59c751988a` |
| MD5 | `2a4d573aded85bb78104581922b32ae9` | `ad2ac74bf5d913031bf9f19bc6ae06ad` |
| Signing certificate SHA-256 | `40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35` | `50dcc69a6eb8ad94354de148087d28919be757eafcd4d304512a5db35f1703ae` |

## Changes

- Both apps display their installed APK version and build number in Settings.
- Hiraia identifies its content as Hiraiapedia v1.5 and reports the bundled database
  revision alongside its app version in newly recorded activity.
- Tala preserves student app/content versions when relaying activity and reports
  its own version separately as the uploader. The receiving telemetry collector
  and admin dashboard were deployed before this release (`c61824cf4`).
- Hiraia includes the consolidated LaBSE-first, curriculum, startup, audio and
  audited Cebuano card changes carried by the latest locally tested v0.4.19 build.
- Homepage download cards and update manifests use these exact APK versions,
  byte counts and digests. Existing download analytics counters are unchanged.

Both APKs retain their existing signing identities. Tala is a non-debuggable
release variant signed with its established pilot Android Debug certificate;
changing that key would prevent upgrades of existing pilot installations.

## Validation

- Formal local regression gate: 45/45 cases passed, 111 card draws; gate green.
- Hiraia built with the normal release wrapper and a fresh Metro bundle.
- Content, grade coverage, image-pack and voice checks passed; all 12,373 APK
  illustrations matched the exact inventory and SHA-256 values.
- Embedded cards.db matches the current audited database:
  `eaacc6f34090306759129f7d5db5e68287b06854a8aadb5fcc36fd2b079255cd`.
- Both APK package IDs, display versions, build codes and signing identities checked.
- Website TypeScript check passed. Deployment also requires a production website
  build and verification of both public update manifests against the signed files.
- The feature-equivalent Settings-enabled Hiraia v0.4.19 APK was manually installed
  successfully on the Redmi before this release; these newly numbered APKs have
  not been installed on physical phones as part of publication.

## Publication and recovery

Versioned APKs are stored in Cloudflare R2. The VPS serves the website and update
manifests; legacy APK URLs redirect to Cloudflare. The publisher reads uploaded
objects back and verifies their hashes. Previous immutable APKs remain available.

The pre-release VPS source revision, both download configuration files and compiled
website are backed up under
`/root/hiraia-release-backups/20260921-v0420-tala042/`.

The website-only release is based on current `main`; the complete app source stays
on `hiraia-unified`. This release does not merge unrelated mobile work into `main`.
