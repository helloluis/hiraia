# OVERNIGHT TTS TODO — 2026-09-15/16 (Luis asleep; standing authorization 21:55 GMT+8)

Luis: "When each respective model is done training, download everything important and then
turn off the pod... Once both models are ready, build the ONNX files, bundle into the APK,
and upload to the website and/or CloudFlare... I want to be able to download the new APK
from the website when I wake up."
→ Pod TERMINATION after artifact download is AUTHORIZED tonight (overrides the standing
"never delete a pod" rule for these two pods ONLY). Full rebuild recipes live in
HANDOFF-TTS-VOCODER.md if anything is ever missing.

Heartbeat (hiraia-tts-overnight): each firing = post the one-line status AND execute the
next unblocked item below, then tick its checkbox in this file (sed the `[ ]` to `[x]`).

## A. MS-Tagalog (pod 2 hiraia-sft-ms, io5vx4xc1txftb, ep /tmp/mbistft-ms-ep)
- [x] A1 (~23:15) step>=15000: synth sample (cd /workspace/mbistft && python mbistft_infer.py
      — VERIFY config=hiraia_tl_ms.json, glob=hiraia_tl_ms, noise .4), scp feas_tl.wav →
      sendfile --yes as hiraia-tl-MS-step15k-lossless.wav; post step+mel+F0.
- [x] A2 (~00:45-01:00) step>=20000 (or mel plateau >2k steps past 15k): stop training
      (`pkill -f '[t]rain_latest'`; kill remaining python).
- [x] A3 EXPORT on pod 2: adapt /tmp/export_mb_tl.py → export_ms_tl.py (config
      hiraia_tl_ms.json, ckpt = NEWEST logs/hiraia_tl_ms/G_*.pth, out /workspace/onnx-ms-tl,
      keep noise .4 baked + conv-iSTFT patch + Tensor.cuda no-op; scp fp16-weights.py from
      /Users/luis/Code/hiraia-unified/scripts/voice/). Run fp32 parity (noise-0 export vs
      torch <5e-3) + fp16. Synth 3 tl lines through fp16 ONNX → onnx_ms_tl.wav.
- [x] A4 DOWNLOAD to /Users/luis/Code/hiraia/finetuning/tts-vocoder/ms-tl/: newest G_*.pth
      + D_*.pth pair, configs/hiraia_tl_ms.json, text/symbols.py, train_tl_ms.log,
      logs/hiraia_tl_ms/events.*, onnx-ms-tl/model.onnx + model.fp16.onnx, onnx_ms_tl.wav.
      Verify sizes non-zero + sha256 the fp16 onnx.
- [x] A5 sendfile the ONNX-fp16 synth as lossless WAV (morning ear-check).
- [x] A6 KILL POD 2: runpodctl/GraphQL podTerminate io5vx4xc1txftb (creds
      `cd /Users/luis/Code/hiraia; set -a; . ./.env.local; set +a`). Verify gone via REST.

## B. EN-MS (pod 1 hiraia-sft, ep /tmp/mbistft-ep) — started 21:45, 15k ≈ ~02:00
- [x] B1 (~02:00) step>=15000: stop training (bracket pkill + kill python).
- [x] B2 EXPORT on pod 1: adapt exporter → export_ms_en.py (repo /workspace/mbistft-en!,
      config hiraia_en_ms.json, ckpt newest logs/hiraia_en_ms/G_*.pth, out
      /workspace/onnx-ms-en; en symbols are IN that repo). Parity + fp16 + synth 3 en lines
      → onnx_ms_en.wav.
- [x] B3 sendfile the en synth WAV; post step+mel+F0.
- [x] B4 DOWNLOAD to finetuning/tts-vocoder/ms-en/: same artifact set as A4 (+ ALSO
      /workspace/warmstart_en_full.pth and /workspace/mbistft-en/text/symbols.py).
      ALSO download pod-1 keepsakes before kill: logs/hiraia_tl2/G_15000.pth already local ✓,
      grab G_15500.pth + D_15500.pth + /workspace/warmstart_tl_full.pth (fallback resume kit).
- [x] B5 KILL POD 1: podTerminate 1egm66bnoejg2d after ALL downloads verified.

## C. APK (local, hiraia-unified) — after A+B exports downloaded
- [x] C1 Swap assets in packages/mobile/assets/voices/: tl/model.onnx = ms-tl fp16,
      en/model.onnx = ms-en fp16 (keep old as model.mms-backup.onnx — tl backup already
      exists; make one for en). Update BOTH voice.json sha256 (python hashlib). Vocab/sr
      unchanged. BENCH_ON_LAUNCH stays false. pnpm type-check.
- [x] C2 Regression gate: `cd /Users/luis/Code/hiraia-unified && bash
      finetuning/eval/harness/run-harness.sh` → must be GREEN (rule) before build.
- [x] C3 Build: export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home;
      export ANDROID_HOME=~/Library/Android/sdk; rm -rf android/app/build/generated/assets/
      createBundleReleaseJsAndAssets android/app/build/intermediates/assets/release;
      cd android && ./gradlew assembleRelease. Verify BOTH new onnx byte-sizes inside the
      APK (unzip -l | awk '$1>30000000').
- [x] C4 Upload (SHORT filename — Luis types it manually): cp APK → /tmp/ms1.apk;
      ~/.venvs/hiraia-publish/bin/python deploy/publish-release-assets.py --env-file
      /Users/luis/Code/hiraia/.env.cloudflare.local --asset /tmp/ms1.apk
      (--asset does NOT touch the public hiraia.apk alias — correct for a test build).
- [x] C5 Morning report: post URL + status table in chat AND sendfile a small
      morning-report.md (URL, steps/mels, F0s, what to test, Redmi RTF bench still owed).

Final URL to hand Luis: **https://assets.hiraia.org/models/ms1.apk** (short by request —
he types it manually; future iterations = ms2, ms3, never reuse a name for new bytes).

## Rules in force overnight
- Judge/deliver voice audio as RAW 16k WAV via sendfile (<1.5MB; no ALAC/AAC).
- Traps: bracket pkill/pgrep; log mtime; non-strict load garble (verify config before any
  synth; off-pitch F0 ≥235 = wrong config); ssh 'bash -s' <<'INNER'.
- Do NOT touch the public landing page / hiraia.apk alias / VPS.
- MB fallbacks (logs/hiraia_tl2/G_15000|15500) must be DOWNLOADED (B4) before pod-1 dies.
