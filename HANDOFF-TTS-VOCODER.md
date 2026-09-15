# HANDOFF — Hiraia TTS vocoder retrain (rewritten 2026-09-15 ~21:35 GMT+8)

**Purpose:** complete state so any agent can resume cold. Read together with memory files
`hiraia-tts-vocoder-retrain.md`, `hiraia-bundled-tts-voices.md`, `hiraia-web-brand-restore.md`
in `~/.claude/projects/-Users-luis-Code-hiraia/memory/`.

> **OVERNIGHT MODE (21:56 GMT+8):** Luis authorized the full unattended pipeline —
> train → download artifacts → TERMINATE both pods → export ONNX → bundle APK → upload.
> The driver is **OVERNIGHT-TTS-TODO.md** (same dir), executed by heartbeat
> `hiraia-tts-overnight` id **318a19ca** (06f9a5cb deleted). Deliverable by morning:
> test APK with BOTH MS voices at assets.hiraia.org.

## 0. WHERE WE ARE RIGHT NOW — THE FORK RESOLVED: MS WINS

**Luis, 21:44 GMT+8: "MS-step8500 is great if it's only halfway to completion."**
Multi-stream is the ship architecture. Executed immediately:
- EN-MB run STOPPED at ~3.8k, its checkpoints deleted (obsolete, freed 4.6GB); English
  RELAUNCHED as **EN-MS** (pod 1, /workspace/mbistft-en, configs/hiraia_en_ms.json,
  -m hiraia_en_ms, log /workspace/train_en_ms.log, warmstart 440/440, started 21:45,
  15k ≈ ~02:00 GMT+8; sampler mbistft_infer_en.py pre-pointed at the MS config).
- MS-tl converges on pod 2; **standing promise: lossless WAV sample at step 15k
  (~23:15-23:30 GMT+8)**, then ride to ~20k unless Luis stops it.
- MB tl G_15000 @ noise 0.4 demoted to FALLBACK (files stay protected).
- Heartbeat replaced: now `hiraia-tts-ms-era` id **06f9a5cb** (f61bbdd3 deleted).
- Remaining after Luis approves converged MS-tl: export MS (same exporter, MS config),
  fp16, new test APK for Luis's phone, then Redmi RTF bench when he's home, then v0.4.10.

## 1. Mission and fixed decisions

- Bundled MMS-VITS voices (tl+en female, fp16 ONNX, 16 kHz, char-level) sound good but
  are too slow on the target Redmi (Helio G85): best RTF **1.93** (fp16/cpu/4thr); NNAPI/
  XNNPACK/int8 all worse; the HiFi-GAN decoder is the cost. Target: **RTF < 1**.
- **v0.4.10 is HELD** until a fast voice passes Luis's ear + the on-device RTF bench.
- Never delete RunPod pods without Luis asking. Never modify the VPS cost-guard config.
  Commit only when asked. `RUNPOD_API_KEY` in `.env.local` (gitignored). scp uses `-P`.
- ETAs in GMT+8. Use the Claude subscription, not the API.

## 2. Training runs — history and state

| Run | Arch | Where | State |
|---|---|---|---|
| v1 tl (from-scratch dec) | MB-iSTFT | pod 1 logs/hiraia_tl | dead: plateaued mel ~22, buzzy |
| **v2 tl (97% dec warm-start)** | MB-iSTFT | pod 1 logs/hiraia_tl2 | STOPPED at 15.5k by design; broke floor (lows 20.5); **G_15000 = MB ship candidate** |
| **MS tl** | MS-iSTFT | pod 2 logs/hiraia_tl_ms | RUNNING ~8.6k steps, low 20.76; sample with Luis |
| **EN** | MB-iSTFT | pod 1 /workspace/mbistft-en logs/hiraia_en | RUNNING ~3.2k, mel ~23; RESTART AS MS if MS wins |

Both pods train at ~1 step/s regardless of GPU (measured: the job is CPU/pipeline-bound;
GPU ~30% util. Bigger GPUs do NOT help; parallel independent runs do).

- Pod 1 `hiraia-sft` RTX 3090: id /tmp/mbistft-pod-id, ep /tmp/mbistft-ep ("IP PORT").
- Pod 2 `hiraia-sft-ms` RTX A5000 $0.16/hr CA-MTL-1: id /tmp/mbistft-ms-pod-id, ep
  /tmp/mbistft-ms-ep. (Names MUST keep the `hiraia-sft` prefix = 20h cost-guard ceiling.)
- Heartbeat `hiraia-tts-en-ms` id **f61bbdd3** fires every 10 min with the full per-firing
  procedure + milestones in its prompt (EN sample at ≥15k; disk pruning rules).
- Pod-1 disk 86% — prune OLD hiraia_en checkpoint pairs at >90%, keep 3 newest;
  **NEVER touch logs/hiraia_tl2/G_15000.pth / G_15500.pth.**

## 3. The Luis ear-verdict timeline (calibration — read this before sending samples)

1. MB v2 step-8.5k (AAC m4a): "still quite a bit of buzz."
2. MB step-15k lownoise (noise 0.4, AAC m4a): **"shippable"** → drove the export+APK.
3. In-app on his phone (raw PCM): "very buzzy and metallic."
4. Lossless bisect wav (all four chain links incl. the approved torch chain): "still a
   bit buzzy" → **the buzz is partly inherent to converged MB; AAC was flattering it.**
5. `hiraia-tl-MB-ONNX-fp16.m4a` (AAC): "cleanest so far."
→ Judge voices with **lossless WAV** from now on; AAC masks the artifact under judgment.
→ In-app sounds worse than desktop-lossless of the same model: small unexplained
  on-device delta remains (wav.ts DOES clamp — not integer wrap; app uses cpu EP,
  2 threads; ORT-RN is 1.24 vs desktop 1.30; card text differs from test lines).

## 4. ONNX export — DONE and verified (MB tl)

- Artifacts: pod 1 `/workspace/onnx-mb-tl/{model.onnx 110MB, model.fp16.onnx 55.6MB,
  model.zero.onnx}`; local `finetuning/tts-vocoder/{G_15000.pth, hiraia_tl.json,
  mb-tl-model.fp16.onnx}` (dir gitignored: *.pth *.wav *.onnx).
- Exporter `/workspace/export_mb_tl.py` (+/tmp copy): noise 0.4/0.8/1.0 BAKED, opset 17,
  same `input_ids`+`attention_mask` → waveform interface as engine.ts (drop-in).
  fp16 via hiraia-unified `scripts/voice/fp16-weights.py` (weights-only + Cast).
- Verification: conv-iSTFT vs torch.istft parity 2e-7; graph parity (noise 0) torch vs
  ORT 2.4e-5; **bisect proof** (`/workspace/bisect_buzz.py`): same sentence through
  torch+real-istft / torch+conv-istft / onnx-fp32 / onnx-fp16 → HF>4k energy flat
  (0.75→0.78%), A≡B bit-identical → **the export chain adds NO buzz.**
- Export gotchas: `TorchSTFT.inverse` (stft.py line ~197) is the torch.istft one — the
  conv-based `inverse` at line ~144 belongs to the OTHER class (`STFT`); replace
  TorchSTFT.inverse with the conv_transpose IDFT-basis kernel (hann16/hop4 envelope =
  constant 1.5 interior, crop n_fft/2). `pqmf.PQMF.__init__` hardcodes `.cuda()` → patch
  `torch.Tensor.cuda` to a no-op in the export process (runs on CPU while GPU trains).
- **For an MS export later:** same exporter, swap config to hiraia_tl_ms.json (MS
  generator also uses TorchSTFT.inverse; PQMF is replaced by learned convs — exportable).

## 5. Test APK (what Luis is holding)

- URL: **https://assets.hiraia.org/models/hiraia-mb-voice-test-2026-09-15.apk** (460MB,
  uploaded via `deploy/publish-release-assets.py --asset` from `~/.venvs/hiraia-publish`
  python; creds `/Users/luis/Code/hiraia/.env.cloudflare.local`; --asset does NOT touch
  the public hiraia.apk alias).
- Contents: MB tl fp16 as `packages/mobile/assets/voices/tl/model.onnx` (voice.json
  sha256 updated; old MMS kept alongside as `model.mms-backup.onnx`), English = old MMS
  (intentional A/B), speaker visible (no hold flag exists — it renders wherever a
  bundled voice exists), BENCH_ON_LAUNCH=false, debug-keystore signed.
- Regression gate ran GREEN (45/45) before the build (standing rule).
- Build env gotcha: background shells lack JAVA_HOME/ANDROID_HOME —
  `export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home;
  export ANDROID_HOME=~/Library/Android/sdk` before `./gradlew assembleRelease` in
  `hiraia-unified/packages/mobile/android`. Clear
  `android/app/build/generated/assets/createBundleReleaseJsAndAssets` +
  `android/app/build/intermediates/assets/release` first (stale-bundle gotcha).
- On-device RTF for MB is **STILL UNMEASURED** (Luis away from the target Redmi; adb here
  sees only an emulator — meaningless for RTF). When home: flip BENCH_ON_LAUNCH=true,
  rebuild, push to /sdcard/Download + media-scan (MIUI blocks adb install), Luis taps,
  read logcat `[voice-bench]` lines. Target RTF <1 on a cpu cell.

## 6. Traps (each cost real time — do not relearn)

1. `pkill -f train_latest` AND `pgrep -f train_latest` self-match the ssh command —
   always bracket `[t]rain_latest`; RUNNING signal = GPU memory + log mtime, never pgrep.
2. Check log mtime vs `date -u` BEFORE trusting log contents (stale logs show old
   tracebacks).
3. ssh pattern: spell out options; `ssh host 'bash -s' <<'INNER'` (heredoc inside
   `ssh "..."` unescapes twice).
4. **Sampling the wrong architecture (the MS-garble incident):** mbistft_infer.py
   hardcodes its config at line 7 — synthesizing an MS checkpoint with the MB config
   "works" (utils.load_checkpoint is NON-STRICT and silently leaves mismatched layers
   random) and sounds hopelessly garbled. ALWAYS match config to checkpoint AND run one
   synth with stderr visible to see missing-key warnings. Off-pitch F0 (235–250 vs ~220)
   is a tell.
5. text/cleaners.py `VOCAB` is a HARDCODED tl charset — the en repo copy
   (/workspace/mbistft-en) has it regenerated from en symbols (38, pad='k'). Regenerate
   for any new language.
6. sendfile: ALAC m4a does not play on Android; files ≳1–2MB fail (`jq: Argument list
   too long`) — send native 16k PCM16 WAV (fits + lossless + universal).
7. AAC masks the buzz under judgment — decision listens must be lossless WAV.
8. pod images may lack rsync — use tar pipes.

## 7. Website (separate incident, RESOLVED tonight — see memory hiraia-web-brand-restore)

hiraia.org lost the Fraunces/wordmark branding (Sept-14 v0.4.0 deploy reset the VPS's
uncommitted tree). Restored: local presentation + VPS server code + VPS download.ts
(v0.4.0 rollback truth — the LOCAL copy is stale 0.3.5, never sync it), strays purged
(api/chats, api/messages, api/demo/chat re-introduced by rsync break the build), built,
verified live. **TRAP STILL ARMED: the serving tree is again uncommitted on the VPS** —
commit-to-git fix awaits Luis's approval.

## 7.5 Known issue for v0.4.10 (found 2026-09-16 morning, verified on emulator)

Language pick during an in-flight ENGINE model download is queued invisibly
(engineStore.ts loadQueue — the serialization is load-bearing, do not remove) and the
pending pick is NOT persisted: killing the app mid-queue silently drops it. Luis hit
this on ms1.apk. Fix for v0.4.10: persist requestedLanguage + show a pending state on
the sidebar chip, auto-apply when the queue drains. Switching is otherwise HEALTHY in
ms1.apk (verified visually on emulator, incl. during the image-pack installer).

## 8. After the fork resolves (the remaining pipeline)

1. Winner voice converges (tl) → lossless sample → Luis approves.
2. English retrained on the winning architecture (pod 1; if MS: copy the mbistft-en prep,
   flip config flags, rebuild warmstart is UNCHANGED — it fits MS 440/440 verbatim).
3. Export both voices (exporter above), fp16, swap assets, voice.json hashes.
4. Regression gate green → build → **device-launch check on the Redmi** (no gate catches
   native crashes — the v0.4.9 lesson) → RTF bench <1 → re-enable anything held →
   v0.4.10 (bump 0.4.10/versionCode 11), sign, publish (Cloudflare purge token expired:
   hiraia.apk alias edge cache lags ~4h; versioned key is immutable and safe).
