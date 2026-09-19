# VOICE V2 — strategy & live tracker (rev 2, 2026-09-17 ~15:4x; supersedes rev 1 + TEACHER-BUILD-TODO.md)

## Strategy in one paragraph
No open TTS speaks Filipino natively, so we BUILT a teacher: Chatterbox v3 (MIT) LoRA-
fine-tuned on the UP Diliman FSC (MIT) with STRESS-DIACRITIZED transcripts (28.5k-word
Wiktionary lexicon; acute on stressed vowel; unmarked = penult default). Iteration 2
("tight": targeted oversample of non-penult rows + 20 epochs) fixed katawán-class and
sounds "very crisp" (Luis), but OOV content words like dugó still miss — root cause:
dugó occurs ZERO times in the 4.8h sentence corpus and content-word stress coverage is
thin (function words dominate). Luis approved the "5-10% more" push (Sep 17): (1) mine
the FSC's WORD-LEVEL recordings (the bulk of its 313k utts we previously discarded) —
citation-form words directly teach the acute→stress association on thousands of content
words; retrain. (2) Build an acoustic STRESS VERIFIER and use it as an objective gate:
pick sampling temp with it (replaces the pending teach5 ear A/B — Luis delegated),
score teacher benches, and REJECTION-SAMPLE the generated corpus (re-render lines whose
stress lands wrong) so the students' corpus is near-perfect even where the teacher is
~90%. Then teacher+narrator generate the corpora, the proven MS-iSTFT student pipeline
retrains the on-device voices, ship after RTF + Luis's ear.

## Phases
- [x] P1 tightening iteration (Sep 17): 14,429-row unique-id oversample (preprocess
      DEDUPES by wav basename — duplicates need -d2/-d3 ids hardlinked!), 9,020 steps.
      Verdict: katawán fixed, crisp, dugó still off. Adapter LOCAL:
      finetuning/teacher/tight-run/new_lang_adapter. Benches: teach4/teach5 (temp A/B,
      unjudged — superseded by verifier) on assets.hiraia.org/models/.
- [x] EN CORPUS v2 COMPLETE + LOCAL (Sep 17 16:53): 3,941 wavs, 8.65h @16k, 0
      errors; full archive verified local finetuning/teacher/corpus-en-v2.tgz
      (774MB, 3,944 entries; partial dir cleaned). Sample teach6.m4a. (History:
      first pod spot-killed mid-download; regenerated remainder on pod 2.)
- [ ] P1b TEACHER v3 — TRAINING LAUNCHED 16:51 GMT+8 on pod 2 (213.192.2.119:40047):
      FSC mining done (excluded 157k 'machine' rows — unknown provenance; kept
      human-READ single-word clips, lexicon-covered only, 0.3–3s, cap 8 takes for
      the 578 non-penult words / 3 for penult): 6,276 word clips, 1,407 unique
      words. Sentence re-export exact (5,927). Combined metadata-v3.csv = 20,705
      rows (unique-id -d2/-d3 oversample of 4,251 non-penult sentence rows + word
      rows; word wavs hardlinked into fsc-lj/wavs). 15 epochs ≈ 9,705 steps →
      log /workspace/ft-v3.log, out /workspace/ft-out-v3; measured ~1.45 s/it
      (slower than tight run) → 9,720 steps ≈ 3.9h, ETA ~21:00 GMT+8.
      DONE 20:44 GMT+8: 9,720/9,720, adapter saved + pulled LOCAL
      (finetuning/teacher/v3-run/new_lang_adapter + v3-bench.wav). Bench
      teach7.m4a on assets.hiraia.org: 2 blocks (temp 0.8 then 0.5), each =
      6 stress lines + 4 OOV sentences (dugó/balát/bulaklák + bundók control).
      AT GATE 3: Luis's ear — v3 vs v2 on dugó + OOV words, and which temp.
      TL GEN RUNNING since 20:45 (3 shards — the 2-shard sed edit landed on a
      new inode while the armed script kept the old one; VRAM 15/24GB, fine):
      temp 0.5, corpus-lines-tl.marked.txt → /workspace/corpus-tl-v2,
      ETA ~01:00-02:00 overnight; pull archive at completion. Ear gate holds
      before P4 student training.
- [x] P2v STRESS VERIFIER — FAILED VALIDATION, DROPPED (Sep 17 16:30): v1
      hand-weighted prominence 54.0% on 5,790 ground-truth FSC word clips
      (final 53.6 / penult 54.3 / earlier 63.2); learned logistic scorer 69.3%
      held-out but the position feature dominates (w=3.1 vs ≤0.6 acoustic) —
      it learned the dataset's final-stress prior, not the acoustics, so its
      flags would systematically punish penult words. NOT usable as a
      rejection gate. (librosa segfaults on pod — verifier was numpy/scipy;
      scripts /workspace/stress_{verify,learn}.py if ever revisited; a
      whisper-alignment approach is the LATER idea.) CONSEQUENCE: P3 tl gen
      uses teacher v3 + temp 0.5 default (lower temp = more cue-faithful;
      teach5 A/B still available if Luis wants to pick by ear), no rejection
      sampling; QA = ear spot-check sample + optional stubborn-word override
      list if v3 still misses.
- [ ] P3 CORPORA: en = finish 3,941 (resume, temp 0.8 as generated). tl = 4,016 lines
      (corpus-lines-tl.marked.txt through teacher v3 at verifier-chosen temp) with
      REJECTION SAMPLING: lines containing final-stress content words get verified,
      failures re-rendered with new seed (cap ~3 tries). PULL ARCHIVES OFF POD
      IMMEDIATELY per batch (spot-kill lesson). Also refresh teacher ear sample for
      Luis (teachN) from v3.
- [ ] P4 STUDENT RETRAIN (STAGED, chains after tl gen): GATE 3 PASSED — Luis
      (Sep 17 ~21:20): "maybe this is the best we can do... finalize this model"
      → teacher FROZEN as hiraia-teacher-tl-v1 (local v3-run/ + R2
      models/hiraia-teacher-tl-v1.tgz). Plan: CONTINUE-TRAIN the shipped
      v0.4.11 students (not MMS warmstart): tl from ms-tl G_20000+D_20000
      resume → ~+8-10k steps; en from ms-en G_15000+D_15000 → same; BOTH in
      parallel on the current pod (VITS training is CPU-bound ~1 step/s).
      Staged: /workspace/p4_setup.sh (clone MasayaKawamura/MB-iSTFT-VITS ×2,
      monotonic_align build, symbols.py per lang UNCHANGED [embedding ids!],
      hiraia_cleaner appended [lowercase+VOCAB filter, phonemizer import
      stripped], configs, checkpoints into logs dirs, en filelists) then
      /workspace/p4_chain.sh (wait tl gen → tl filelists from UNMARKED
      corpus-lines-tl.txt by index [metadata.csv holds MARKED text!] → tar
      TL_READY → launch train_latest.py both). Logs /workspace/train-{tl,en}-v2.log.
      TL CORPUS FINAL: 3,822/4,016 wavs (95.2%; 194 lines lost to forced-EOS
      even per-sentence — acceptable), archive LOCAL corpus-tl-v2.tgz (3,825
      entries). BOTH TRAININGS LIVE since ~05:30 Sep 18 (GPU 98%) after
      peeling four legacy-repo layers (record: torch.stft needs
      return_complex=True + view_as_real; librosa mel() keyword-args; both
      train scripts hardcode MASTER_PORT 65520 → en bumped to 65521;
      matplotlib tostring_rgb → buffer_rgba). CHECKPOINT NUMBER INFLATION on
      resume: epoch restored from ckpt and global_step = epoch ×
      NEW-loader-len → tl saves as G_75xxx (≈ shipped-20k + new), en G_57xxx
      (≈ shipped-15k + new); tl ~227 steps/epoch, en ~234. Pruner keeps
      newest 4 ckpt pairs per run (prune-ckpts.sh, 5-min loop).
      SAMPLES AT +6k (teach-tl-v2/teach-en-v2/teach8.zip published). LUIS
      VERDICT (Sep 18 ~08:25): en "intelligible, a bit buzzy, 95% of what
      we're aiming for"; tl "completely garbled". DIAGNOSIS (objective,
      settled): shipped G_20000 through our exact sampler = F0 222 (perfect)
      → sampler/repo/symbols fine, resume was clean, losses sane. The TL
      CORPUS is VOICE-INCONSISTENT: per-clip F0 medians 172–242 (6-semitone
      wander; narrator 220) because the LoRA teacher's speaker anchoring is
      weak in tl, while EN corpus (native cloning) clusters 205–235 → en
      student fine, tl student collapsed averaging many voices. tl student
      training STOPPED (broken target); en continues. teach9.m4a = 8 raw tl
      corpus clips for Luis to confirm (individually fine, voice wanders).
      FIX EXECUTED (Sep 18): rejection-regen was too slow (~33% first-pass
      accept ≈ 27h) → pivoted to WORLD PITCH NORMALIZATION (pyworld
      harvest/cheaptrick/d4c, f0 scaled so median = 220; clips already in
      [203,237] copied) — corpus-tl-v3: 3,809 clips, ALL F0 219-235 (only
      514/3,809 were naturally in-band — the wander was worse than sampled).
      normalize_pitch.py in /workspace + /tmp. EN STOPPED at +7.7k
      (latest G_64000 retained, pruner keeps 4). TL RESET to shipped
      G_20000/D_20000 + v3 filelists (3,619/190) → RETRAINING solo since
      08:55, full GPU ≈ 1.5 steps/s → +6k ≈ 1.2h → sample ~10:30 GMT+8.
      Then: Luis gate on new tl sample → export BOTH (HANDOFF §4) → P5.
      TEACH10 VERDICT (Luis, Sep 18 ~11:15): tl = "gibberish — cadence
      plausibly Tagalog but random syllables". REAL ROOT CAUSE (objective):
      TEXT↔AUDIO MISALIGNMENT in the tl corpus — teacher v3's early
      forced-EOS silently TRUNCATED ~half the renders: chars-per-sec en =
      12.4–16.3 tight (faithful), tl = median 25, p95 90, 49.7% of clips
      >25cps (audio fragments paired with FULL transcripts). Pitch was a
      red herring symptom; the student learned misaligned pairs → gibberish.
      FIX v4 (running since ~11:30): filter to ALIGNED clips only (cps
      9–19 + dur ≥0.6s) = 1,408 clips (1,338/70 filelists — still 40% more
      than the 960-clip corpus behind the shipped voice); tl student reset
      to shipped G_20000/D_20000 AGAIN, retraining (~84 steps/epoch, +6k ≈
      75 min → sample ~12:50 GMT+8). LESSON for any teacher-corpus gen:
      VALIDATE cps per clip at generation time (accept 9–19), per-sentence
      render for long lines. LATER top-up: re-render the 2,401 misaligned
      lines per-sentence with per-sentence cps checks if v4 needs more data.
      (v4 launch tripped EADDRINUSE 65520 again — orphaned multiprocessing
      child of the killed v3 run held the port; ss -tlnp + kill -9. ALWAYS
      check port holders after killing a train_latest.)
      V4 SAMPLES OUT: teach11 (early +2.9k) and TEACH12 (+5.9k, G_38000,
      stress+OOV lines, m4a + lossless zip) — AT GATE with Luis. Checkpoints
      G_tl_v4_38000 + G_en_64000 + G_tl_81000 banked in
      finetuning/tts-vocoder/v2-students/. Training STOPPED at 41,800
      (+9,700; overfit cap). POD 3 TERMINATED ~14:55 Sep 18 per announced
      idle-at-gate default — EVERYTHING needed is local: checkpoints
      (v2-students/: G_en_64000, G_tl_v4_38000, G_tl_v4_41500, G_tl_81000),
      both corpora tgzs, teacher adapter, and the EXPORTERS persisted from
      /tmp into finetuning/tts-vocoder/ (export_ms_{tl,en}.py, export_mb_tl.py,
      ms_sample.py, normalize_pitch.py, gen_corpus.py, gen_mop.py). ONNX
      export is CPU-ONLY → no pod needed for P5 unless another retrain is
      required.
      TEACH12 VERDICT (Luis): "a few words, overall like a different
      language, Tagalog cadence". TEACH13 (5 RAW aligned teacher clips +
      transcripts) VERDICT: "sounds good" → DATA INTELLIGIBLE, mapping
      verified clean (voice.json ≡ symbols.py id-for-id) → prime suspect =
      TRAINING REGIME: resume LR 1.9e-4 ≈ 10× the community norm (2e-5 per
      ylacombe/finetune-hf-vits + low-resource TTS papers) cooked the tl
      text encoder; en survived on 2.8× data. BEST-PRACTICE GAP found in
      research pause (Luis-requested): synthetic corpora are normally
      ASR-CER-GATED (~10% threshold) — we never did.
      NOW RUNNING (LOCAL Mac, no pod): rebuild corpus-tl-v3 (pyworld,
      /tmp/regen_v3_local.py → /tmp/tlv3/wavs, log /tmp/regen-v3.log) →
      chained Whisper CER audit (faster-whisper small int8, language=tl,
      /tmp/cer_audit.py → /tmp/cer-results.json, log /tmp/cer-audit.log,
      ~1.5-2h; venv /tmp/audioenv NOTE py3.14 + setuptools<81 for pyworld).
      DECISION RULE: ≥1,500 clips CER≤0.12 → ONE retrain at LR 2e-5 on the
      CER-gated set (short pod, ~$2-3, flagged to Luis) → sample → gate.
      ELSE → ship EN-ONLY (en v2 export, tl keeps shipped voice), Tagalog
      stress later via MMS-tgl fine-tune (documented recipe).
      P5-EN is UNBLOCKED EITHER WAY: export G_en_64000 via
      finetuning/tts-vocoder/export_ms_en.py (CPU) when ship prep starts.
      AUDIT VERDICT (Sep 18 16:1x): EN calibration median CER 0.000
      (145/150 ≤0.12) → judge trusted. TL: median CER 0.454, only
      1,120/3,809 (29%) ≤0.12 → BELOW the 1,500 bar. BRANCH TAKEN: EN-ONLY.
      Chatterbox-teacher tl corpus declared unsalvageable at scale (half
      off-transcript; teach13's 5 clips were from the passing ~30%).
      cer-results.json copied to finetuning/teacher/. Tagalog: SHIPPED VOICE
      STAYS (v0.4.11 MS student); future stress work = fine-tune MMS-tgl on
      stress-diacritized FSC (finetune-hf-vits recipe, LR 2e-5) — a
      documented, stable path. (A 1,120-clip CER-gated retrain remains a
      possible cheap experiment later; parked deliberately.)
      P5-EN EXECUTED LOCALLY (Sep 18 ~16:10): export via
      /tmp/export_ms_en_local.py (repo /tmp/mbistft-en, py3.14 audioenv +
      torch/onnx/onnxscript; NOTE new dynamo exporter → opset 18 [Pad blocks
      17-downgrade; ORT-RN 1.24 supports 18] + external-data → consolidated
      single-file). PARITY PASS: inverse 2.24e-07, torch-vs-ORT 1.53e-05.
      fp16 via hiraia-unified scripts/voice/fp16-weights.py → 56.3MB; ORT
      synth verified through the APP tokenizer path (voice.json vocab +
      blank-interleave). ASSET SWAPPED in hiraia-unified
      assets/voices/en/model.onnx (+ voice.json sha256 b9b22875…; old model
      kept as model.v0411-backup.onnx; UNCOMMITTED). teach14.m4a = the
      actual fp16 file speaking — AT GATE with Luis. Remaining ship steps:
      regression gate → build → DEVICE-LAUNCH check (opset 17→18!) → EAS
      re-sign → publish + site 0.4.13.
      BUILD 0.4.13 DONE (Sep 18 ~16:20, Luis-ordered, COMBINED with the
      parallel agent's Tala classroom-sync branch student-tala-nearby in
      hiraia-unified: expo-camera + hiraia-tala native module +
      withTalaNearby plugin; its TALA-SETUP.md lists unverified
      physical-device scenarios — NOT classroom-ready, doesn't block voice
      ship). Chain: qa:tala 0 fails + qa:voice 11/0 + regression gate ALL
      PASS → version 0.4.13/13 → pnpm install → pnpm prebuild →
      build-apk.sh → verified (both voices in APK as res/*.onnx [obfuscated
      names — en = 56,328,461 bytes = NEW model], CAMERA perm, nearby lib,
      no stale onnx) → zipalign + apksigner EAS re-sign (cert 40d750d5…
      matches live) → PUBLISHED assets.hiraia.org/models/v13.apk (437MB,
      short name for manual typing). AT DEVICE-CHECK GATE: Luis installs,
      verifies launch (opset 18), en read-aloud, QR scanner opens, update
      banner. THEN: publish hiraia-v0p4p13.apk + flip hiraia.apk alias +
      site download.ts local+VPS (edit VPS in place, NEVER copy local over)
      + manifest so 0.4.12 devices see the banner.
- [x] P5 SHIPPED as v0.4.13 (Sep 18 ~17:30): device check PASSED (en works,
      launch fine on opset 18; tl = old voice BY DESIGN). Published
      hiraia-v0p4p13.apk + hiraia.apk alias (both live, 437,878,078 bytes,
      sha256 4f2195cd…), site + VPS download.ts at 0.4.13 (VPS edited
      in place, rebuilt — pm2 name is hiraia-web NOT web; a wrong name
      triggered a false rollback once), manifest serves versionCode 13 →
      0.4.12 devices get the banner. UNCOMMITTED in both repos (commit when
      Luis asks). PROGRAM COMPLETE except: Tala physical-device scenarios
      (per TALA-SETUP.md), Tagalog stress via MMS-tgl fine-tune (parked),
      Redmi RTF bench (still owed from vocoder era).
      Original P5 spec: swap voice assets + voice.json hashes, gate green, build, EAS re-sign,
      publish + site bump.
- [ ] LATER: Cebuano (no ceb speech data yet); katawán-class convention overrides if
      Luis's ear ever disagrees with Wiktionary; retire respelling hacks if v3 nails
      OOV.

## Cold-start facts (pod & pipeline)
- Provision: /tmp/teach-launch.sh (SECURE cloud, on-demand) → /tmp/teach-ep
  ("IP PORT") + /tmp/teach-pod-id; current = POD 3 (194.68.245.215:22033, log
  /tmp/teach-launch4.log). ROOT CAUSE of both Sep-17 pod deaths = OUR OWN
  cost guard: config key "hiraia-sft" is EXACT (no glob) → "hiraia-sft-teach"
  fell to the 6h DEFAULT ceiling; VPS log /var/log/hiraia-monitor.log showed
  "age 6.0h exceeds ceiling". Pod 3 is named EXACTLY hiraia-sft → 20h. Never
  modify the VPS guard config; read it at /opt/hiraia-monitor/config.json.
  NEVER delete a pod without Luis EXCEPT announced idle-at-gate default. Still
  pull artifacts THE MOMENT a batch finishes.
  Pod 3 restore: /tmp/pod3-restore.sh (uploads teacher adapter + en corpus tgz
  + P4 checkpoints + line files, chatterbox stack, relaunches tl gen 3 shards
  FROM ZERO [pod 2's 1,050 tl wavs lost], re-stages p4_setup + p4_chain).
  Pod-3 incidents FIXED (22:30-22:40): (a) gen_corpus --adapter imports
  inference_bench2.py — must be recreated per pod (sed from inference.py);
  (b) p4_chain raced during the dead-shard window (built empty filelists,
  launched+crashed both trainings; checkpoints untouched) → chain now GUARDS
  on ≥3,800 tl wavs before proceeding; (c) scipy 1.17 removed
  scipy.signal.kaiser → patched pqmf.py in BOTH checkouts to
  scipy.signal.windows.kaiser (models import verified). tl gen relaunched
  22:35, ETA ~02:45 GMT+8.
- Restore: bash /tmp/teach-restore.sh (also in finetuning/teacher/) after teach-ep is
  written — uploads reference.wav, line files, en-recovered.tgz (/tmp), adapter →
  /workspace/ft-out-tight/new_lang_adapter, installs chatterbox-tts (then UNINSTALL
  torchvision+torchcodec), clones gokhaneraslan/chatterbox-finetuning, setup.py,
  wires src/config.py (output_dir /workspace/ft-out-tight, prompt
  /workspace/reference.wav), resumes en gen 3 shards, prints the tl command.
- gen_corpus.py (finetuning/teacher/ + uploaded by restore): --lines --out --prefix
  [--adapter] [--shard K N] [--temp T]; per-line seed=line-index, 16k resample, VAD
  trim, skip-existing resume, LJ metadata rewritten at end (rebuild once after ALL
  shards exit).
- Datasets: Audio(decode=False)+soundfile (torchcodec broken). fsc-lj sentence export:
  t2 recipe → 5,927 clips fsc-{n:06d} MUST match metadata-stress.csv naming/order.
- Training: config = src/config.py dataclass; train.py; nohup setsid ALWAYS + gated
  waits (held-ssh python dies silently, exit-255 notifications = zombies, verify
  pod-side). pkill -f needs bracket trick AND must not appear in your own ssh cmdline.
  Trainer checkpoints are FULL state (not PEFT dirs) — only new_lang_adapter reloads.
- Local artifacts (finetuning/teacher/): tight-run/new_lang_adapter (382MB, teacher
  v2), stress-run/ + run1/ (older), tl-stress-lex.json (word→0-based stressed-vowel
  idx), metadata-stress.csv (5,927 rows), lines-stress.txt, corpus-lines-{tl,en}.txt +
  corpus-lines-tl.marked.txt (curate-lines.mts — tsx, seeded; imports the app's REAL
  normalizeForSpeech from ../hiraia-unified/packages/mobile/src/voice/normalize.ts;
  numbers are ENGLISH by design), diacritize.py (0/500 round-trip mismatches vs
  training data), corpus-en-v2-partial/ (2,237 wavs), corpus-en-v2.tgz (TRUNCATED —
  replace when regenerated). HF_TOKEN + RUNPOD_API_KEY in .env.local (never commit).
- Deliverables: m4a = 44.1k upsample + afconvert m4af aac -s 3; publish via
  ~/.venvs/hiraia-publish/bin/python deploy/publish-release-assets.py --env-file
  .env.cloudflare.local --asset FILE (immutable teachN names on assets.hiraia.org).
  sendfile --yes is BLOCKED by the permission classifier in this session — use R2
  URLs and tell Luis.
- Gates: teacher v3 ear sample → Luis; P4 student bench → Luis; new pod spend beyond
  this approved session → Luis. ETAs in GMT+8.

## PHASE 2 — OMNIVOICE ERA (approved by Luis, Sep 18 ~late evening)
Teacher audit (workflow wf_5cea9365, 40+ models, adversarially verified)
found k2-fsa/OmniVoice (0.6B, CC-BY-NC weights — LUIS CLEARED NC for this
nonprofit): NATIVE Filipino (FLEURS CER 1.24 beats real recordings) AND
Cebuano (12h, CER 1.81), zero-shot cloning, pip install omnivoice, Apple-MPS
capable. Local test teach15: pack CER 0.025 (vs Chatterbox corpus 0.454),
Luis: "quality is good but the lexical stress needs work". teach16 marked-vs-
unmarked A/B: marks move stress only "slightly" natively → LoRA fine-tune
per k2-fsa's OFFICIAL recipe (examples/run_finetune_lora.sh; JSONL manifest
{id,audio_path,text,language_id}; init k2-fsa/OmniVoice, 5k steps, lr 5e-5).
Runners-up if OmniVoice disappoints: VoxCPM2 (2B Apache, native fil,
benchmarked), MOSS-TTS-v1.5 (8B Apache, fil in training data). Higgs TTS 3
= best fil+ceb quality but anti-distillation clause (hard no). Full audit in
the wf_5cea9365 journal.

TONIGHT'S PROGRAM (pod 4 = hiraia-sft, A6000 $0.33/h, 38.147.83.31:25163):
1. [running] omni-setup.sh: deps → fsc_export_all.py (5,927 sentences +
   6,276 word clips, MARKED transcripts) → JSONL manifests (fil, 2% dev) →
   nohup run_finetune_lora.sh → /workspace/omni-ft-fil, log /workspace/omni-ft.log.
2. After fine-tune: teach17 bench = marked-vs-unmarked A/B + stress lines
   with the LoRA model (loading method TBD from repo docs — likely
   from_pretrained(OUTPUT_DIR)) → publish → LUIS MORNING GATE.
3. Overnight GPU: (a) CEBUANO LIBRARY — corpus-lines-ceb.txt (4,000 lines:
   3,200 bis facts + 800 questions) with BASE OmniVoice, narrator ref,
   native stress, gates = cps 9–19 + dur (NO whisper-ceb — flagged to
   Luis; omnilingual-asr spot-check later) → /workspace/corpus-ceb-v1;
   (b) EAGER tl corpus with the LoRA teacher + MARKED lines
   (corpus-lines-tl.marked.txt) + inline whisper-CER gate ≤0.05 →
   /workspace/corpus-tl-omni. Bank at native 24k; downsample per use.
4. INCREMENTAL PULLER live on the Mac (/tmp/pull-loop.sh, 5-min cycle,
   marker-based tar batches → finetuning/teacher/omni-bank/, log
   /tmp/pull-loop.log) — nothing lost to pod death/kill.
5. Heartbeat hiraia-voice-v2d */20 drives the chain; pod down at session
   end after final pull.
Cold-start: omnivoice generate(text=,language='fil'|'ceb',ref_text=,ref_audio=)
returns list[np 24k]; ref-text = whisper transcript of reference.wav
(/workspace/ref-text.txt); train wavs at FSC native sr are fine (recipe
tokenizes). OmniVoice voice-design mode is zh/en-only — use cloning mode.

UPDATE (Sep 18 ~22:45, Luis): FINAL-LIBRARY sizing — never revisit this.
Targets raised to ~6,000 KEPT clips PER LANGUAGE. Line pools expanded +
uploaded to pod: corpus-lines-tl(.marked).txt now 7,520 lines
(curate-lines.mts TARGET_FACTS 7200/QUESTIONS 1600; old 4,016 file backed
up as *.4016.bak), corpus-lines-ceb.txt now 6,600 (old 4,000 backed up).
Generation must be BATCHED (generate() list inputs, batch 8-16) to
saturate the A6000; a SECOND pod is pre-approved if throughput projects
past 08:00 GMT+8. Heartbeat replaced: hiraia-voice-v2d id 0f2fff30
(rev 4.1). en corpus stays at 3,941 (Luis happy at 95%).
POD-4 SETUP FIXES (23:00): omnivoice TRAINING needs: pip install -U torch
(transformers 5.17 requires torch>=2.5; image ships 2.4 → silent no-torch
mode → 'nn' NameError), THEN pip uninstall -y torchvision (stale build vs
new torch — the classic), THEN pip install peft (LoRA dep not in their
requirements). FT RUNNING since 22:56: 5,000 steps @ ~1.0s/it, loss 4.4→,
ETA ~00:25 GMT+8, GPU 97%.
LUIS (23:1x, pre-sleep): teach17 is NOT a blocking gate — fine-tune then
proceed DIRECTLY to clip generation. teach17 still gets published as a
morning receipt. Morning gates remaining: corpus quality → student
retrain decision.

## PHASE 3 — STUDENT RETRAIN (Luis GO, Sep 19 ~08:40)
teach17 VERDICT: "B samples definitely better, other sentences strong" →
FINE-TUNED TEACHER APPROVED (acute marks now move stress decisively).
Overnight results: CEB LIBRARY DONE+LOCAL 8,407/8,407 clips (100% cps-gate
acceptance, base OmniVoice, pod 5 terminated after verified pull). TL: 6,300+
CER-gated clips (≤0.05, zero drops), retry tail finishing on pod 4.
Overnight fixes recorded: batch padding needs tail-trim before gating; ceb
line file had 1,808 embedded-newline empties (fix curation to strip \n in
facts); pod 5 needed the same torch>=2.5 upgrade; fast decode num_step=16
via OmniVoiceGenerationConfig ~2x; solo-GPU batch16 rates: tl ~16/min
(with whisper gate), ceb ~30/min.
NOW: sequencer /workspace/train-after-gen.sh on pod 4 flips gen→student
training automatically (tar+TL_OMNI_READY → 16k downsample → filelists
unmarked → train_latest resume from shipped G_20000/D_20000, en-proven
regime). Heartbeat hiraia-voice-v2e id 9b778ce5 (rev 5) drives: monitor →
teach18 sample at +6k → Luis gate → pod down → local CPU ONNX export →
ship steps (Luis-triggered). Corpus archives: corpus-tl-omni.tgz pulled
local at TL_OMNI_READY; ceb already at omni-bank/corpus-ceb-v1.

PHASE 3 CLOSE-OUT (Sep 19 ~12:00): teach18/19 "weak Tagalog" was a BENCH
BUG — the student was fed MARKED lines whose accented vowels its charset
silently DELETES ("dugó"→"dug"); Luis caught it by ear. Standing rule:
STUDENT benches always use UNMARKED text (the teacher reads marks, the
student never does). teach20 (plain text, G_135000): Luis — "wow that
really fixed it... understand every word... only minor lexical stress
errors; a bit buzzy" = PASS. Training stopped +8.8k, pod 4 TERMINATED
(all pods down, program GPU spend over). Local CPU export done: parity
2.24e-07 / 4.65e-05, fp16 56.3MB; noise 0.4-vs-0.33 A/B (teach21)
imperceptible → kept 0.4. Buzz answer: architecture floor, not
undertraining; future lever = 24k/bigger student (corpus banked at 24k).
ASSET STAGED: hiraia-unified assets/voices/tl/model.onnx swapped (sha256
28d68857…, old kept as model.v0411-backup.onnx). teach22 = OLD-shipped vs
NEW A/B, AT LUIS'S FINAL GATE. On go: 0.4.14 ship chain (gate → build →
device check → sign → publish + site). Artifacts all local:
v2-students/{G_tl_omni_132500,135000,.pth, tl-omni-model(.ln033).fp16.onnx},
corpora tgzs (tl 6,548 / ceb 8,407 / en 3,941), teacher merged ckpt on
old pods is GONE but LoRA adapter + base = reproducible
(omni-ft-fil-adapter/ local).

## SHIPPED — v0.4.14 (Sep 19 ~12:40 GMT+8): THE VOICE-V2 PROGRAM'S RELEASE.
teach22 old-vs-new verdict: "the new model is definitely better" → gate
42/0 GREEN → build (TRAP: version bump in app.json does NOT reach gradle
without prebuild — asset-only builds must edit android/app/build.gradle
directly; first build came out versionCode 13, rebuilt) → verified
0.4.14/14, both distilled voices in APK (tl 56,346,485 / en 56,328,461),
cert 40d750d5 → published hiraia-v0p4p14.apk + hiraia.apk alias + v14.apk
(433,302,846 bytes, sha256 b0ba8b17…) → site + VPS manifest at 0.4.14.
Both on-device voices are now OmniVoice/Chatterbox-distilled students;
Cebuano library (8,407 clips) banked for the future ceb voice. Uncommitted
in both repos (commit on Luis's word).
