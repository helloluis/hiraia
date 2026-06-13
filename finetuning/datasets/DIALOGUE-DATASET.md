# Dialogue + image-request SFT dataset (v4)

Fixes the two model-side failures observed on-device (2026-06 phone sessions) and
now measurable via the capability benchmark's `multi-turn` tier:

1. **Image-request over-abstention** — student asks to *see* something (t-rex);
   retrieval returns only tangential facts; the grounding-faithfulness training
   makes the model abstain instead of emitting its trained `[image:]` tag.
2. **Dialogue-state failures** — near-verbatim repetition across turns, re-asking
   a Socratic question the student already answered, and content garbling under
   follow-up pressure (gravity/weightlessness). Root cause: **train-v3 is 100%
   single-turn** (every row is exactly system+user+assistant) — the model has
   never seen a multi-turn conversation in SFT.

## Files (to generate)

- `tagalog/science-dialogue-v4.jsonl` (~150 rows: ~60 Family A, ~90 Family B)
- `bisaya/science-dialogue-v4.jsonl` (~150 rows, same split)

Schema: `{"messages":[...]}` like all other sets. Grades 3–10 spread.

## Shared conventions (load-bearing — must match runtime)

- **System prompt**: `generateSystemPrompt(language, grade, /*imageTags*/ true)`
  from `packages/shared/src/prompts/system.ts` — the per-grade persona + safety
  clauses + `IMAGE_TAG_INSTRUCTION`. Static; NO grounding in it (TTFT KV-cache fix).
  Authored fragments are **system-less** (`{"grade": "3".."10", "messages": [user,
  assistant, ...]}`); the assembler (and `validate-v4.py --lang`) injects the exact
  production prompt locally at merge time.
- **Grounding placement**: grounding goes in a USER turn via
  `composeGroundedUserTurn(formatGroundingBlock(hits), msg)`. In multi-turn rows the
  block appears **only in the FINAL user turn**; earlier user turns are RAW — this is
  exactly what the device shows the model at generation time (chatStore keeps raw
  turns in history and grounds only the current turn).
- **Grounding content**: real facts copied from `rag/bank/science-facts.jsonl`
  (the `- (topic) fact-text` line format of `formatGroundingBlock`). Never invent
  grounding text.
- **Tag descriptions**: short, caption-style **English**, and must resolve against
  the bundled image catalog at cosine ≥ 0.70 (the calibrated `IMAGE_TAG_FLOOR`).
  Validate every authored desc with `rag/scripts/validate-image-vectors.py`-style
  top-1 lookup before accepting a row (no grounding misses — same bar as the
  tagged dataset).

## Family A — image request under tangential grounding (~60/lang)

Single-turn: `[system(tag-aware), user(grounding + image request), assistant]`.

- The grounding block contains 1–3 REAL bank facts that are **tangential** to the
  requested subject (what hybrid retrieval actually serves for "pakita mo ang
  t-rex": dinosaur-adjacent or fully off-topic facts). This mimics the failure
  condition exactly.
- Student phrasings to cover: "pakita mo naman ang …", "may picture ka ba ng …?",
  "gusto ko makita ang …", "ano ang hitsura ng …?", bare "picture ng … please"
  (Bisaya: "ipakita kunøhay ang …", "naa kay hulagway sa …?", "unsa'y hitsura sa …?").
- Assistant: **never abstains on a request to see age-appropriate science
  content.** 1–3 accurate general-knowledge sentences about the subject (it MAY
  go beyond the tangential grounding — the faithfulness rule constrains claims
  covered by the facts, not picture-showing), then the tag on its own final line.
- Subjects sampled from REAL bundled catalog slugs (4,228) so every tag resolves:
  dinosaurs (t-rex!), animals, volcanoes, planets, body parts, weather, plants,
  simple machines, PH-specific (carabao, banaue terraces, taal, jeepney…).
- **Negatives (~15 of the 60)**: requests for images we should NOT tag —
  non-science/pop-culture ("picture ng sikat na artista", video game characters)
  → friendly one-line redirect to a science topic, NO tag; plus a few requests
  too vague to resolve → one clarifying question, NO tag.

## Family B — anti-repetition / dialogue state (~90/lang)

Multi-turn: 5 or 7 messages (`system, u1, a1, u2, a2[, u3, a3]`), grounding only
in the final user turn. Loss is full-sequence (train-full.py), so intermediate
assistant turns must also be exemplary. Sub-types:

- **B1 "di ko gets" (~25)** — student says they didn't understand a1. a2 explains
  with a **completely new analogy/angle**; zero recycled phrasing from a1. (The
  judge's hard cap: near-verbatim repetition ⇒ pedagogy ≤ 1.)
- **B2 answered-question (~25)** — a1 ends with a Socratic question; u2 ANSWERS
  it (sometimes correctly, sometimes wrong). a2 must acknowledge the student's
  specific answer (affirm or gently correct) and build forward. It must NOT
  re-ask the question or act as if unanswered.
- **B3 restate-and-check (~15)** — u2 restates the concept in the student's own
  words ("ah so parang … ?"). a2 confirms what's right, fixes what's off, adds
  ONE new layer. No full re-explanation.
- **B4 related follow-up (~15)** — u2/u3 asks an adjacent question. a2/a3 answers
  the NEW question directly without re-explaining turn-1 content.
- **B5 hard-content dialogues (~10)** — topics the 3B garbles under follow-up
  pressure, scripted to land the correct physics: gravity vs weightlessness
  (astronauts are in FREE FALL, gravity exists in space; the moon HAS gravity —
  ~1/6 of Earth's), moon phases vs eclipses, breathing vs digestion energy,
  evaporation vs boiling. Mirror the benchmark's `mt-*` traps WITHOUT copying
  probe wording (no teaching to the test).
- Some Family B rows (~1 in 3) end with a fitting `[image:]` tag on the final
  answer, and a few u2s ask "pakita mo nga" mid-dialogue — bridging A and B.

## Integration for the retrain (one RunPod session, ~$0.60)

```bash
cat tagalog/train-v3.jsonl tagalog/science-dialogue-v4.jsonl > tagalog/train-v4.jsonl
cat bisaya/train-v3.jsonl  bisaya/science-dialogue-v4.jsonl  > bisaya/train-v4.jsonl
```

Watch ctx: 7-message grounded rows can run long — keep dialogues tight enough to
fit the training seq len (2048 for the 3B grounded runs; trim grounding to ≤2
facts in 7-message rows).

## Validation before training (hard gates)

1. JSON-valid; roles strictly alternate after system; final message is assistant.
2. Every `[image:]` desc resolves to a sensible slug at cosine ≥ 0.70.
3. Every grounding line traces back to a real bank fact id.
4. No assistant turn shares an 8-gram with a previous assistant turn in the same
   row (mechanical anti-repetition check).
5. Eval AFTER training in the SAME pod session (run-harness green + capability
   multi-turn tier vs the 2026-06-10 baseline) before terminating the pod.
