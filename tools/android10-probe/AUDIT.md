# Android 10 static audit — 2026-09-05

**Finding: no Android API >29 requirement was found among the shipped native ELF imports.**
This is evidence in favor of testing Android 10 CPU inference, not a runtime certification.
QVAC still officially documents Android 12+ support.

## Inputs

- Local `main`: `3883c20e9`; unified worktree HEAD: `3a25b4d3b`.
- Audited APK: unified's existing `packages/mobile/android/app/build/outputs/apk/release/app-release.apk`.
- SHA-256: `1262ed4abd451a2d7c2dd3d31891dd7a30f517a20f8a9655048349f4e17837c2`.
- APK minimum API 29, target API 36, ARM64 only.
- Installed SDK 0.17.1, llm-llamacpp 0.39.4, embed-llamacpp 0.30.1,
  react-native-bare-kit 0.12.3, Expo 54.0.35, React Native 0.81.5.
- Android NDK 29.0.14206865; API 29 `aarch64-linux-android` system stubs.

The worktree and existing APK are independent evidence sources. An existing APK is not
assumed to contain every current uncommitted source change.

## Checks and findings

`audit.py` extracts all 52 ARM64 ELF libraries and uses `llvm-readelf` to inspect dynamic
imports, exports, symbol versions and `DT_NEEDED`. It resolves the declared transitive
dependency closure, checks exports across the full packaged/API29 union, and searches
later NDK API directories for otherwise unresolved symbols. Linker-script `.so` files are
not treated as ELF libraries.

| Check | Result |
| --- | --- |
| Strong imports absent from packaged + API29 exports | 31, all in the OpenCL backend |
| Unresolved versioned imports | 31, all OpenCL vendor functions |
| Symbols found only in a later Android API | None |
| Imports outside declared dependency closure | 919: 876 strong resolved elsewhere in the union, 31 vendor OpenCL, 12 weak |
| Missing `DT_NEEDED` library | `libOpenCL.so`, a vendor library not provided by NDK system stubs |
| CPU backends packaged | Baseline `libqvac-ggml-cpu-android_armv8.0_1.so` |

The 876 strong imports outside a declared closure are available elsewhere in the packaged
runtime/system union, including Bare's `js_*`/`uv_*` exports. This is expected of dynamically
loaded addons, but actual linker visibility still requires a worker-startup test. The 12
weak imports are optional OpenSSL allocator hooks and C++ thread-local initialization hooks;
they must not be confused with mandatory post-Android-10 system APIs.

The Android libc version namespaces required are `LIBC`, `LIBC_N`, `LIBC_O`, and `LIBC_P`;
the version-aware check found them in the API29/bundled export union. The OpenCL backend
imports `clCreateBufferWithProperties@OPENCL_3.0` as well as functions in OpenCL 1.x
namespaces. A vendor driver can lack these independently of Android OS version. This
reinforces separating CPU compatibility from GPU compatibility.

## SDK/Java layer

- Both branches configure minSdk 29. Unified also pins that value in its Gradle-properties
  generator. BareKit's installed Android library and bundled manifest declare API29.
- The installed SDK's Expo RPC client starts a BareKit worklet, loads the worker bundle,
  resolves runtime config and initializes RPC. No explicit API31/Android12 rejection was
  found in the inspected Expo RPC path or BareKit Android source.
- The app's `MainActivity` has a guarded Android-version check for back-button behavior;
  this is not an Android12 startup requirement.
- The original app declares `uses-native-library libOpenCL.so` without `required="false"`.
  The probe makes that declaration optional so a vendor GPU library is not an install
  prerequisite. All audited QVAC backend binaries remain packaged.

## Diagnostic APK differences and verification

The probe has its own package name and a minimal UI, no card database/artwork, no automatic
downloads, explicit CPU placement, and the optional OpenCL declaration. It retains the
same SDK/BareKit versions and copied native addons, while Gradle supplies framework libraries
from the installed dependency versions.

All **31 copied native addons/backends match the original APK byte-for-byte** by SHA-256.
The probe contains 45 ARM64 ELF libraries; its static audit produces the same 31 vendor
OpenCL import/version misses and no later-Android-API symbols. Its signature verifies and
its manifest declares API29 minimum, API36 target and arm64-v8a. The JS bundle is embedded
and native developer support is disabled so a Metro server is unnecessary.

See [reports/native-audit.json](reports/native-audit.json) and
[reports/probe/native-audit.json](reports/probe/native-audit.json) for machine-readable details.

Final probe APK: **116,891,245 bytes** (116.9 MB); SHA-256
`c37e70c7669bbbba63139568c6bebfe772e19cd06b7fc261679ef47e794c9c85`.
The BareKit binary also matches the original APK byte-for-byte.

## Validation performed

- Release build, signature verification, manifest/ABI inspection, and native SHA-256 parity passed.
- The audit was tested against real compiled ELF fixtures: an API29-compatible
  `AChoreographer_getInstance` import passes, while the API30-only
  `AChoreographer_registerRefreshRateCallback` import is correctly identified as API30.
  See [reports/audit-tests.txt](reports/audit-tests.txt).
- Installed and launched the final APK without Metro in ARM64 Android10 and Android14 emulators.
- Small-model loading, cold/warm generation, unload/reload, and generation after reload
  passed on both OS versions.
- Hiraia-2B generation, LaBSE embeddings, and their simultaneous residency passed on Android10,
  including model unload/reload checks. Details: [EMULATOR-RESULTS.md](EMULATOR-RESULTS.md).
- QVAC's resource RPC completed, but its CPU collector failed. The UI correctly reports
  WARN, preserves the detailed collector errors, and allows separate inference testing.
- Report export through `adb run-as` and persistence across force-stop/relaunch passed.
- Both emulators were shut down afterward. The isolated Android10 AVD and model files are
  preserved for repeat testing without downloading again.
  See [reports/emulator-api29-inference.json](reports/emulator-api29-inference.json),
  [reports/emulator-api34-inference.json](reports/emulator-api34-inference.json) and
  [reports/verification.json](reports/verification.json).

## Limits and remaining evidence

Static analysis alone cannot settle dynamic `dlopen`/`dlsym` lookups, manual syscalls, Java reflection,
native CPU instruction dispatch, vendor library behavior, actual memory needs or successful
inference. The npm package's native engine binaries do not expose all upstream C++ source
through this inspection. It is not a comprehensive upstream source audit.

Earlier installation attempts on the connected Android16 phone returned
`INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`. The phone was not accessed
during the emulator inference tests. No Android10 physical-device inference has been performed.

The next decisive test is the same diagnostic APK on a physical Android10 ARM64 device,
with a newer-Android control: worker → small CPU model → Hiraia-2B → LaBSE → simultaneous
Hiraia/LaBSE. Export stage reports and logcat. A hosted physical device is sufficient; owning
the phone is not required.

## Model checksum correction before physical testing

The local Hiraia v2 GGUF is 1,274,396,160 bytes and its MD5 is
`fe2d0ab2ad856f2a42c5add5872c4234`, matching unified’s enforced model integrity
table. Its measured SHA-256 is
`7aec3b3b3ba0f131341ca2e09f676a651c2ed30de133570bb05069fca5dc5cbb`.
The SHA-256 in the source comment (`b13e…`) was stale. The probe was rebuilt
with the measured checksum, then validated through generation on Android10. No production
app files were changed. LaBSE’s local SHA-256 matches its pinned value.
