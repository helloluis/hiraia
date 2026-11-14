# Public demo APK receipt — 14 November 2026

Worker E, worktree `/home/b11/code/tala-wt/e`, branch `tala-v1-e`. Merged integration `4e9177863`. Implementation commits `32f65cf6b` and `f124f8237`; this receipt follows them. All worker source changes are under `packages/tala-mobile/**`; no lockfile, Kotlin/student app, remote host, deployment or push was committed/performed.

## Delivered artifact

- `/tmp/tala-apk/tala.apk`, **22,785,838 bytes** (21.73 MiB), both **arm64-v8a + armeabi-v7a**.
- SHA-256 **`e57b860b106e3447f5458bea722f3f4bcee41d6186d0c346d5b98571b629195e`**.
- `/tmp/tala-apk/tala-apk.json` contains the requested download path, version/code, packaged ISO build date, hash, bytes, minimum Android and application ID.
- VersionName **1.0.0-demo.1**, versionCode **1**, application ID **com.hiraia.tala.next**, label **Tala**.
- Build date **2026-11-14T03:46:53Z**; minSdk **24 / Android 7.0**, target/compileSdk **36**.
- Packaged API base **https://tala.hiraia.org**; cleartext explicitly false; OTA disabled. No pilot key/channel/version sequence reused.
- Universal native payload: arm64 raw 19,708,008 / compressed 7,605,410 bytes; ARMv7 raw 13,582,984 / compressed 6,282,251 bytes. Install-extracted compression retains both ABIs with a reasonable download size.
- Optional signed single-ABI derivatives (same resources/JS, other native ABI removed, realigned and re-signed with the same demo key): `/tmp/tala-apk/tala-arm64-v8a.apk` **16,501,394 bytes**, `/tmp/tala-apk/tala-armeabi-v7a.apk` **15,178,416 bytes**. Both pass apksigner/aapt checks; only the universal APK was installed/launched. The download manifest points to the universal APK.

## Commands and results

- `git merge tala-v1`: PASS (initially blocked by E's old generated, assume-unchanged lockfile; preserved it in a local stash before merging).
- `pnpm install --filter '@hiraia/tala-mobile...' --ignore-scripts`: PASS. New direct dependencies: **expo-device ~8.0.0** and **expo-constants ~18.0.0** (resolved 8.0.10 / 18.0.13). Existing React DOM peer warnings remain nonfatal. Generated lockfile is not committed.
- `npx prettier --write` on touched JS/CJS/TS/TSX/JSON/Markdown: PASS; shell scripts also pass `bash -n`.
- `pnpm --filter @hiraia/tala-mobile type-check`: PASS.
- `pnpm --filter @hiraia/tala-mobile test`: PASS, **74/74**, zero skips/failures. At merge, the quoted glob ran 72/72; all 44 formerly skipped deeper activity tests passed. Demo config and prepared-connection transaction tests add two.
- `bash scripts/build-demo.sh`: PASS after fixes. Runs Android export/budget, `expo prebuild --platform android --no-install`, then `./gradlew :app:assembleRelease --no-daemon --max-workers 2 -PreactNativeArchitectures=arm64-v8a,armeabi-v7a -Pexpo.useLegacyPackaging=true --console plain`, stable signing, manifest generation. Final Gradle build: SUCCESS, 42 s. Single-use daemon exited automatically; only one E Gradle build at a time.
- `apksigner verify --verbose /tmp/tala-apk/tala.apk`: PASS, one signer, v2/v3 signatures verified. Both optional per-ABI derivatives also verify.
- `aapt dump badging`: PASS; identity, both ARM ABIs, SDK levels and label match above.
- `zipalign -c -P 16 -v 4 /tmp/tala-apk/tala.apk`: PASS.
- `aapt dump xmltree ... AndroidManifest.xml`: PASS; extractNativeLibs=true, usesCleartextTraffic=false. Nearby/legacy storage/overlay/vibration permissions absent.
- `adb -s emulator-5580 install --no-incremental -r /tmp/tala-apk/tala.apk`: PASS, including repeated install-over-existing with retained sample data.
- `adb -s emulator-5580 shell am start -W -n com.hiraia.tala.next/.MainActivity`: PASS, cold launch. Created fictional multi-grade sample offline; force-stopped/reopened; class/timeline/25 pending local records persisted; Settings/About worked. No production account was created or provider invoked.
- `git diff --check`: PASS.

Exported Hermes bytecode **2,908,494 bytes** (<4 MB aim / 6 MB gate), one Fraunces font **73,016 bytes**, image **39,238 bytes**. Gradle's minified packaged Hermes asset **1,899,508 bytes**. Diagnostics explicitly labels its figure as the measured Android export.

## Device diagnostics observed

Android 16 / API 36 x86_64 emulator with ARM64 translation, 3,920 MiB RAM. SQLCipher **4.7.0 community** actually opened; key is 256-bit in SecureStore. Fraunces SemiBold loaded; body uses Android system font. Diagnostics reported **1,066 ms** from JS entry through storage/font readiness, explicitly labelled fallback because the RN native start marker was unavailable. Separate `am start -W` cold launch reported **1,215 ms**; neither is a physical reference-phone performance certification. Screenshot/UI receipts remain in `/tmp/tala-apk/about.png`, `about-ui.xml`, `sample-ui.xml`, `class-ui.xml`.

Native testing found and fixed Expo's exclusive-transaction helper opening an unkeyed SQLCipher connection. The adapter now prepares/keys a fresh connection before BEGIN IMMEDIATE, uses FULL synchronous mode, serializes writers and rolls back/closes failures. A regression test covers ordering, rollback and later commit. No plaintext fallback/data reset was introduced. Initial dependency/configuration and uncompressed ARM-translation launch failures were resolved by final regeneration and explicit compressed/extracted packaging; superseded APK hashes must not be published.

## Permissions and signing

Final uses-permissions: INTERNET, ACCESS_WIFI_STATE, ACCESS_NETWORK_STATE, WAKE_LOCK, RECEIVE_BOOT_COMPLETED, FOREGROUND_SERVICE, USE_BIOMETRIC, USE_FINGERPRINT, and app-signature-scoped `com.hiraia.tala.next.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. Framework WorkManager/SecureStore bring the service/boot/biometric entries; the app adds no persistent wake lock or Nearby service. Class activity remains the documented placeholder; native module excluded from autolinking.

Stable throwaway signing identity: `~/.config/hiraia/tala-next-demo.keystore`; credentials `~/.config/hiraia/tala-next-demo-signing.env`, both mode 600 and outside Git. Losing it forces testers to uninstall. Keep ID/key stable and bump both versionName/versionCode in app.config.js for the next demo. No secret values were printed/committed.

Install on a connected phone:

```bash
adb install -r /tmp/tala-apk/tala.apk
```

Unverified without a physical phone: Android 8 / 2 GB RAM, ARMv7 execution, native performance/battery/memory/installed-size budgets, PDF/share/keyboard/font-scale/permission behavior, background OS scheduling, and two-phone Nearby (excluded). Live server sign-in/register/sync was not exercised; the embedded HTTPS origin is verified and the orchestrator owns deployment. Native SQLCipher codec/version and durable reopen were observed on the emulator, not a forensic backup/WAL audit. No remote operation/publication was performed here.
