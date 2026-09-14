# Text-to-speech

Hiraia reads cards aloud. Many users read below grade level — the reason `gradeLevel 5`
is the default — so this is closer to core accessibility than to a nice-to-have.

**Shipping:** a voice we trained ourselves, bundled in the APK and run on-device.
`src/voice/` + `src/speech.ts`.

## Why not the OS engine

The first version of this used Android's `TextToSpeech` through `expo-speech`, on the
assumption that the Filipino (`fil-PH`) voice works offline. **It does not.** On the
devices this app is built for, `fil-PH` is a *network* voice: with no connection the
engine returns error -4 and says nothing. Offline is not an edge case here — it is the
normal case — so the OS engine cannot be the read-aloud path at all.

Everything else on the table was worse:

| | APK cost | Money | Offline | tl | ceb | en |
|---|---|---|---|---|---|---|
| **Bundled MMS-VITS (ours)** | **114 MB / voice** | **0** | **yes** | **yes** | soon | **yes** |
| OS engine (expo-speech) | ~0 | 0 | **no (fil-PH is network-only)** | — | — | yes |
| QVAC Chatterbox MTL | ~2.0 GB | 0 | yes | **no** | **no** | yes |
| QVAC Supertonic | ~263 MB | 0 | yes | **no** | **no** | yes |
| Piper (rhasspy voices) | ~60 MB + espeak | 0 | yes | **no voice exists** | **no** | yes |
| Pre-rendered audio | ~1.2 GB¹ | 0 | yes | yes | yes | yes |
| Cloud TTS | ~0 | per-call | **no** | yes | no | yes |

¹ 49k cards × 3 languages × ~8 s at 8 kbps Opus. Beside the art pack, not viable.

**QVAC** (checked 2026-09-14, SDK 0.13.1) does ship TTS — `@qvac/tts-ggml` and
`@qvac/tts-onnx`, wrapping Chatterbox and Supertonic — but Chatterbox MTL covers
`es/fr/de/pt/it/zh/ja/ko/…` and Supertonic is English-only. Neither has a Philippine
language, the weights dwarf the app, and Android is pinned to CPU there anyway.

**Piper** has 176 voices across 57 languages and **zero Philippine languages**, because
its phonemizer (espeak-ng, 129 languages) has none either. Piper is the right *runtime*
and the wrong *inventory*.

## The voice we actually ship

Meta's **MMS-TTS** is the only family with Tagalog and Cebuano checkpoints. They are VITS
models, 36.3 M parameters, 16 kHz, **character-level** — no phonemizer, no espeak data,
which is what makes the on-device runtime so small. The catch: one single-speaker
checkpoint per language, trained on New Testament readings, and the Tagalog speaker is
**male** (measured: 114 Hz median F0). A male narrator was not what this app wanted.

So the voice was rebuilt:

1. **A script from our own content** — `/tmp/build-vo-scripts.py` pulls ~10 000 words out
   of the shipped fact bank, quiz bank and recap verbiage: every grade 3-10 with a lean to
   3-6, a fact/question/option/explanation mix so the voice hears interrogatives and short
   fragments too. Digits, brackets, emoji and markup are excluded outright — the printed
   line has to be exactly what is said, or transcript and audio desynchronise.
2. **A teacher voice** — VoxCPM2 (Apache-2.0, voice-design prompts + zero-shot cloning)
   reading that script as *"a 40-year-old Filipina woman, a warm and patient elementary
   school teacher."* Gender and pace are not steerable by prompt, so both are handled by
   measure-and-select: an F0 gate rejects male takes, and best-of-3 picks the take nearest
   the target words-per-minute. Nothing is time-stretched — it destroys the audio.
3. **Fine-tune MMS on that corpus** — 975 clips at 16 kHz, `ylacombe/finetune-hf-vits`,
   12 200 steps. Median F0 moved **114 Hz → 220 Hz**: same 36 M-parameter model, our
   narrator.
4. **Export to ONNX** — `scripts/voice/export-onnx.py`: drops the discriminator (which is
   most of the checkpoint and none of the inference path), traces on a real sentence, and
   emits `input_ids` + `attention_mask` in, float waveform out. It forces the **legacy
   TorchScript exporter**: torch >=2.9 defaults to the dynamo path, which cannot get past
   VITS's spline flow because that code branches on `torch.min(inputs) < lower_bound`, a
   data-dependent condition dynamo refuses to guard on. Tracing follows the branch the
   sample takes, which is right here — the bound check is a guard, not a code path.

English got the same treatment for the same reason: `mms-tts-eng` measures **101 Hz** over
six sentences × three seeds — more male than the Tagalog base — and it is the only English
checkpoint MMS ships. Its corpus was voice-**cloned** from a clip of the Tagalog corpus
(VoxCPM2 `reference_wav_path`) rather than re-prompted, so the app has **one narrator
across languages** instead of two strangers. 1023 clips, 1.03 h, 12 800 steps; median F0
**101 Hz → 229 Hz**, within 10 Hz of the Tagalog voice's 220 Hz.

### The pad token is not the same letter in every language

MMS assigns the pad token **id 0**, and *which letter holds it differs*: `"a"` in Tagalog,
`"k"` in English. The vocabularies differ in size too (44 vs 39). Hardcoding the Tagalog
letter costs nothing on Tagalog and silently destroys English — `a` is an ordinary letter
there (id 26), so every word would be interleaved with a spoken "a". Only the **id** is
stable, which is why `package-voices.py` asserts exactly one symbol holds id 0 and the
tests check both shipped vocabularies.

### Licensing

MMS is **CC-BY-NC-4.0**. Non-commercial is fine — Hiraia is not-for-profit — but the
**BY** half is an obligation: Meta's MMS must be credited wherever the voices are
described. VoxCPM2 is Apache-2.0 and imposes nothing.

## Sizes and speed

Measured on a Mac (2 threads, full graph optimisation), same English model, same inputs:

| export | file | in APK (deflate) | RTF | notes |
|---|---|---|---|---|
| fp32 | 114.3 MB | 105.2 MB | 0.267 | the export as produced |
| **fp16 weights** | **58.4 MB** | **53.1 MB** | **0.265** | **what ships** |
| int8 dynamic | 38.5 MB | 27.8 MB | 0.675 | 2.5x SLOWER |

**fp16 is free.** `scripts/voice/fp16-weights.py` rewrites only the stored initializers to
fp16 and fronts each with a `Cast` back to fp32; no op changes dtype, and ORT's constant
folding collapses `Cast(constant)` at session load. So the file halves while inference runs
the identical fp32 kernels — 0.265 vs 0.267 RTF is noise. Precision cost is 0.043% of a
tensor's own scale at worst, 73.7 dB weight SNR.

It is deliberately NOT `convert_float_to_float16`, which rewrites op dtypes as well: on
this graph that produced a `Cast` output-type mismatch ORT refuses to load, and on 6k nodes
it ran longer than writing the replacement did.

**int8 is the trap.** Quantisation is normally the thing you reach for, and it does not
hurt quality here — measured against the same model it matches fp32 on F0 and RMS. It is
simply slower: ORT's quantised convolution kernels want ARM dot-product (`sdot`, ARMv8.2)
or `i8mm` instructions, and the SD685 we target is **ARMv8.0 with neither** — the same gap
that makes its LLM prefill slow. So it pays unpack/requantise overhead on convolutions that
were already memory-bound. Keep it on the shelf unless an on-device test says otherwise.

### What RTF means here

RTF is synthesis time divided by the duration of audio produced, so 0.27 means a second of
speech costs a quarter-second of compute. It sets three things, none of which is audio
quality: the wait after a tap (RTF x the FIRST sentence, because `player.ts` chunks);
whether later sentences render faster than they play, so the card streams without gaps
(RTF < 1) or drifts apart (RTF > 1); and roughly what fraction of a CPU core is burned
while reading, which on a throttling phone is a thermal question too.

### Footprint

Two voices, fp16: **117 MB in the APK**, and 234 MB of device storage once each is copied
out on first run. (fp32 would have been 229 MB and 458 MB — as much as the whole art pack.)
The copy is unavoidable: inside the APK the model is a compressed zip member addressed as
`file:///android_asset/...`, and onnxruntime needs a real path.

Note that neural weights barely compress — fp32 deflates to 92% of raw, fp16 to 91%. The
APK entry is essentially the file size, so the format IS the download.

## Where it lives

- `src/voice/tokenizer.ts` — the character tokenizer. Three details from the checkpoint's
  `tokenizer_config.json` are load-bearing and fail silently rather than loudly: the pad
  token is the literal character `"a"` at id 0, `add_blank` interleaves it around every
  token, and `normalize` lowercases and drops anything outside the vocabulary.
- `src/voice/engine.ts` — the voice registry, the copy-out-of-the-APK step, one
  onnxruntime session per language.
- `src/voice/player.ts` — chunking, the WAV files, the playback queue and barge-in.
- `src/voice/wav.ts` — 44 bytes of header around the model's float output.
- `src/speech.ts` — what the UI sees: `canSpeak`, `useSpeech()`, `utterance()`.
- `src/components/cards/CardSpeaker.tsx` — the wired-up control.
- `scripts/voice/package-voices.py` — stages an ONNX export into `assets/voices/<id>/`.
  The weights are a build output and gitignored; `voice.json` (sample rate, vocab,
  content hash) is tracked.

### Chunking is not a nicety

A whole card is 10-20 seconds of speech and the model runs at roughly real time on a
budget phone, so synthesising a card in one pass would mean a ten-second silence after
the tap. `player.ts` splits on sentence ends, plays the first chunk as soon as it exists,
and synthesises the next one *during* playback. A second tap stops rather than queues.

### Placement

The speaker lives in the card's **index band**, in the stamp disc where the cat used to
sit. That disc is already the card's one piece of furniture at a fixed spot, so the
control never moves on a kid, and it does not compete with the gold ticket for the
"keep going" meaning. While speaking, the disc fills with ink and the glyph becomes a
stop square — no reserved colour, no words.

It uses `TapTarget`, not `Pressable`: every button on a card sits inside the feed's
page-turn pan, and an RN Pressable there can swallow a swipe (see the long comment on
`TapTarget` in CardFrame).

### What each page reads

- **CardPage** — the factoid
- **QuestionPage** — question, then every option in displayed order, so listening alone is
  enough to answer; the explanation joins once revealed
- **ResponseCard** — the answer (not the kid's own typed question), or on a miss the
  honest "no page yet" line plus the topic offered instead
- **RewardCard** — the praise line and the topic chips

## Known limits

- **Cebuano is off.** There is no fine-tuned Cebuano voice yet, and the stock
  `mms-tts-ceb` checkpoint measures 157-193 Hz depending on the utterance — inconsistent,
  and low enough to read as male beside the Tagalog voice. Three narrators, one of them
  ambiguous, is worse than no button. Its VO script is already written; the voice flips on
  by adding it to `VOICES` in `src/voice/engine.ts`.
- **The vocabulary has no punctuation at all.** "Bakit?" and "Bakit" tokenize identically,
  so question intonation has to come from the training data — which is why the corpus
  deliberately includes quiz questions — and never from the input text.
- **No read-along highlighting.** The typewriter and the speech run independently.
- **Both native deps need a prebuild.** `onnxruntime-react-native` and `expo-audio` ship
  in an APK, not an OTA.
