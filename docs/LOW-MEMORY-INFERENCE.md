# Low-memory Android inference audit

Audit date: 2026-09-07

## Decision

Ship the curated fact, quiz, and illustration experience on every supported Android device.
Enable the local Hiraia-2B model by default only when all of these checks pass:

- physical RAM is at least 3.5 GiB (the practical lower bound for a marketed 4 GB phone);
- Android reports at least 1.5 GiB currently available before the model download or load;
- Android is not reporting a low-memory condition; and
- at least 2 GiB of storage is available for the model download, verification, and cache.

A device that fails any check must not download or load the LLM. Tapping the generation field
should open the HiraiaHub explanation instead. The student's downloaded facts, quizzes, progress,
and illustration packs remain fully usable.

Treat 3 GB and smaller devices as HiraiaHub-only for dynamic generation. Although the model
completed a test run at 3 GB and at the emulator's 2.5 GB minimum, both profiles depended on
roughly 600–750 MB of swap and triggered aggressive Android low-memory reclamation. That is not a
safe default for an unattended school deployment.

## Measurements

The same arm64 release APK and cached Hiraia-2B Q4_K_M model were run on an Android 14 emulator.
The emulator was cold-booted at each RAM size. The workload covered app launch, the curated card
feed, cached model load, QVAC warm-up/completion, a generation query, and a background/foreground
cycle.

| Configured RAM | Guest `MemTotal` | Curated app before LLM | Local model result | Pressure observed | Verdict |
| --- | ---: | ---: | --- | --- | --- |
| 4 GB | 3.83 GiB | about 296 MB PSS | Loaded; warm-up 1.8 s; dynamic card completed | LLM state about 1.93 GB PSS; Android killed many cached/background processes during load; app survived background/foreground | Supported, with live-memory gate and low-memory mode |
| 3 GB | 2.91 GiB | about 410 MB RSS after cold launch | Loaded; warm-up 12.1 s; dynamic card completed | about 600–700 MB swap; aggressive background-process eviction; app survived a short background/foreground cycle | Experimental only; default to HiraiaHub |
| requested 2 GB | emulator raised this to 2.42 GiB | about 375 MB RSS after cold launch | Loaded; QVAC warm-up/completion succeeded and a relevant card was returned | about 610–750 MB swap, very little free memory | Unsupported for local inference; curated mode remains viable |

The Android 14 emulator enforces a 2.5 GB minimum for this system image, so a true 2 GB local-model
run was not possible with this AVD. The 2.5 GB result already has no operational headroom and is
enough to exclude the 2–3 GB tier from automatic inference.

## Semantic-retrieval finding

The optional LaBSE path should be disabled on low-memory devices independently of the LLM gate.
On the 4 GB profile, loading the 384 MB embedder raised the app from about 1.93 GB PSS to about
2.38 GB PSS. The subsequent vectors step failed while Expo FileSystem attempted to allocate the
116 MB vector blob as one Java byte array:

```text
java.lang.OutOfMemoryError: Failed to allocate a 115842832 byte allocation
growth limit 201326592
```

The engine correctly stayed on lexical retrieval, so cards and generation continued to work. In
the current implementation, downloading and loading LaBSE on these devices adds data, storage,
memory pressure, and delay without successfully enabling semantic retrieval. Skip semantic init
below 6 GB until the vector reader is changed to stream or memory-map the file without a Java-heap
copy. The same allocation defect can occur on larger-RAM phones because the per-app Java heap limit
is separate from physical RAM.

## Required implementation behavior

1. Read total RAM, currently available RAM, Android's `lowMemory` flag, and free app-storage space
   before starting any model download. `expo-device` supplies total RAM but not the complete live
   decision, so expose `ActivityManager.MemoryInfo` through a small Android native module.
2. Persist the capability result with the measurements and app/model version, then re-check live
   available memory before each cold model load. A previous pass must not override a current
   low-memory warning.
3. Keep model download and model load behind the capability gate. Never spend a student's data on
   the 1.27 GB model when the device cannot safely load it.
4. Do not start illustration-pack downloads, model loading, and semantic initialization at the
   same time on 4 GB phones. Serialize the large jobs.
5. If a nominally eligible device fails model allocation or Android kills the process during load,
   persist an on-device-inference failure for that app/model version and use HiraiaHub mode on the
   next launch. Provide a deliberate retry in diagnostics rather than retrying every launch.
6. Record anonymous capability telemetry: total-RAM bucket, available-RAM bucket, low-memory flag,
   storage bucket, gate result/reason, model-load result, backend, peak memory if available, and
   whether Android restarted the process during initialization.

## Limits of this audit

These measurements establish a memory policy, not Android 10 compatibility or real-device speed.
The test image was Android 14 arm64 with emulator CPU/GPU and swap behavior. Before broad release,
validate the 4 GB tier on at least one real arm64 4 GB phone, including a cold boot, three
generations, screen-off/on, backgrounding to another app, and recovery after process death. Keep a
remote configuration override so the 4 GB tier can be disabled without publishing a new APK if
pilot telemetry shows repeated load failures.
