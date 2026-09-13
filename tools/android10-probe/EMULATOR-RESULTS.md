# QVAC CPU inference on Android 10 — emulator results

2026-09-05. **The tested QVAC CPU inference path works on Android10 in an ARM64 emulator.**
No phone access was used for these runs.

| Test | Android10 / API29 | Android14 / API34 control |
| --- | --- | --- |
| APK installation and standalone launch | PASS | PASS |
| Worker heartbeat | PASS | PASS |
| SmolLM2-360M Q8 load and cold/warm generation | PASS | PASS |
| Small-model unload/reload and generation again | PASS | PASS |
| Hiraia-2B v2 Q4_K_M load and cold/warm generation | PASS | Not run |
| Hiraia unload/reload and generation again | PASS | Not run |
| LaBSE English/Tagalog/Cebuano embeddings | PASS: 768 finite dimensions, approximately unit L2 norm | Not run |
| LaBSE unload/reload and embedding again | PASS | Not run |
| Hiraia and LaBSE resident together; embed then generate | PASS | Not run |
| QVAC resource collection | WARN: CPU collector initialization failed | Same warning |

## Environment and provenance

- Host: Apple Silicon Mac; both guests ARM64, 4096 MB configured RAM.
- Android10 image: Google APIs ARM64 revision13, downloaded from Google's SDK catalog.
- Image fingerprint reported in app:
  `google/sdk_gphone64_arm64/emulator64_arm64:10/QSR1.211112.011/13135432:userdebug/dev-keys`.
- Image archive: `https://dl.google.com/android/repository/sys-img/google_apis/arm64-v8a-29_r13.zip`.
- Archive size: 1,170,273,162 bytes; SHA-1 matched Google's catalog:
  `f96b1ee677f1bd2ddcff0b93485e9c65db2e6160`.
- SDK 0.17.1; llm-llamacpp 0.39.4; embed-llamacpp 0.30.1; BareKit 0.12.3.
- Exact native addon hashes match the audited unified APK; CPU baseline ARMv8.0 only,
  GPU libraries retained, explicit `device: 'cpu'` and `gpu_layers: 0` for LLMs.
- Tested APK SHA-256:
  `c37e70c7669bbbba63139568c6bebfe772e19cd06b7fc261679ef47e794c9c85`.

The small model was downloaded to the Mac from the SDK's pinned Hugging Face revision
and its SHA-256 verified. Hiraia/LaBSE were already on the Mac. They were transferred into
each probe app over ADB and streaming SHA-256 verified in the app before native loading.
Inference used local files, with no delegated provider. This was not an airplane-mode or
network-isolation test.

## What the evidence establishes

API29 can install the APK, initialize this QVAC worker and execute both tested LLM model
architectures and the LaBSE embedder on CPU. A blanket assertion that this CPU path has a
hard Android12 dependency is not supported by these results. This also shows the tested
path can run on these ARM64 emulators despite QVAC's general published emulator exclusion.
It does not change upstream's official support policy.

Emulator timing is **not budget-phone performance**. These runs use the Mac's CPU and
storage behind a virtual Android device. The standalone Hiraia cold generation completed
in about 6.3 seconds, with a process-PSS snapshot around 1.65 GiB; the combined run sampled
about 2.12 GiB. These are diagnostic observations, not peak-memory budgets or guarantees
for 4 GB phones. Both emulators reported `lowRamDevice: false`; Android Go was not tested.

The full Hiraia UI, card assets, fact-vector index and production retrieval/prompt flow
are absent from this probe. Output-quality gates were not run. In particular, the simplified
Tagalog flashcard prompt received an English answer from Hiraia; the runtime smoke test
correctly records execution as PASS without claiming language/style quality passed.

Physical ARM64 phones still need validation for memory pressure, vendor drivers, GPU paths,
CPU instruction dispatch, thermals, battery use and sustained responsiveness.

## Probe issues found and fixed during testing

1. Expo's File URI can use `file:/...`, while the helper only stripped `file://`.
   The native hasher now parses Android URIs; the loader path accepts both forms.
2. Using bare `AppRegistry.registerComponent` skipped Expo runtime initialization.
   Hermes lacked `Symbol.asyncIterator`, breaking QVAC streaming. The probe now uses
   Expo's standard `registerRootComponent` **before importing QVAC**. This is probe setup;
   Hiraia's existing Expo Router entry already performs Expo initialization.
3. The Hiraia v2 SHA-256 comment in production config was stale. The probe now pins the
   measured SHA matching production's enforced size/MD5 contract; see [AUDIT.md](AUDIT.md).

The Android14 report preserves earlier failed attempts for diagnosis, followed by the
successful suite after these fixes. The summary in `verification.json` describes the final APK.

## Evidence and repeat testing

- [Android10 stage report](reports/emulator-api29-inference.json)
- [Android14 stage report](reports/emulator-api34-inference.json)
- [Verification summary](reports/verification.json)
- Full Android10 logcat: `build/emulator-api29-full.log` (local generated artifact).

The Android10 AVD is isolated under this probe's gitignored `build/avds/`, and its staged
models are preserved. Both emulators were shut down after collecting results. On this Mac:

```sh
# Terminal 1: boot the prepared Android10 emulator; no connected phone is used.
bash tools/android10-probe/run-android10-emulator.sh

# Terminal 2, after boot:
adb -s emulator-5582 shell am start -n com.hiraia.androidprobe/.MainActivity
adb -s emulator-5582 exec-out run-as com.hiraia.androidprobe \
  cat files/probe-report.json > android10-report.json
```

To interact visually, omit `-no-window` in the launch script. Automated interaction can
use UI Automator/ADB with the explicit emulator serial. Always specify that serial so a
connected physical phone is not selected accidentally.
