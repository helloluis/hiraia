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

## Tag-awareness + multi-turn

Every row's system prompt is built tag-aware (`generateSystemPrompt(lang, grade, true)` →
appends `IMAGE_TAG_INSTRUCTION`), so the adapter keeps the `[image: …]` behavior. Image-tag
**positives** end the assistant answer with a final `[image: <English description>]` line;
everything else (grounded-no-image, abstain, chit-chat) are **negatives** that teach
restraint. Multi-turn rows carry a `turns` array (the builder uses it instead of
`user`/`assistant`); each multi-turn stays on ONE grounded fact across follow-ups so the
system's grounding block remains valid for the whole conversation.

## Tier-3 accuracy component (`accuracy.tagalog.json`, 2026-06-07)

The grounded/abstain split above fixed CONFABULATION, but on-device chat-driver probing
(`finetuning/eval/harness/PROBING-FINDINGS.md`) then surfaced the OPPOSITE failure that
prompt + retrieval couldn't fix: **over-abstention WITH facts present** — the adapter
deflects ("hindi ako sigurado", "tanungin ang guro") even when the grounding answers the
question, especially on messy/homework/emotional phrasing. (It was partly *trained* in:
`abstain-balance` pairs questions with non-answering facts, and that generalizes too far.)

`accuracy.tagalog.json` rebalances it (it does NOT remove faithfulness):

- **grounded-confident counters** — the exact messy phrasings that deflected ("may homework
  ako tungkol sa Venus", "ano bang gravity parang nahihilo ako") paired with ANSWERING facts
  and a CONFIDENT gold answer. Pure upside: facts are present, no confab risk.
- **affirm-settled / correct-premise** — "totoo bang patag ang mundo?" → affirm round Earth;
  "lima lang ang planeta?" → correct to 8. (Some use empty `factIds` = answer from general
  knowledge — the intended behavior for canonical settled science.)
- **debunk-myth** — 10%-brain, reading-in-dark, gum-7-years → name it a myth + give the truth.
- **safety + emotional** — scared-kid → acknowledge + safe steps; wires/lightning/smoking → clear safe answer.

Builder now merges multiple components: `examples.tagalog.json` + `accuracy.tagalog.json`
→ `train-grounded.jsonl` (run `tsx build-grounded.mts` with no args). KNOWN databank gap
found while authoring: the bank has no explicit "the Earth is round/a sphere" fact, so the
flat-earth example is general-knowledge (empty `factIds`) — add an earth-shape fact to
Hiraiapedia so retrieval can ground it.

## Status

**Comprehensive set built: 983 examples** — grounded 712 / abstain 148 / chit-chat 123;
109 multi-turn; 292 image-tagged (~30%). This is the **Option C** build: faithful AND usable
(keeps breadth, conversational range, and image-tagging), rather than a narrow grounded-only
adapter. Spot-checked for faithfulness, tag format, and multi-turn simplification. NEXT:
train on `train-grounded.jsonl` (Sailor2-3B, `train-tagalog-grounded.py`, ctx 2048,
train_on_responses_only) and re-eval with the **live-conversation** method. When this adapter
ships, the app's runtime prompt must also append `IMAGE_TAG_INSTRUCTION` (parity). Bisaya is
deferred — author `examples.bisaya.json` (`language: "cebuano"`) and re-run the builder.
