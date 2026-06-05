# Hiraia — Engineering Log

A chronological record of how this project has approached each technical challenge,
including the approaches that failed. Hiraia is an **offline, on-device AI science tutor
for Filipino grade-school children** (Tagalog/Bisaya), built for the QVAC "Unleash Edge AI"
hackathon. The product runs inference locally on a phone; a web build talks to a hosted
server only as a browser demo.

This log is written for the next person attempting something similar — an on-device,
fine-tuned LLM tutor in a low-resource language on inexpensive hardware. The failures are
the useful part. Tone is deliberately flat; this is a lab notebook, not a story.

---

## 0. Problem statement and constraints

- **Goal:** a tutor that answers science questions in conversational Tagalog/Bisaya, works
  fully offline, costs nothing to run, and keeps the child's data on the device.
- **Hard constraints:** must fit and run on cheap Android phones; offline-capable; no
  per-query server cost; private.
- **Architecture:** two engines behind one interface. `LocalEngine` (mobile, `@qvac/sdk`
  on-device) is the product. `RemoteEngine` (web, a hosted `llama-server`) is a demo
  stopgap. On-device scales for free (one model per device, infinite concurrency, offline);
  the server work is demo polish, not the product.

---

## 1. Base model selection

- Began on **Qwen3-1.7B** (initial QVAC integration).
- Ran a base-model bake-off and switched to **Sailor2-3B-Chat** (commit `59526b0`): best at
  *both* Tagalog and Cebuano, qwen2 architecture (good tooling/quantization support),
  Apache-2.0.
- **Lesson:** for low-resource Southeast-Asian languages, a region-pretrained base
  (Sailor2) beats a larger general-purpose model. Pretraining language coverage dominates
  parameter count at this scale.

---

## 2. Fine-tuning (LoRA)

- **Method:** unsloth LoRA (r32/a64, 3 epochs), one adapter per language (Tagalog, Bisaya).
  Prototyped on Apple Silicon, then trained on a cloud L4/CUDA pod (~$0.38/run for the 1B).
- **Build fix worth recording:** the QVAC CUDA build of `qvac-fabric-llm.cpp` crashed on a
  mask mismatch; the fix was setting `n_batch = n_ubatch = n_ctx`.
- **Datasets:** Tagalog ~2,000 science dialogues; Bisaya grown 305 → ~2,023.
- **Failure that shaped everything later:** the eval suite measured *surface* heuristics —
  language-correct, ends-with-a-question, not-English-heavy, not-repetitive, image-tag
  well-formed. The 1B scored 25/25 on most of these. **Reading the actual replies showed
  the science was wrong** ("chloroplast = photoresistor", "CO₂ stored in roots", invented
  Bisaya words). The heuristics were blind to accuracy.
- **Lesson:** surface metrics lie. For a tutor, factual accuracy is the only metric that
  matters, and it does not correlate with fluency/format scores. You must read outputs and,
  better, hold live conversations (see §8).

---

## 3. Device targeting (a moving target)

- **First target:** a 4GB Cherry Flare Y7 Pro (Helio A22, Android 9, ~₱3,000) — the floor
  of the Philippine market. This forced **Sailor2-1B** (the 3B OOMs at 4GB).
- **Failed approach — quantize the 3B to fit 4GB:** the large multilingual vocabulary keeps
  the embedding/output matrices high-precision, so even `Q2_K` lands ~2.2GB and `IQ2` is
  incoherent. A **1B@Q4 beats a 3B@IQ2** on both fit and quality. Quantization does not
  rescue a too-big model here.
- **1B result:** trained and evaluated; surface metrics excellent, science accuracy poor
  (see §2). This made RAG grounding load-bearing rather than optional.
- **Retarget (commit `043ae18`):** primary target became **Sailor2-3B + RAG on a 6GB+
  phone**; the 1B was kept as a documented 4GB fallback for an accessibility-grant path.
  Rationale from market data: average new Android RAM ~8GB, 6GB is the safe durable floor,
  and a 6GB phone implies a far better SoC than the A22 (so the 3B also runs at usable
  speed). The 1B→3B jump is the largest quality lever available.
- **Lesson:** do not anchor the headline experience to the absolute floor device. Target
  the realistic median, keep the floor as an explicitly-scoped fallback.

---

## 4. RAG grounding

- Because the model hallucinates science, answers are grounded on a **curated, verified
  fact bank** (305 short trilingual facts, `packages/shared/src/rag/facts.generated.ts`).
- **Retriever:** in-memory, dependency-free lexical scoring (idf-weighted token overlap,
  column-weighted like BM25). 305 facts fit in RAM, so SQLite/FTS5 and its native module
  were skipped entirely.
- **Failure — Tagalog morphology:** pure-Tagalog queries missed facts indexed under
  English-only terms (inflected forms like "ginagagagawa" vs "ginagawa" don't match). Fix
  (commit `7ce09c5`): pack Tagalog+Bisaya+English keywords into each fact's `terms[]`, and
  filter question/function words out of the *query* so content words drive ranking. A
  fallback keeps bare identity questions ("sino ka") working.
- Added `ABOUT_HIRAIA` self-knowledge facts because children cannot spell "Hiraia" and ask
  "sino ka / para saan to".
- **Lesson:** lexical RAG over a tiny curated bank is cheap and the retrieval itself is
  reliable (later verified — real questions retrieve correct facts; greetings retrieve
  nothing). Multilingual morphology must be handled explicitly via term packing; do not
  assume the tokenizer bridges languages.

---

## 5. Getting onto the device (QVAC / Expo)

- Upgraded Expo 52 → 54 (RN 0.76 → 0.81, React 18 → 19). QVAC SDK 0.11 runs a bare-runtime
  worker via `react-native-bare-kit`, with client↔worker RPC over `bare-rpc`.
- **Gotchas (each cost real time):**
  - `react-native-bare-kit` must be **exactly 0.12.3** — the SDK's exact peer, *not* the
    documented 0.11.5.
  - Root `.npmrc` **`shamefully-hoist=true`** is required: `bare-pack` does flat npm-style
    resolution and pnpm's isolated store hides the `bare-*` polyfills and `@qvac/*` engines.
  - **Three EAS build failures** traced to one line: an **unanchored `rag/` in `.easignore`**
    matched `packages/shared/src/rag/` (gitignore semantics match any depth), so EAS stripped
    the RagStore and the bundle failed to resolve it. Fix (commit `115808d`): root-anchor
    every `.easignore` entry (`/rag/`).
- **Bundling decision (commits `5d7ecdf`, `b7a53a3`):** the LoRA adapters and the retrieval
  images are the project's unique value, so they **ship inside the APK**; only the generic
  base GGUF (3.2GB, public, reusable) streams once on first launch. Engines were trimmed to
  LLM-only to claw back ~390MB of native libs.
- **Lesson:** `.easignore` uses gitignore matching — anchor everything. Pin native modules
  to the SDK's exact peer version, not the docs. Decide early what is bundled vs downloaded.

---

## 6. On-device crashes (debugged on a physical Oppo Find N6)

The app reached its splash screen and crashed immediately. Three distinct layers, each
fixed in turn, each advancing the worker one stage further:

1. **SIGABRT — `dlopen failed: libbare-abort…so not found`.** The bare/qvac native addons
   were never packaged into the APK (only `libbare-kit.so` was). Fix (commit `d0acfbe`): a
   config plugin `withQvacAddons.js` runs `bare-link` at prebuild into
   `app/src/main/jniLibs` (gradle always packages `jniLibs`). The APK's native `.so` count
   went 1 → 35.
2. **`TypeError: …decode` at `bare-rpc/lib/messages.js`.** `compact-encoding` 2.x (no
   `optionalBuffer`) was bundled where bare-rpc needed 3.x. Fix (commit `ec27b37`): pin via
   root `pnpm.overrides` `compact-encoding: 3.1.0` and regenerate the lockfile.
3. The RagStore strip from §5 (the `.easignore` issue).

After these, the full pipeline worked: the worker boots, the bundled Tagalog LoRA resolves
from the APK asset, and the base GGUF loads into the **Vulkan (Adreno) GPU backend** in
**~26 seconds**.

- **Lesson:** on-device debugging needs the physical device and `logcat`; emulators are not
  supported by QVAC. Crucially, the **~26s model load happens on every cold start, not just
  first run** — that single fact drives most of the UX work in §7.

---

## 7. UX shaped by a 26-second cold start

- Ported the web "notebook paper" brand to mobile (self-hosted hand-drawn fonts, ruled-line
  background, teal palette, Tagalog copy).
- **Dropped-message bug (commit `552f792`):** `sendMessage` returned *before* appending the
  user's message whenever the engine wasn't ready — i.e. during the entire ~25s load window.
  Typed messages vanished with no feedback. Fix: always append the user message; show a
  "thinking" indicator; show a loading state. Errors now surface as a message too.
- **Markdown rendered raw (commit `e0aaf45`):** the model emits `**bold**`/headers; React
  Native `<Text>` showed the literal asterisks. Added a small `RichText` renderer.
- **Persisted history + cold-start filler (commit `0ad3f3c`):** chat history persists
  (AsyncStorage) so the user lands in their previous conversation immediately while the model
  warms up; a pre-written "Alam mo ba na…?" factoid is dropped in as something to read during
  the wait. A dark-green progress bar fills as the model loads.
- **Lesson:** a long, unavoidable cold start reshapes the whole UX. Make the wait legible
  (progress bar, persisted state, filler content) and never drop user input into the void.

---

## 8. The accuracy reckoning (the central finding)

- **Method:** instead of trusting heuristics, drove a live multi-turn conversation against
  the model+adapter while role-playing a vague 10-year-old (imprecise, low-agency questions).
- **Observations:**
  - The model produces **confident, fluent, wrong** science. Asked why astronauts float, it
    invented "tatlong dahilan" mixing gravity/centrifugal/centripetal force.
  - It was handed the **correct verified fact as grounding** ("astronauts float because they
    are in continuous free-fall while orbiting — *not* because there is no gravity") and
    **ignored it**, even contradicting it ("sa space ang gravity ay halos zero").
  - Making the grounding instruction *stricter* and lowering temperature made it **worse** —
    it produced "spacetime curvature", "pseudo-acceleration", and a fabricated "ISS gravity
    = 2.5 m/s² / 25%" (real value ~90%). This ruled out prompt-strictness as the fix.
  - A non-question ("Ok na ba po") triggered an unprompted photosynthesis lecture. Traced to
    the **system prompt's own example sentence**, which was a photosynthesis definition the
    model parroted as a default topic.
  - **Lowering the grade level helped.** At grade 4 the same astronaut question got the core
    right ("free fall… may gravity pa rin") across repeats and dropped the advanced jargon.
    Grade 7 (the app's hardcoded default) was giving the model license to reach for physics
    it gets wrong.
- **Root cause (confirmed, not inferred):** `grep -c "VERIFIED FACT"` on the SFT training
  data returned **0**. Every training example was `system (persona) → question → fluent
  answer from memory`. The model was **never trained with a grounding block**, yet the app
  injects one at runtime. Train/serve mismatch: the model never learned to use the facts it
  is handed, and *was* explicitly trained to always produce a confident answer from memory —
  which is the confabulation.
- **Retrieval was exonerated separately:** real questions retrieve the correct fact;
  greetings ("Ok na ba po") retrieve nothing. The pipeline's weak link is the model's refusal
  to defer, not the search.
- **Lessons (the most important in this log):**
  1. **RAG retrieval working ≠ grounded answers.** A small model will not defer to provided
     context unless it is *trained* to. Handing it correct facts is not enough.
  2. **"Add more facts" can make hallucination worse.** Fine-tuning a small model on facts it
     does not already know teaches it to state guesses confidently. The lever is *faithfulness*
     training, not more knowledge.
  3. **Match the grade to the child.** A higher grade level invites the model into territory
     it cannot handle correctly.
  4. **Fluency masks wrongness.** A fine-tune that produces well-formatted, authoritative
     prose makes errors *more* dangerous, not less.
  5. **Only live conversation surfaced all of this.** Every surface metric looked fine.

---

## 9. The fix in progress

- **Grounding-faithfulness dataset (commit `b2d0420`):** rebuilt the SFT set so every example
  mirrors the runtime prompt — `system + VERIFIED FACTS block + question → gold answer that
  uses only those facts, abstains when they don't cover the question, and chit-chats greetings
  without lecturing`. 411 examples (320 grounded / 58 abstain / 33 chit-chat), one grounded
  example authored for every fact in the bank, built with the *same* shared prompt functions
  and fact bank the app serves so train and serve cannot drift. The gold knowledge is the
  verified fact bank itself, so training and runtime grounding come from one source.
- **Factoid bank verified (commit `2c7308c`):** a separate 300-entry "Alam mo ba na…?" content
  bank (shown to kids on cold start) was fact-checked in a parallel review — 0 fail, 28 fix,
  248 pass. The science was sound across the board; the fixes were almost all Tagalog (missing
  translations, a Cebuano "Yuta" leaking into Tagalog fields, garbled words) plus a few phrasing
  errors (convection ≠ boiling; more coil turns ≠ more current; tsunami "shallow" → "low height").
  The mobile snapshot is gated to **verified AND has-Tagalog** (220 of 300 ship).
- **Content-pipeline lesson:** LLM-authored content was *scientifically* reliable but had
  systematic *language-completeness* gaps (80 of 276 were English-only despite the brief).
  Generation and verification are separate QA passes; passing a science check does not mean
  the entry is shippable.
- **Language decision:** launch Tagalog-first, defer (not delete) Bisaya. The two languages are
  separate LoRA adapters, so they do not compete for capacity — the real cost of Bisaya is
  effort and a lower quality ceiling (Sailor2's thin Bisaya pretraining). Prove the grounded
  pipeline on Tagalog, then re-run the language-parameterized generator for Bisaya.

---

## 10. Open problems

- Retrain the Tagalog adapter on the grounded dataset and re-evaluate with the live-conversation
  method — the open question is whether faithfulness training makes a 3B actually defer to the
  facts.
- 80 verified factoids are English-only and need a translation pass before they can ship.
- The app still hardcodes grade 7; it should default lower (the test persona was a 10-year-old)
  or be configurable per student.
- Bisaya quality ceiling remains unaddressed (deferred by decision).
- The ~26s cold start is inherent to loading a 3B into the GPU each launch.

---

## Recurring lessons (condensed)

1. Surface metrics lie; read outputs and hold live conversations.
2. Train/serve prompt parity is non-negotiable for RAG — if you inject grounding at runtime,
   you must train with it.
3. A small model will not defer to provided context unless trained to; more facts can worsen
   hallucination.
4. Quantization does not rescue a model that is fundamentally too large for the device.
5. Target the realistic median device; document the floor as a scoped fallback.
6. `.easignore` uses gitignore semantics — anchor every entry. Pin native modules to the
   SDK's exact peer.
7. A long cold start is a product constraint, not just an engineering detail.
8. Generation and verification are separate QA passes; reliable science can still ship with
   broken language.
