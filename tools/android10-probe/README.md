# Hiraia Android compatibility probe

Standalone **Android 10 / API 29+, arm64-v8a** diagnostic APK. It installs as
`com.hiraia.androidprobe`, separately from Hiraia. It bundles JavaScript and needs
no Metro server. It is debug-keystore signed and debuggable for `adb run-as` report
collection; it is **not a production release**.

Built APK: [build/hiraia-android10-probe.apk](build/hiraia-android10-probe.apk).
Audit: [AUDIT.md](AUDIT.md). Generated native findings: [reports/](reports/).
The final APK is 116.9 MB; [build/SHA256SUMS](build/SHA256SUMS) contains its checksum.
The native runtime and retained GPU backends account for most of the download.

**Android10 ARM64 emulator results:** small-model and Hiraia generation, LaBSE embeddings,
simultaneous residency, and unload/reload all passed. See
[EMULATOR-RESULTS.md](EMULATOR-RESULTS.md) for evidence and limits. Physical-device support
and mobile performance remain unverified.

## What it tests

1. QVAC worker heartbeat and system resource discovery, without downloading anything.
2. SmolLM2-360M Q8 CPU model loading, cold/warm generation, unload/reload, and generation
   after reload. This isolates basic inference from Hiraia's larger Qwen3.5 architecture.
3. Hiraia-2B v2 Q4_K_M, using the shipping 4096 context and a fixed grounded Tagalog
   flashcard prompt, with the same lifecycle checks.
4. LaBSE CPU embeddings in English, Tagalog and Cebuano; asserts 768 finite dimensions
   and approximately unit L2 norm; unload/reload and embed again.
5. Hiraia + LaBSE resident together, with embedding and generation, to expose additional
   memory pressure. This does not load the large fact-vector index or curated library.

The GPU libraries remain packaged to expose the existing runtime's loading dependencies,
but model placement is explicitly CPU-only, with only the baseline ARMv8.0 CPU backend.
The vendor OpenCL manifest declaration is optional in this probe.

Each native stage is written to the app's private report **before** it starts. The report
contains Android version, ABI, hardware, RAM/free storage, process PSS snapshots, exact
SDK/build provenance, timings, generated text, and errors. A native crash may bypass JS
error handling; the last RUNNING stage and Android logcat then identify where it stopped.
Process PSS snapshots are not peak-memory measurements. Report sharing is an explicit
button; no reports are uploaded automatically.

## Run on a phone or remote physical device

```sh
adb -s DEVICE_SERIAL install -r tools/android10-probe/build/hiraia-android10-probe.apk
adb -s DEVICE_SERIAL shell am start -n com.hiraia.androidprobe/.MainActivity
```

Run **Test worker** first. Use each **Download** button only for the model you intend
to test; then disable networking and use **Test … on CPU**. Downloads are explicit:

| Asset | Bytes | Download size |
| --- | ---: | ---: |
| SmolLM2-360M Q8 | 386,404,992 | 386 MB |
| Hiraia-2B v2 Q4_K_M | 1,274,396,160 | 1.27 GB |
| LaBSE Q4_K_M | 383,762,048 | 384 MB |

Each file is size-checked and streaming SHA-256 verified before being promoted from
`.part`. Cached files are reverified before testing. No models are in the APK.
This diagnostic downloader deliberately restarts an interrupted partial download;
it does not claim Hiraia's production downloader's resume behavior. A download/hash
failure is a provisioning failure, not evidence of an Android inference incompatibility.
Keep the app foregrounded. Network operations have a 30-minute deadline; model operations
have a 5-minute deadline; heartbeat/resource calls have a 60-second deadline.

After a failed/timed-out inference stage, **share the report, then force-stop and reopen**.
The app blocks additional native tests until restart because a timed-out native operation
may still be executing. Do not treat a timeout as proof of unsupported Android; inspect
logs and compare with the newer-Android control.

```sh
# Collect persistent results, including after a crash (does not require root).
adb -s DEVICE_SERIAL exec-out run-as com.hiraia.androidprobe cat files/probe-report.json > probe-report.json
# Collect process/native crash and SDK logs after the run; no need to clear device logs.
adb -s DEVICE_SERIAL logcat -d -v threadtime > probe-logcat.txt
# Reset the worker without deleting downloaded models or the report.
adb -s DEVICE_SERIAL shell am force-stop com.hiraia.androidprobe
adb -s DEVICE_SERIAL shell am start -n com.hiraia.androidprobe/.MainActivity
```

To pre-stage existing model files through ADB instead of downloading, first launch the app,
then stream an **exact matching GGUF** into its private files directory. The test will
verify the pinned SHA-256. This example avoids a second full-size copy on device:

```sh
adb -s DEVICE_SERIAL shell run-as com.hiraia.androidprobe sh -c \
  "'cat > files/hiraia-sft-2b-v2.Q4_K_M.gguf'" < /path/to/hiraia-sft-2b-v2.Q4_K_M.gguf
```

## Interpretation

Run the same APK on Android 12+ as a control, then on Android 10 and 11 **physical ARM64
devices**. A successful small-model run establishes a narrower result than a successful
Hiraia/LaBSE run. Nonempty generated text establishes execution, not teaching quality.
This probe does not certify GPU behavior, the full Hiraia app, Android-wide compatibility,
or performance on low-RAM devices. Memory, vendor drivers and sustained thermal performance
need later tests on representative phones.

QVAC's [published support](https://docs.qvac.tether.io/system-requirements/) starts at
Android 12 and explicitly excludes emulators. Emulator tests are useful for checking
this probe's UI/packaging, but an emulator failure does not demonstrate a physical-device
Android compatibility failure.

## Rebuild

The probe reuses the installed unified dependency versions. It does **not** run Expo/QVAC
prebuild, update dependencies, switch branches, or modify Hiraia source. Preparation copies
the native shell, captures the installed QVAC worker, and extracts the exact native addons
from the audited unified APK. Generated project/build files are gitignored. Gradle uses
the installed dependency tree's normal generated build caches; don't run a competing build
against that same tree at the same time.

```sh
# Run at the hiraia repository root. Run preparation once, before the first build.
python3 tools/android10-probe/prepare.py --unified /Users/luis/Code/hiraia-unified
bash tools/android10-probe/build.sh

python3 tools/android10-probe/audit.py \
  /Users/luis/Code/hiraia-unified/packages/mobile/android/app/build/outputs/apk/release/app-release.apk \
  --ndk /Users/luis/Library/Android/sdk/ndk/29.0.14206865 \
  --out tools/android10-probe/reports

# Validate that the audit detects a deliberately introduced API30 dependency.
python3 tools/android10-probe/test_audit.py \
  --ndk /Users/luis/Library/Android/sdk/ndk/29.0.14206865
```

If regenerating, remove only this probe's generated `android/` directory first. The
`build/provenance.json` file records the worker hash, source APK hash, source commit and
engine versions. It is also embedded in runtime reports. The source APK's provenance is
its SHA-256; its exact correspondence to the worktree HEAD is not assumed.
