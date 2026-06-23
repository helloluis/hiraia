# Multimodal ideas — voice for Hiraia (backlog, not in the CPT scope)

**Status:** exploratory backlog. **NOT** part of the LLM flagship effort (`CPT-FLAGSHIP-PLAN.md`) — different modality, different models, different engines. Captured so the research doesn't evaporate. Nothing here is committed scope.

## Why voice at all

Hiraia's users are Filipino **grade-school kids on budget offline phones** — many young or low-literacy, for whom *typing* Tagalog/Cebuano is a real barrier. Two independent features, which combine into a full **speak → hear loop**:
- **Voice output (TTS):** read answers aloud. Lower risk, higher immediate value, ships sooner.
- **Voice input (ASR):** let kids *speak* their questions. Higher mission value (access for non-typers) but higher risk (kids' speech).

Both must stay **offline / on-device** (the core Hiraia value) and run on the Redmi-class CPU (SD685, ARMv8.0).

---

## 1. Voice output — Text-to-Speech (TTS)

**Headline: largely solved off-the-shelf — both Tagalog *and* Cebuano voices exist.** (Unlike the LLM text problem, Cebuano is not data-starved here.)

**Off-the-shelf models (all VITS, ~100–150 MB, CPU-runnable):**
| Lang | Model | License |
|---|---|---|
| Tagalog | `facebook/mms-tts-tgl` | CC-BY-NC-4.0 |
| Cebuano | `facebook/mms-tts-ceb` (Meta) | CC-BY-NC-4.0 |
| Cebuano (alt) | `LeandroIV/sugbosound-cebuano-tts-vits` (community) | check license |

**Engine:** [`sherpa-onnx` (k2-fsa)](https://github.com/k2-fsa/sherpa-onnx) — runs MMS/VITS/Piper TTS on **Android CPU, offline**, with prebuilt MMS conversions + Android libs. Sits alongside the QVAC LLM engine.

**Tiers:**
- **Tier 0 — MVP, ~free:** Android `TextToSpeech` API. Filipino `fil-PH` is offline-supported → instant Tagalog. *But* no Cebuano, and quality varies by OEM (Xiaomi default differs). Quick demo only.
- **Tier 1 — the real path:** MMS-TTS `tgl`+`ceb` via sherpa-onnx; bundle/download the two voices (use the existing model-download mechanism; ~200–300 MB both), route by detected answer language, **stream sentence-by-sentence** while the LLM is still generating (kills perceived latency).
- **Tier 2 — premium / brand differentiator (later):** train a warm, child-friendly **single-speaker** voice (Piper/VITS). Needs only **a few hours of clean single-speaker audio** (hire one Filipino teacher voice for a day) → best quality, clean license, recognizable brand voice. Cebuano scarcity barely bites for TTS.

**Gotchas:**
- **Taglish is the weak spot** — Tagalog answers carry English science terms (*photosynthesis*); a Tagalog phonemizer will mangle them. Needs a small pronunciation-dictionary/phoneme fixup for common terms. Test early — it's what sounds wrong to a parent.
- **License:** MMS = CC-BY-NC-4.0 (non-commercial). Likely fine for not-for-profit educational use — **confirm**, and know it blocks any commercial pivot.
- **Quality:** MMS voices are functional, not necessarily warm for kids → Tier-2 custom voice is the fix.
- **On-device latency / size:** unmeasured on the SD685 — benchmark; stream to hide it.

---

## 2. Voice input — Speech Recognition (ASR)

**Headline: feasible and license-cleaner than TTS — Whisper is the path.** The genuine risk is *not* language coverage; it's **children's speech**.

**Engine:** [`whisper.cpp`](https://github.com/ggerganov/whisper.cpp) — OpenAI Whisper, **MIT-licensed**, GGML-quantized, offline Android CPU. The exact ASR analog to llama.cpp; cleaner license than the MMS/TTS route. (sherpa-onnx is the alternative runtime.)

**Models — both languages covered:**
- **Tagalog:** native in Whisper's 99 languages + community fine-tunes (`LWobole/whisper-small-tagalog`).
- **Cebuano:** *not* native, but community Whisper fine-tunes exist — `Jerich/whisper-cebuano`, `donnamae/whisper-finetuned-cebuano-accent`, and **dual-language** ones covering ceb+tagalog (`pengyizhou/whisper-mixed-datasets-...-ceb_ph-tagalog`).
- **Training data for our own fine-tune** (if community ones underperform): Common Voice (`mozilla-foundation/common_voice_17_0`) + a dedicated `Speech-data/Cebuano-Speech-Dataset`.

**Path:**
1. `whisper.cpp` + a **base (74M)** or **small (244M)** GGML model (tiny=39M is fastest but error-prone; base is the sweet spot; small is more accurate, slower on the SD685).
2. **Evaluate the existing ceb+tagalog community fine-tunes first** — may need no training.
3. If not, **fine-tune our own Whisper-small** on Common Voice (tl+ceb) + Cebuano-Speech-Dataset → one model, both languages → GGML for whisper.cpp.

**Gotchas (these are the real challenge, not the languages):**
- **⚠️ CHILDREN'S SPEECH is make-or-break.** Every model here is trained on **adult** speech; kids (high pitch, immature articulation, disfluencies) degrade ASR *sharply*. Not solved off-the-shelf. **Prototype on real children before committing**, and expect to collect/fine-tune on kids' tl/ceb speech (scarce → you'd record it).
- **Taglish** — kids code-switch mid-sentence; a weak spot for all these models.
- **Noise + cheap mics** — classrooms/homes are loud; budget-phone mics poor; hurts ASR more than TTS.
- **ASR is the heaviest of the three** and adds to the **latency stack**.
- (The user-shared `kylegregory/wav2vec2-large-xlsr-53-ceb` was evaluated and **rejected**: gated/restricted, 0 downloads, ~315M wav2vec2-large is heavy on CPU, training data undisclosed. Whisper is the better path.)

---

## 3. The full voice loop + cross-cutting constraints

**Architecture:** kid taps mic → record short utterance → `whisper.cpp` transcribes (tl/ceb) → text into the existing RAG+LLM pipeline → answer → `sherpa-onnx` TTS reads it aloud. Speak-and-listen, no typing.

**The binding cross-cutting issue — cumulative latency on a budget CPU:** ASR (~2–8 s on the SD685) **+** LLM (RAG + generate) **+** TTS *compound*. Mitigate: stream everything, show "listening… / thinking… / speaking…" feedback, keep utterances short. This is the same prefill-bound constraint as the LLM — measure on-device.

**License summary:** Whisper / whisper.cpp = **MIT** (clean). MMS-TTS = **CC-BY-NC-4.0** (non-commercial; confirm not-for-profit qualifies). The Tier-2 custom TTS voice would be cleanest of all (we own it).

**Relative difficulty:** TTS is *easy* (both voices exist; custom needs hours-not-billions of audio). ASR is *harder* (kids' speech + latency). Both are far more tractable than the LLM-text effort — Cebuano scarcity, which dominates the CPT plan, barely matters for speech.

**Recommended sequencing if pursued:** TTS first (lower risk, immediate value), then ASR (after a real-kid speech prototype proves accuracy). Both are separate workstreams from `CPT-FLAGSHIP-PLAN.md`.

## References
- TTS: `facebook/mms-tts-tgl`, `facebook/mms-tts-ceb`, `LeandroIV/sugbosound-cebuano-tts-vits`; engine `github.com/k2-fsa/sherpa-onnx`
- ASR: `github.com/ggerganov/whisper.cpp`; fine-tunes `LWobole/whisper-small-tagalog`, `Jerich/whisper-cebuano`, `donnamae/whisper-finetuned-cebuano-accent`, `pengyizhou/whisper-mixed-datasets-...-ceb_ph-tagalog`; data `mozilla-foundation/common_voice_17_0`, `Speech-data/Cebuano-Speech-Dataset`
- Sibling docs: `CPT-FLAGSHIP-PLAN.md` (the LLM effort), `PARAMETRIC-VS-RAG.md`
