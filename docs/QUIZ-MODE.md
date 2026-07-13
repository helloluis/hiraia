# Quiz Mode — gameplay & UI spec

**Status:** spec + **bank v1 generated (2026-06-24)** — `rag/bank/quiz-bank.jsonl` holds **9,497** grade-5 MCQs (en+tl), generated from distribution-matched fact-bank facts then strict-verified + hidden-difficulty-scored (9,990 generated → 95.1% kept; 492 flagged → `quiz-rejects.jsonl`, mostly multiple-correct-answer traps). Domain spread mirrors the fact bank; difficulty easy45/med49/hard7. **Topic layer done**: every question tagged with one of **32 kid-nameable broad topics** (`quizTopic`), all ≥15 questions (no dead-ends) — manifest + aliases in `rag/bank/quiz-topics.json` (this is what the "what topic?" prompt resolves against). **Fully TRILINGUAL** (en/tl/bis) — Cebuano added by a Sonnet pass anchored on each fact's verified ceb text, 100% coverage, option order preserved (answer keys valid). ⚠️ Cebuano warrants a native-speaker spot-check before ship (Sonnet-translated). **Bank is content-complete; only the mobile UI remains.** A near-term product feature, **decoupled from the CPT/LLM effort** — it runs on the current app + a verified quiz bank; the on-device LLM is **out of the quiz loop** (no live generation, no tool-calling — all content is pre-verified bank data rendered by deterministic UI).

## Why this design
A quiz is a **test-prep** feature, so a wrong answer marked "correct" is the worst possible error. Therefore **all questions, options, answers, and explanations come from a pre-authored, verified quiz bank** built from the knowledge bank (`rag/bank/science-facts.jsonl`) — the same facts the tutor teaches, so the quiz tests what kids actually learn. No on-device generation; no hallucination surface.

## Gameplay flow
1. **Enter** — `QUIZ!` button in the top bar → **confirmation dialog** (anti-mistap: "Start a quiz?") → on confirm, the notebook background switches **white paper → yellow pad** to signal quiz mode.
2. **Thread clears** — quiz shows **one card at a time** (not the scrolling chat). First card is a **freeform** prompt: *"What topic do you want to be quizzed on?"*
3. **Topic resolution** — kid types freely (e.g. "dinosaur", "mga halaman", "astronomy"). Resolve against **supported topics** (= topics in the quiz bank with ≥ enough questions) via the existing embedding/RAG match (handles tl/ceb/en, synonyms, typos).
   - Supported → load **5 questions** drawn from that topic's verified pool.
   - Unsupported → *"Sorry, we can't make a quiz about that yet."* → back to the topic prompt.
4. **Per question** (×5):
   - Show the question + **tappable multiple-choice options** (4), **order shuffled on every display** so the correct answer is never tied to a position (can't memorize "it's always B"). Shuffle is render-only; storage keeps a stable answer index.
   - **⏱ 30-second timer per question** — a visible countdown bar. (Raised from 15s after role-play QA: the bank's questions are wordy — median ~51 Tagalog words across the question + 4 options — so 15s auto-failed slow grade-5 readers on questions they knew.)
   - **Difficulty ramp**: each round is ordered EASY → HARD (the hidden 0–2 difficulty), opening gently and ending with the hardest 1–2; hard items are capped at 2 per round so a round never stacks trivia.
     - **Tap correct** → celebratory effect (confetti + party emoji), brief, then next.
     - **Tap wrong** → **✗** beside their choice + **✓** on the correct answer + a **one-sentence explanation**.
     - **Timer expires (no tap)** → treated as a miss: reveal the correct answer (✓) + explanation, no celebration, auto-advance.
   - One answer per question; locked after tap or timeout.
5. **End screen** — show **score** (e.g. "4/5"), plus **"Start again?"** (fresh 5 from the topic pool — replayability) and **"End quiz."**
6. **Return to chat** — exit quiz mode (yellow pad → white paper); the **entire quiz — each question, the kid's answer, the correct answer, and explanations — is materialized into the chat thread** as retained messages, so it becomes part of the conversation history.

## Quiz bank (the content — the real work)
- **Source-grounded**: every question is built from a verified fact in `rag/bank/science-facts.jsonl` (cite the source fact `id`), so the answer is something the tutor teaches.
- **Mirrors the knowledge-bank distribution**: LIVING_THINGS ~52% · EARTH_SPACE ~15% · FORCE_MOTION_ENERGY ~14% · MATTER ~13% · PH_GEOGRAPHY ~4% · PH_CIVICS ~2%.
- **Target ~10,000 questions** for genuine replayability (≥ ~10–15 per topic so "Start again?" gives fresh questions).
- **Grade 5** for now; trilingual (en/tl/bis) matching the fact schema.
- **Distractor calibration**: wrong options must be *plausible but wrong* — same category as the answer, grade-5-level, ideally tapping a **real misconception** (e.g. fish "surface for air like a whale", equator divides "East/West"). Not obvious, not inscrutable. Authored by an offline generate-then-verify pipeline (the factoid-bank pattern): a strong model drafts Q+distractors from a fact, then a verification pass confirms the keyed answer is correct AND no distractor is accidentally true.
### Storage & schema (trilingual)
Source of truth: **`rag/bank/quiz-bank.jsonl`** (sibling to `science-facts.jsonl`, regenerable), bundled/sharded into the app like the fact bank. Every text field is trilingual (en/tl/bis), matching the fact schema:

```jsonc
{
  "id": "quiz-0001",
  "factId": "rust-iron-oxide-new-substance-g6",        // grounding/provenance
  "domain": "MATTER", "topic": "rust is a chemical change", "grades": [5],
  "q":      { "en": "...", "tl": "...", "bis": "..." },
  "options": [                                          // array of trilingual options
    { "en": "It becomes a new substance (iron oxide)", "tl": "...", "bis": "..." },
    { "en": "It just gets dirty and wipes clean",      "tl": "...", "bis": "..." },
    { "en": "It turns into pure gold",                 "tl": "...", "bis": "..." },
    { "en": "It melts into a liquid",                  "tl": "...", "bis": "..." }
  ],
  "answer": 0,                                          // CANONICAL index; UI shuffles at render
  "explanation": { "en": "...", "tl": "...", "bis": "..." },
  "reviewed": true
}
```
- **`answer` is a canonical index**, language-independent. The UI shuffles the option order on display (Fisher-Yates on indices) and remaps the correct position — so storage is stable and "memorize the letter" fails.
- **Size/delivery (measured 2026-06-26, trilingual)**: ~1.4 KB/question compact JSON, **~0.44 KB/question gzipped** (container-independent — `.sql`, JSON, NDJSON all gzip to the same floor; the bytes are the unique text). So a full bank is ~**11 MB gzipped @ 25k**, ~**22 MB @ 50k** — storage is NOT a constraint (the APK is already ~500 MB of adapters+images; OTA over WiFi is a few seconds).

### Scaling delivery — pre-ship checklist (when the bank outgrows the bundled sample)
The current build `import`s `src/data/quiz-bank.json` (1,567-q sample, 2.2 MB) straight into the JS bundle — parsed at app startup. Fine at this size; **do NOT keep inlining once the bank exceeds ~10–15k questions** (a >~15 MB JSON parsed at boot costs startup latency + JS heap). At that point:
- [ ] **Ship a prebuilt SQLite seed DB** (DECIDED 2026-06-26). Build it server-side from `quiz-bank.jsonl`, gzip it (~12 MB @ 25k / ~25 MB @ 50k), and on first run / OTA update **decompress + drop the file** into the `expo-sqlite` dir (zero per-row `INSERT` cost on the budget Redmi — important; executing 25–50k inserts at setup would stall a slow phone). SQLite is ~25% larger *at rest* than JSON but that's irrelevant; it's chosen for **runtime**, not size.
- [ ] **Runtime = query-on-demand**: no startup parse, low RAM; index `topic` / `concept` / `difficulty`; `pickQuestions` (unseen-pref → concept-dedup → easy→hard ramp, hard≤2) becomes indexed SQL. Reuses the `expo-sqlite` already in the chat store (no new dep).
- [ ] **Persistent per-child seen-memory** as a `seen` table (replaces the session-only `Set`; also covers the AsyncStorage plan below) — survives restarts, enables resurface-wrong spaced repetition via a JOIN.
- [ ] **OTA growth = row deltas** (`UPSERT` of new/changed questions as SQL or NDJSON), not a whole-DB re-download. Prebuilt `.db` = the initial seed; deltas keep updates small.

### Per-child seen-memory (replay control)
- A **local, on-device, per-child** log (AsyncStorage) — *not* in the bank: `{ [quizId]: { seen: count, last: ts, lastCorrect: bool } }`. Offline, private, no server.
- **Selection** when drawing 5 for a topic: prefer **unseen**, then oldest-seen — a **soft** no-repeat (repeats are fine to reinforce, and *encouraged* for questions the child got **wrong** → light spaced-repetition). If a small topic's unseen pool is exhausted, allow repeats by oldest-first.
- This is why the pool wants ≥10–15 questions/topic — so repeat sessions surface fresh questions.

## Open decisions (to confirm)
1. # of launch topics (e.g. the ~10 biggest curriculum areas first).
2. Replayability pool size per topic (≥10–15 for fresh-5).
3. Trilingual from the start vs author en first, translate.
4. Celebration effect (confetti + party emoji + optional sound).
5. Topic-resolution threshold (min questions for a topic to count as "supported").

See also: `CPT-FLAGSHIP-PLAN.md` (LLM effort, separate), `MULTIMODAL-IDEAS.md`.

---

## Question-cards feed — future enhancement note (2026-07-13)

**Page-curl (skeuomorphic upgrade):** the v1 feed uses a cheap 2D `Animated` corner-peel
(z-rotate + slide-up + shadow, native driver). If we keep the notebook skeuomorphism and
want a *real* paper curl that follows the finger, the reference implementation is William
Candillon's **Riveo** (`wcandillon/can-it-be-done-in-react-native`, season5/src/Riveo): a
GLSL fragment shader (`pageCurl.ts`) run via `@shopify/react-native-skia`
(`RuntimeShader` on a Skia `Group.layer`), driven by a gesture-handler Pan → reanimated
shared values → shader uniforms. Adoption path = add react-native-skia, snapshot each card
to a Skia image on flip (so the shader has pixels to bend), port the shader, wire pan→
uniforms. **Gate first: smoke-test Skia's GPU backend on the Adreno 610** (our Vulkan
history — Skia defaults to GLES, likely fine, but verify on the real Redmi before committing
the dependency + card-render rewrite).
