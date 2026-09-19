# TEACHER BUILD — native Filipino TTS teacher (rewritten 2026-09-16 ~23:15)

Voice-v2 program, Path B. Cross-lingual cloning FAILED Luis's ear ("Spanish intonation");
we are fine-tuning **Chatterbox v3 (MIT)** into a Filipino teacher, then will clone our
narrator through it and regenerate the student corpora (tl/en/ceb).

## CURRENT STATE (Sept 17 morning): STRESS RECIPE VALIDATED — awaiting pod approval for T7b-i
Luis verdict on stress run: "significantly better"; residual soft-stress errors (dugó
spoken DU-go DESPITE correct mark in input → conditioning under-trained, not lexicon).
NEXT (needs Luis spend OK): T7b-i "tightening iteration" — re-provision pod
(/tmp/teach-launch.sh pattern → new ep file), restore /workspace from local
~/Code/hiraia/finetuning/teacher/ + fsc-lj re-export or local copy, then LoRA rerun with
(a) OVERSAMPLE clips containing acute marks (duplicate marked-word clips ~3x in
metadata), (b) num_epochs 10→20. (~1.5h). Bench again; if dugó lands → teacher ready →
corpus generation (T8 diacritizer + 5k lines).

## OLD STATE (23:15): T7a stress run (COMPLETED — see below)
- Log `/workspace/ft2.log`, output `/workspace/ft-out-stress`, ~1,860 LoRA steps @1.4s/it.
- WHY: run-1 verdict (Luis) = pronunciation ALRIGHT / **lexical stress WEAK**. Tagalog
  stress is phonemic but UNWRITTEN, so run 2 trains on **diacritized transcripts** —
  stress made visible to the grapheme tokenizer.
- WHEN DONE → T7a-bench: DIACRITIZE the 6 bench lines FIRST (same
  lexicon+penult-default; script pattern inside /workspace — see t7 notes below), then
  `cd /workspace/chatterbox-finetuning && python inference_bench.py` (it auto-loads the
  newest cfg.output_dir adapter = ft-out-stress), pull `/workspace/ft-tagalog-bench.wav`,
  m4a → inbox + lossless `teach3.zip` → R2. Include the *katawán vs ka-TA-wan* question
  (Wiktionary says final stress; Luis expected penult — HE adjudicates the convention).

## Done so far
- T1 corpus stats: FSC = 274,730 rows; sentence-level read speech only **1.3h**;
  usable read+spontaneous ≈ **4.8h / 5,927 clips** → exported LJSpeech at
  `/workspace/fsc-lj` (T2).
- T3/T4: toolkit `gokhaneraslan/chatterbox-finetuning` set up; LoRA run 1 (1,860 steps,
  45min, `/workspace/ft-out/new_lang_adapter`). T5 bench emailed; lossless teach2.zip.
- T6 verdict → stress problem → T7a above.
- Stress lexicon built: `/workspace/tl-stress-lex.json` — **28,514 words** from
  kaikki.org Wiktionary extract (`/workspace/tl-wikt.jsonl`, 123MB). Diacritized
  metadata: `/workspace/fsc-lj/metadata-stress.csv` (20,941 marks; OOV = unmarked =
  penult default).

## Next after T7a bench
- [x] T7a-bench DONE 2026-09-17 ~00:00: stress-run sample emailed (teacher-STRESSRUN-tagalog.m4a) + lossless A/B teach3.zip. AWAITING LUIS EAR VERDICT on stress.
- [ ] T7b (gated on Luis + spend approval): full-FT / bulk-data plan. Data reality:
      FSC alone is too small for a production teacher. Bulk leads: open.bible CC audio
      for tl/ceb NOT yet confirmed (text yes; FCBH/archive.org audio is NOT freely
      licensed). Alternatives to scope: YouTube CC-licensed Filipino audiobooks/news?,
      commissioning recordings, or accepting LoRA-quality teacher + strong lexicon
      conditioning.
- [ ] T8 generation-time diacritizer: the SAME lexicon must diacritize any text we feed
      the teacher when generating the 5k-line student corpora (and the student then
      TRAINS on correctly-stressed audio while keeping plain-text input — stress becomes
      free for the on-device model).

## POD RELEASED 2026-09-17 ~01:10 (announced default: idle-at-gate overnight, all
artifacts local in ~/Code/hiraia/finetuning/teacher/). To resume: provision via the
/tmp/teach-launch.sh pattern, scp back adapters+lexicon+fsc-lj (or re-export from HF),
clone toolkit, pip chatterbox-tts + uninstall torchvision. ~10 min.

## Pod & traps (cold-start info)
- Pod `hiraia-sft-teach` (RTX A6000, ~$0.5/hr), ep `/tmp/teach-ep` "IP PORT",
  id `/tmp/teach-pod-id`. Do NOT delete/stop without Luis.
- Assets on pod: reference.wav (11.5s narrator), lines.txt (6 bench lines),
  chatterbox-finetuning/ (src/config.py CURRENTLY POINTS AT THE STRESS RUN:
  metadata-stress.csv / preprocess-stress / ft-out-stress), inference_bench.py
  (reads cfg → auto-uses newest output_dir).
- torchvision UNINSTALLED on purpose (torch-2.6 skew) — do not reinstall.
  datasets audio decode: use Audio(decode=False)+soundfile (torchcodec broken, removed).
- HF_TOKEN in ~/Code/hiraia/.env.local (never commit). ssh 'bash -s' <<'INNER'.
- sendfile ceiling ~700KB: WAV→44.1k→`afconvert -f m4af -d aac -s 3` (~250KB) to inbox;
  lossless zips via publish-release-assets.py --asset (immutable short names teachN.zip).
- Held-ssh python dies silently — ALWAYS nohup setsid pod-side + log file + gated waits.
