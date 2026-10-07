# Hiraia 0.4.40 — local provisioning release

Activated and verified **7 October 2026, 17:10 GMT+8** on the operator's Mac.
The local server offers Hiraia **0.4.40 / code 40** and Hiraia Setup **0.4.4 / code 9**.
All **98 existing registrations** and their server identity are preserved.
The branch is `codex/cebuano-curriculum-alignment-20261007`. Nothing was merged to
`main`, uploaded to the public release bucket or offered through the public website.

## Verified artifacts

[Three-platform CI run 37592641964](https://github.com/helloluis/hiraia/actions/runs/37592641964)
passed at app commit `7f1cf99d353eb6a741096733fa8ba630a183b20b`.
Android, ChromeOS and Windows all come from that same commit. The subsequent
provisioner-only discovery correction leaves these app artifacts unchanged.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Android ARM64 | 284,353,550 | `3a97bfffa0da6b56ce301db6d03a01f6bd5a5878e3ffa02a28e230328327ea91` |
| ChromeOS ARM64/x86-64 | 369,160,905 | `ef0d511cec6336be479be2e695a9b4d46c2c3d58c4b80d44297c57c027cf55a5` |
| Windows x64 portable ZIP, unsigned | 571,415,215 | `191009899c407dc767c1447fbfdc3ef43b7eb1080cd5fc5514f10199823f4570` |
| Hiraia Setup 0.4.4 | 266,349 | `8e98b926ceb58cbd8c2fa8c6586db193b3d11fcac76df2e93dbb98237537e629` |

Hiraia APK certificate SHA-256:
`40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35`.
Setup certificate SHA-256:
`321aad0ae3ee615ba30aa7ba514be6f1f7bcdb2c4aaec1dc9aa8d02dba304fed`.
Both retain their established upgrade signing identity.

Android runtime: `79565cf5829adbaf395862248e5039d5ce813311`.
ChromeOS runtime: `f2c31c028f6ac777cbe47792fb1095010e693d64`.
Their shared Hermes bundle SHA-256 is
`b9ddf4d4d6fe36642913c86283007dc1d4466d970297071f4490fcfd4f1e1f6c`.

## Validation

- Formal model regression: **45/45 cases**, 185 generated answers, before native builds.
- CI platform, input, exam, content and TypeScript gates passed; both signed APKs
  were measured again locally. Their embedded databases are identical and all
  **49,155 card rows** and **25,751 questions** match the reviewed source. The bank
  contains 53,022 grounding facts; `dcard-09952` remains retired.
- The downloaded Windows ZIP matches its manifest hash. Packaged Windows tests
  passed the 12-question exam, restart/resume, saved history, keyboard, zoom,
  carousel, out-of-order answers and screen-reader checks. Native CPU inference
  and 768-dimensional embeddings passed; both English and Tagalog voices produced audio.
- Provisioner regression after the discovery fix: **142 tests passed**, including
  10 focused native-discovery tests. Actual macOS registration, resolution and
  cleanup also passed. Final live checks passed TLS/authentication, private UI
  boundaries, LAN access and HEAD/range delivery for all 64 mirrored assets.
- The isolated Android rehearsal upgraded released Hiraia 0.4.24 and Setup 0.4.3,
  including automatic recovery from a local HTTP 503 and an unavailable server at
  boot. Internet was blocked during the upgrade; app data and registration survived.
  This used the preparation APKs. The final CI APKs were separately signed/content
  verified as above; a physical JP1 has not been tested in this release session.

Content scope and preserved holds are documented in
[Cebuano curriculum alignment](CEBUANO-CURRICULUM-ALIGNMENT-20261007.md).
Earlier preparation measurements and failure records remain in
[the preparation record](RELEASE-0.4.40-PREPARATION.md).

## Discovery correction and runner approval

The first CI attempt stopped before checkout because the signing runner rejected
the feature branch. After explicit user approval, a tested, owner-only exception
admitted only this exact commit and manual workflow. It was removed after the Mac
signing job passed; another branch dispatch is rejected without a new approval.

Initial activation served files correctly, but its Python raw-socket mDNS
announcement did not resolve through either the native or independent Python
client on this Mac. A native macOS publisher resolved immediately. The exact
lower-level multicast cause was not established. The server now uses Apple's
DNS-SD API on macOS, registering an explicit IPv4 record and service on the
provisioning interface. Both daemon acknowledgments are required before startup
completes. Closing the shared connection withdraws both records; losing the daemon
connection exits the service so its LaunchAgent restarts it. Other hosts retain
Zeroconf. The original TLS-derived service identity is unchanged.

The first native integration check caught an incorrect library path before any
service replacement. The corrected binding uses `libSystem.B.dylib`, the same
library used by `/usr/bin/dns-sd`. The failed check and corrected real integration
are retained; the service was replaced only after all 142 tests passed.

## Local operation

Dashboard: <http://127.0.0.1:8080/> on the Mac. The verified LAN address is
**192.168.68.66**, with HTTP 8080 and pinned HTTPS 8443. mDNS discovery resolves the
existing service identity to that address, allowing registered phones to recover
from the old saved laptop address. The dashboard and enrollment secrets remain
restricted to loopback access.

Active immutable service snapshot:
`~/.hiraia/provisioner/releases/0.4.40-e3950be7c721791d`.
LaunchAgent: `~/Library/LaunchAgents/com.hiraia.provisioner.plist`.
It is configured to start at login, restart after failure and prevent idle sleep.
Keep the Mac **powered, logged in, lid open and on the same Wi-Fi as the phones**.
Operation and stop/start commands: [provisioner runbook](../packages/provisioner/README.md#persistent-mac-service).

Old Setup 0.4.3 phones first follow their existing two-hour check-in schedule,
subject to Android scheduling. **Check for an update** in Hiraia Setup triggers
contact sooner. They receive Setup 0.4.4 first, then the local Hiraia 0.4.40 APK.
After that first update, subsequent boots schedule an immediate check-in. No reset
or new enrollment is required.

The complete local mirror contains **64 files / 1,072,293,365 bytes**: 61 image
packs, LaBSE, current search vectors and downloadable Tagalog voice. English voice
is bundled. Hiraia fetches optional content after the app opens; installation alone
does not mean content has finished downloading. Startup refuses an incomplete
required mirror. The optional large tutor model is not needed by the 98 registered
JP1s with 3.67 GiB RAM. Current vectors are available locally but have not been
published for a general Internet release.

Local evidence is retained under `build/provisioning-0.4.40/`, including the CI
manifests, actual APK content verification, Windows report, service activation
002, live verification 002 and mDNS verification 002. No test device was added to
the production registry.
