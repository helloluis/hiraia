# Hiraia 0.4.26 (versionCode 26), released 2026-09-28

Content downloads that finish on their own. No model, card or UI-flow changes.

- Download: https://assets.hiraia.org/models/hiraia-v0p4p26.apk (and the `hiraia.apk` alias, purged)
- 437,205,865 bytes · SHA-256 `aca9790d44893e1b3361d14575c16db26bef7f50684514847f4b30e7e4aa8b28`
  · MD5 `c8cc2a1ca611c083171147c839754b46`
- Signed with the pinned release certificate `40d750d5…0c35`
- OTA runtime changes (a new native module), so phones on 0.4.24 update through the in-app APK
  ribbon, not over the air.

## What changed since 0.4.24

- **LaBSE search files** (~500 MB) are fetched from launch, before any profile, and retried at
  1, 2, 4, 8 and then every 10 minutes until they land. Before, one failed attempt left a phone on
  keyword search until Hiraia restarted. Settings show whether search is ready.
- **A returning network resumes downloads** within seconds, from the byte they stopped at, through
  a native connectivity event.
- **Illustration packs offline** rest between attempts (60 s doubling to 30 min) instead of trying
  every pack in turn; a broken pack cannot hold up the rest.
- A language switch no longer waits behind a LaBSE download; a load failure no longer reloads
  ~384 MB on every nudge.
- From 0.4.25 (donated phones only): a device owner can point Hiraia at a LAN mirror. Every file is
  still checked against the size and MD5 built into the APK.

## Checks

- Regression gate green; `qa:semantic` 36, `qa:mirror` 30, `qa:images` 8, `tsc` clean.
- Emulator (API 34, dead mirror): LaBSE cut at 358/384 MB resumed from 358 MB 9 s after Wi-Fi
  returned, MD5 verified; illustration packs rested offline (60 s, then 120 s between attempts)
  and resumed ~10 s after Wi-Fi returned; all 26 packs installed.
- Every telemetry event and prop the app sends is already on the collector's allowlist, so no
  server-side change had to go first.

## Not tested

- On a real phone. The connectivity event is unproven on Android 13 (JP1) in particular.
- LaBSE now downloads from launch on any network, mobile data included, as illustration packs
  already did; the pause switches still apply.
