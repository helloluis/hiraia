# Experimental QVAC build

Implemented 14 November 2026 following Luis's approval of QVAC-PLAN.md. That file is the dated research record; this document describes the implementation and its verification limits.

## Two native outputs

Run from this package, with pnpm 9.15.9 dependencies installed:

```sh
TALA_QVAC=0 bash scripts/build-variant.sh
TALA_QVAC=1 bash scripts/build-variant.sh
```

The script sources `~/.config/hiraia/build-env.sh`, cleans disposable Android output when switching variants, exports Hermes, runs one Gradle build with two workers and no persistent daemon, and signs using the existing external demo key. STANDARD output is `/tmp/tala-apk/tala-standard-check.apk`; QVAC output is `/tmp/tala-apk/tala-with-qvac.apk`. Each gets a JSON manifest. Neither command overwrites the published `/tmp/tala-apk/tala.apk` or `tala-apk.json`.

STANDARD remains `com.hiraia.tala.next`, Android API 24+, ARM64 and ARMv7. QVAC is side by side: `com.hiraia.tala.next.qvac`, label **Tala (on-device AI)**, API 31+, ARM64 only. Both are version `1.0.0-demo.1`, code 1. Increase `app.config.js` version/code for subsequent installable releases. Both use the same stable throwaway demo keystore at `~/.config/hiraia/tala-next-demo.keystore`; losing it requires uninstalling existing demo installations. It is unrelated to the pilot signing key.

The flag controls Expo plugins, minimum SDK, Bare autolinking and the engine module selected by Metro. Expo 54 ignores a React Native config `android: null` override when merging autolinking output: the standard-only plugin therefore supplies the explicit `--exclude react-native-bare-kit` argument in generated settings.gradle. It fails closed if Expo's expected template changes. Always clean prebuild when changing the flag. No root configuration changed. Root's existing shamefully-hoist setting suffices; package-local `process` alias and explicit Fabric pins were also required by bare-pack/plugin verification.

QVAC's upstream OpenCL manifest entry is made optional in our QVAC-only plugin because this adapter requests CPU inference. OpenCL/Vulkan backends still ship as upstream native dependencies. No GPU capability is promised. Native Bare libraries can be loaded by RN package registration; no worker/model starts until the teacher requests engine start or a local suggestion.

## Model and lifecycle

[Official Qwen3-0.6B GGUF](https://huggingface.co/Qwen/Qwen3-0.6B-GGUF), Q8_0, Apache-2.0, **639,446,688 bytes**. `src/features/local-ai/model.ts` pins author revision `23749fefcc72300e3a2ad315e1317431b06b590a` and SHA256 `9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031`. This is an official small model with a verifiable published artifact; an unofficial smaller quantization was not substituted. It is still too large to claim support for Tala's Android 8 / 2 GB reference phone. A modern phone with 6 GB+ RAM is recommended; low-memory conditions refuse engine start.

No weights are bundled. Settings → On-device AI shows size/source/licence before explicit consent. Wi-Fi is required by default; the separate mobile-data switch allows other networks. Transfer pauses when backgrounded or when Wi-Fi disappears. A partial file survives process death and resumes using an HTTP range; wrong status, byte count or digest cannot become installed. Streaming native SHA256 avoids moving 639 MB through JS. Load checks the digest again. Delete removes final and partial files. SDK loading is local-path only, context 2048, CPU, temperature zero, output capped at 384 tokens. No foreground service or silent background inference was added.

Self-test streams a public example prompt and reports actual SDK token metrics (unknown when absent), completion elapsed time and sampled process peak PSS. Loading time is excluded; sampled process peak is not an instantaneous allocation peak. Leaving/backgrounding closes the engine. Download state and roster review remain durable; inference itself is not resumable.

## Bounded roster feature

Only unresolved, locally parsed review rows offer a local suggestion. Exactly one safe source name is passed to the engine; IDs, contacts and addresses are refused. Strict JSON passes shared `@hiraia/tala-core/roster` traceability and safe-cell validation, including reverse traceability to prevent dropped source tokens. Initial expansion, invented words, added sex/grade/IDs and empty names are rejected. The row remains needs-review; the teacher must choose the existing review action before saving. Stale/frozen reviews refuse results. Duplicate groups/counts are recomputed. No network route is called for this suggestion; normal confirmed-student account sync is unchanged. Cloud lesson generation remains unchanged. Offline section regeneration was deliberately left out.

## Dependencies and notices

Added package-local SDK 0.23.0, Bare kit 0.16.0, Fabric Android ARM64/iOS 0.25.0, expo-build-properties ~1.0.0; development bare-pack 3.1.0 and process alias bare-process 4.4.1. The iOS Fabric package is required by the upstream worker bundler's platform validation, not an iOS delivery claim. No root/student/server dependency edits; the orchestrator regenerates the lockfile.

`scripts/qvac-notices.cjs` copies the SDK/Bare/addon dependency licence inventory and complete available LICENSE/NOTICE texts into the QVAC APK, accessible under On-device AI → licences. Additional full model, V8, libuv, OpenSSL, Fabric llama and LLVM libc++ licence texts are retained under `native/local-ai/notices`. The inventory includes the broader SDK dependency closure, including unused plugin packages; it is not a claim that every listed package is executing or bundled. Completion-only qvac.config disables audio decoding and speech plugins. Published upstream notices are preserved; this is not an independent audit of every statically linked vendor component.

## Find N6 acceptance test

1. Install with `adb install -r /tmp/tala-apk/tala-with-qvac.apk`. Open **Tala (on-device AI)** beside standard Tala. Confirm the server address is https://tala.hiraia.org in diagnostics.
2. Use the sample class, then Class → Settings → On-device AI. Confirm no automatic model download or engine start. Record device RAM, Android version and initial free storage.
3. On Wi-Fi, consent to the displayed 639.4 MB download. Pause midway, close/reopen, resume; confirm checksum verification reaches Ready. Switch Wi-Fi off during a transfer: it must pause unless mobile data was explicitly allowed.
4. Start the engine and run the public example self-test. Record output, tokens, milliseconds, tokens/sec, PSS, loading time and device temperature. Cancel a run; unload; background/reopen. Never describe fake-engine test numbers as device results.
5. Turn networking off. In roster import paste synthetic ambiguous names such as `J. Dela Cruz`; run a local suggestion for a needs-review row. Confirm it never expands J. to an invented name, stays needs-review, and requires teacher action. Confirm manual review still works if inference fails. Use no real pupil data for acceptance testing.
6. Delete the model; confirm it cannot run until a fresh verified download. Confirm standard Tala still opens and has no On-device AI entry.

Physical-phone inference, quality, thermal stability and battery drain require this test before recommending the feature to teachers. Device support is experimental; SDK inclusion alone does not close the local-model privacy/quality gate.

Filipino strings needing human wording review: `onDeviceAi`, `localAiExperimental`, `localAiDownloadConsent`, `localAiMemory`, `localAiReviewNotice`, `localAiSampledPeak`, and `localAiNotices`. Technical model/version/licence names are intentionally preserved.
