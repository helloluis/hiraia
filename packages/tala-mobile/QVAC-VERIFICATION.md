# QVAC verification — 14 November 2026

Implementation commits start at `6978e73b9`; native isolation/notices hardening is `d2ae55f5b`. See QVAC-IMPLEMENTATION.md for architecture, dependencies, support limits and the Find N6 acceptance procedure.

## Automated checks

- `pnpm --filter @hiraia/tala-mobile type-check`: PASS.
- `pnpm --filter @hiraia/tala-mobile test`: PASS, **84 tests**, none skipped. Includes model consent/Wi-Fi/resume/hash/range/storage/pause, fake-engine lifecycle/metrics, source-traceable roster suggestions and mandatory review/no-network persistence, native build flags, optional OpenCL manifest configuration.
- `npx prettier --write` on touched JS/TS/JSON/Markdown: PASS. Kotlin/shell/licence texts excluded from unsupported formatting.
- `bash -n scripts/build-variant.sh scripts/sign-demo.sh`: PASS.
- `TALA_QVAC=0 bash scripts/build-variant.sh`: PASS after fixing Expo's ignored null autolinking override. Export budget PASS: **2,964,095 bytes** Hermes, below 6 MB gate and 4 MB aim.
- `node scripts/compare-standard.cjs`: PASS against preserved `/tmp/tala-apk/tala.apk`: manifest byte-for-byte identical as aapt XML text, same 30 native library ZIP entries, no QVAC/Bare. This compares manifest/library names, not native binary hashes.
- STANDARD rebuilt APK **22,822,702 bytes**, versus preserved standard **22,785,838**: +36,864 bytes (+0.16%). Same SDK/ABIs/permissions; exact APK size is therefore not unchanged. The additional gated application code remains in the standard JS graph.
- STANDARD ARM64-only derivative **16,538,172 bytes** (repacked, aligned, signed for like-for-like payload comparison). STANDARD production artifact remains dual ABI. QVAC has no ARMv7 output.
- QVAC export: **27,180,059 bytes** Hermes. This exceeds the standard JS budget; it is reported separately and is not waived for the standard build. SDK's React Native-facing dependency graph is large even with a completion-only Bare worker. No model weights in either APK.

## Native inspection

Both use Hermes, compile/target SDK 36 and the same external demo signer. STANDARD minSdk 24, QVAC minSdk 31. QVAC has 63 ARM64 library entries: standard ARM64's 15 plus 48 SDK/Bare additions. Full names are in `/tmp/tala-apk/qvac-native-diff.json` and the APK itself: Bare runtime/polyfills, QVAC Fabric/llamacpp, CPU ARMv8/9 kernels, OpenCL/Vulkan/RPC, RocksDB, sodium, UDX and supporting native addons. Some dependency versions coexist; no attempt was made to prune upstream native closures by hand.

No Android permission added beyond the application-ID-qualified dynamic receiver permission's rename. Both request INTERNET, ACCESS_WIFI_STATE, ACCESS_NETWORK_STATE, WAKE_LOCK, RECEIVE_BOOT_COMPLETED, FOREGROUND_SERVICE, USE_BIOMETRIC and USE_FINGERPRINT, plus that signature receiver permission. No new foreground inference service was added. Cleartext remains disabled; no OTA/update channel.

The first QVAC install failed because upstream required `libOpenCL.so` as a system library. Our CPU-only variant now marks that library optional; rebuilt APK installed successfully. Earlier build failures from missing bare-pack process/Fabric resolution and standard minSdk conflict were fixed in package-local configuration. A manual Gradle invocation without TALA_QVAC produced mismatched embedded Expo metadata; the manifest identity check caught it and the final artifact was rebuilt through the variant script. Use that script, not an environment-incomplete direct Gradle invocation.

## Emulator evidence

Reachable emulator `emulator-5586`: Android 16/API 36, x86_64 with ARM64 translation, approximately 3 GB RAM. It belongs to an existing workflow and was not restarted or reconfigured persistently. Both APKs installed with `adb install --no-incremental -r` and launched successfully. STANDARD rendered sign-in/sample entry; QVAC rendered the sample class, Settings and On-device AI. No production account or real learner names were used.

Wi-Fi was initially disabled: the default Wi-Fi guard refused download, and an explicit other-network attempt failed DNS before receiving bytes. Enabling Wi-Fi restored DNS. Download then progressed on Wi-Fi, backgrounding paused at **178 MB**, and reopening/resuming continued beyond **269 MB** without restarting from zero. The original Wi-Fi-off setting is restored after testing. Final verification outcomes are appended below.

Final QVAC variant build and `apksigner verify --verbose` PASS (v3 signature), `zipalign -c -P 16 4` PASS and `aapt dump badging` PASS. Artifact: `/tmp/tala-apk/tala-with-qvac.apk`, **102,836,338 bytes**, SHA256 `54cb914da9d0f2436d2f37d2dbe070fe11f11f1910347d804dc0021cfeba04fc`; metadata `/tmp/tala-apk/tala-with-qvac-apk.json`, build date `2026-11-14T06:09:41Z`. Delta vs current rebuilt dual-ABI standard: **80,013,636 bytes**; vs its ARM64-only derivative: **86,298,166 bytes**. QVAC ARMv7: unsupported, no artifact. The preserved public standard SHA256 remains `e57b860b106e3447f5458bea722f3f4bcee41d6186d0c346d5b98571b629195e`.

The final APK embeds QVAC=true, correct side-by-side ID and HTTPS server address, zero GGUF weight files, 281-package licence inventory and 313 complete available licence/notice texts (2,538,246-byte combined notices). No persistent Gradle daemon was started by the build scripts; their single-use daemons exit after each build. An older unrelated shared-machine Gradle daemon was not stopped.

The real model transfer completed: **639,446,688 bytes**, native SHA256 verification succeeded and the UI reached **Ready (verify again before use)**. Clicking Start then displayed the low-memory warning and kept the engine unloaded. This emulator had less than the adapter's required **1,500 MiB available RAM**, so execution stopped **before SDK worker/model start**. This is the exact observed stop, not a demonstrated GPU/ARM translation failure. No real completion, tokens/sec, inference PSS or AI roster output was obtained. The QVAC vendor also does not support emulator inference, so bypassing the memory guard would not establish phone compatibility. Fake-engine unit results are not device inference results.

The final signed APK was installed over the earlier test QVAC build using the stable signer and launched again. Model download/pause/resume/checksum/delete and standard sign-in rendering were exercised on the emulator; real roster-suggestion quality and the local completion remain unverified pending the Find N6 test in QVAC-IMPLEMENTATION.md. No optional local lesson-section regeneration was added, no contract changes were requested, and no deploy/push was performed.

Delete was exercised on the emulator: the verified final file was removed and the UI returned to Absent · 0 MB with engine unloaded. The original Wi-Fi-disabled state was restored. An install-over/reopen display bug (Ready · 0 MB despite a valid file) was fixed in `11950cd2d`; regression assertion added, all 84 tests still pass. Final standard source export is **2,964,144 bytes** Hermes and passes the budget; native comparison figures above initially came from the preceding build and were measured before that display-only correction; native configuration is unchanged.

## Added ARM64 native libraries

Exact additions relative to standard ARM64:

```text
libbare-abort.2.0.13.so
libbare-buffer.3.6.0.so
libbare-buffer.3.7.2.so
libbare-cpu-info.0.1.1.so
libbare-crypto.1.15.3.so
libbare-dns.2.1.4.so
libbare-fs.4.7.1.so
libbare-fs.4.8.4.so
libbare-gpu-info.0.1.1.so
libbare-hrtime.2.1.1.so
libbare-inspect.3.1.4.so
libbare-kit.so
libbare-os.3.9.1.so
libbare-os.3.9.4.so
libbare-path.3.1.3.so
libbare-pipe.4.1.5.so
libbare-pipe.4.4.0.so
libbare-signals.4.2.0.so
libbare-signals.5.0.0.so
libbare-stdio.1.0.2.so
libbare-tcp.2.2.13.so
libbare-tls.3.1.5.so
libbare-tty.5.1.0.so
libbare-type.1.1.0.so
libbare-url.2.4.3.so
libbare-url.2.5.7.so
libbare-zlib.1.3.3.so
libbare-zlib.1.4.1.so
libfs-native-extensions.1.5.0.so
libquickbit-native.2.4.8.so
libqvac-ggml-cpu-android_armv8.0_1.so
libqvac-ggml-cpu-android_armv8.2_1.so
libqvac-ggml-cpu-android_armv8.2_2.so
libqvac-ggml-cpu-android_armv8.6_1.so
libqvac-ggml-cpu-android_armv9.0_1.so
libqvac-ggml-cpu-android_armv9.2_1.so
libqvac-ggml-cpu-android_armv9.2_2.so
libqvac-ggml-opencl.so
libqvac-ggml-rpc.so
libqvac-ggml-vulkan.so
libqvac__fabric-android-arm64.0.25.0.so
libqvac__llm-llamacpp.0.65.1.so
librabin-native.2.0.0.so
librocksdb-native.3.15.1.so
librocksdb-native.3.19.5.so
libsimdle-native.1.3.9.so
libsodium-native.5.1.0.so
libudx-native.1.19.2.so
```

Against the preserved public standard APK (rather than the rebuilt check artifact), QVAC adds **80,050,500 bytes** overall. Against the preserved standard ARM64-only derivative (16,501,394 bytes), it adds **86,334,944 bytes**. Standard ARMv7 remains 15,178,416 bytes; no QVAC ARMv7 build exists. The final source standard Hermes measurement (2,964,144 bytes) includes the reopen display fix.
