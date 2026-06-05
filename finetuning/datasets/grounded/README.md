# Grounded-faithfulness SFT dataset (Tagalog-first)

**Why this exists.** A live test (2026-06-05) showed the on-device Sailor2-3B + TL
adapter produces *confident, fluent, wrong* science: handed the correct verified fact
as grounding, it ignored it and invented physics (centrifugal/centripetal force,
"spacetime curvature", fake numbers). Root cause: **the current SFT data has zero
grounding blocks** (`grep -c "VERIFIED FACT" ../tagalog/train-v3.jsonl` → 0), yet the app
injects a `VERIFIED FACTS FROM THE CURRICULUM` block at runtime. The model was never
taught to use the facts it's given — it was trained to answer from memory, which *is* the
confabulation.

This dataset retrains that behavior. Every row mirrors the **runtime prompt** and teaches:

1. **Defer to the grounding** — base the answer ONLY on the provided facts.
2. **Don't invent** — never add a mechanism, term, or number that isn't in the facts.
3. **Abstain** — when the facts don't cover the question, say "hindi ako sigurado" and
   redirect, instead of guessing.
4. **Chit-chat** — reply to greetings/acknowledgments conversationally, with no lecture.

## Files

- `seed.tagalog.json` — hand-authored gold examples (the quality bar). Each entry:
  `{ mode, grade, factIds[], user, assistant }`. `factIds` reference real ids in
  `packages/shared/src/rag/facts.generated.ts`; the builder turns them into the VERIFIED
  FACTS block. Modes: `grounded` | `abstain` | `chitchat`.
- `build-grounded.mts` — assembles each row's `system` with the SAME functions the app
  uses (`generateSystemPrompt` + `formatGroundingBlock`) and fills the facts from the SAME
  bank the app serves (`SCIENCE_FACTS`). Train/serve stay in lockstep.
- `train-grounded.jsonl` — generated output (OpenAI `messages` format, ready for the
  unsloth pipeline).

## Build

```bash
node_modules/.bin/tsx finetuning/datasets/grounded/build-grounded.mts
# optional: tsx build-grounded.mts <seed.json> <out.jsonl>
```

## Authoring rules (the gold answers MUST obey)

- Use ONLY the facts in the row's grounding block. Rephrase them simply at the row's grade.
- Keep it short (≈2–3 short paragraphs) and end with ONE light Socratic question whose
  answer is itself within the facts (don't lead the kid toward ungrounded claims).
- NEVER introduce a number, unit, mechanism, or term not present in the facts.
- `abstain` rows: the grounding is empty OR present-but-not-answering; the answer admits
  uncertainty and redirects. (These directly counter the fabricated-numbers failure mode.)
- `chitchat` rows: empty grounding; warm reply + invite a science question; no teaching.
- Vary `grade` (3–7) and match the language/complexity to it.

## Distribution target (full set)

Scale the seed across the **305-fact bank**. Rough mix:

| mode      | share | purpose |
|-----------|-------|---------|
| grounded  | ~70%  | faithful rephrasing of provided facts |
| abstain   | ~20%  | refuse to invent; redirect (the key fix) |
| chitchat  | ~10%  | greetings/acknowledgments handled cleanly |

For `grounded` rows, include some with **2–3 facts** in the block (one relevant + a
distractor), with the gold answer using only the relevant one — runtime retrieval returns
up to 3, so the model must learn to pick. Cover every domain (MATTER, LIVING_THINGS,
FORCE_MOTION_ENERGY, EARTH_SPACE, ABOUT_HIRAIA) and a spread of grades.

## Files (canonical sources)

- `seed.tagalog.json` — the 22 hand-authored gold examples (the quality bar / reference).
- `examples.tagalog.json` — the **full** combined source: the seed + one grounded example
  authored for every fact in the 305-fact bank + the abstain/chit-chat sets. This is what
  the builder reads. Regenerate `train-grounded.jsonl` from it after any edit.

## Status

**Full set built: 411 examples** — grounded 320 / abstain 58 / chit-chat 33 (≈78/14/8%).
One grounded example authored per fact across all five domains; gold answers spot-checked
for faithfulness. NEXT: retrain the Tagalog adapter on `train-grounded.jsonl` (same
unsloth→GGUF pipeline) and re-eval with the **live-conversation** method (surface heuristics
miss accuracy). Optional: add more abstain rows toward 20%, and a 2nd phrasing per fact.
Bisaya is deferred — author `seed.bisaya.json` / `examples.bisaya.json` (`language:
"cebuano"`) and re-run the same builder when ready.
