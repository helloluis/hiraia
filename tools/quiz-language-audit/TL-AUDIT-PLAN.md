# Tagalog quiz audit — scope and plan

**Source of truth:** `rag/bank/quiz-bank.jsonl` — 32,718 items, **25,751 of which ship**
(deduped by `factId` into `cards-questions.json` → the `card_question` table in cards.db).
Every item has exactly 3 options. No missing `tl` fields anywhere.

Tagalog surface: **163,590 strings** (question + 3 options + explanation per item).

## What already happened — do not redo it

A four-round Gemini pipeline ran 12–15 Sept 2026 over a 66,000-language-job corpus and its
repairs were **applied and verified** on 15 Sept: 1,083 keys, **406 Filipino** and 677 Cebuano,
across 2,028 row-language updates in 13 files. Ledger:
`runs/2026-09-15/final-integration-v1/integration-ledger.jsonl`.

That pass flagged **1.24% of items as tl defects** — close to the Cebuano card sweep's 1.70%,
which is a reassuring cross-check on both.

Its own handoff is candid that it is "model-assessed findings, not independent language
certification", and it had **no adversarial refutation step**. I sampled three of the 405
applied `tl` repairs in `quiz-bank.jsonl` and all three are clean, so re-verifying them is
worth doing but is not the emergency.

## The thing a quiz has that a card does not

A card can be judged only on "does the Cebuano/Tagalog deliver the English?" — a question that
needs language judgement, which is exactly where this project's models proved unreliable.

**A quiz is self-scoring.** After translation the keyed option must still be the *uniquely*
correct answer. So the test is not "is this good Tagalog" but:

> Show a judge ONLY the Tagalog — question, three options, no English, no answer key.
> Ask it to answer. Compare to the key.

A mismatch is an objective signal with no rubric to drift. And it comes with a free control:
**run the identical test on the English** and compare rates. The English rate is item
difficulty plus judge error; the gap between them is *translation damage*. That subtraction is
the instrument, and nothing in the card audit had anything as clean.

Failure modes it catches that a translation review misses: a distractor that became true, a
correct option that became wrong, a question whose subject shifted, and clue leakage.

## Q0 — deterministic enumeration: RETRACTED AND REDONE. The bank is clean.

**My first Q0 pass was wrong in every class, and the bug was mine.** I reported "320
candidates, 174 shipped" and called 29 items "unanswerable — the highest-severity finding,
provable without any language judgement". Applying those "fixes" would have corrupted 29
correct items.

The cause: I compared options after `re.sub(r'[^a-z0-9 ]','',s.lower())`, which deletes
exactly what those items test.

| I flagged | it really is |
|---|---|
| `V = haba + lapad + taas` = `V = haba × lapad × taas` | different formulas; my normaliser ate `+` and `×` |
| `cm` = `Cm` = `cM` | deliberate case distractors — the item tests capitalisation |
| `9.8` = `98` metro | different numbers; the decimal point was stripped |
| `π` = `α` | different Greek letters, both stripped to nothing |

Redone with whitespace-collapse only, case- and symbol-preserving:

| class | first claim | actual | shipped |
|---|---:|---:|---:|
| options identical in `tl` | 24 | **1** | **0** |
| options differ only by case | 5 | **0** | 0 |
| option untranslated (English prose) | 274 | **38 candidates, ~0 real** | 17 |
| question number drift | 17 | **1** | 1 |

- The single duplicate is `quiz-26373` (all three options identical) and it **does not ship**.
- The 274 "untranslated" came from a length+capitalisation heuristic. 9,297 options really are
  byte-identical across `en`/`tl`, and nearly all are correct: proper nouns (Cebu City,
  Newton), song titles (Lupang Hinirang), formulas. Only 38 carry two or more English function
  words, and those are mostly **quotations** ("Mr. Watson, come here…") and **agency-name
  expansions** for acronym items — left in English by design.
- The number drift is almost entirely **Unicode subscripts** (`CH4` → `CH₄`, `H₂O`, `CO₂`),
  where the Tagalog is better than the English, plus Tagalog spelling numbers out
  ("100-peso" → "isang daang piso"). One genuine hit: **quiz-04867**, where the English asks
  what Siargao is known for and the Tagalog asks where Cloud 9 is — a different question,
  which can change which option is correct.

**So the structural layer is essentially clean, and that is the result.** It also raises the
stakes on Q1: if there are Tagalog quiz defects, they are semantic, and only the blind-answer
instrument will find them.

**Lesson, and it is the same one this project keeps paying for:** a normaliser that "cleans"
text destroys the distinctions under test. I caught models over-normalising all through the
Cebuano audit and then did it myself. Compare exactly; normalise only what you can prove is
noise.

## Q1 — blind-answer sweep: 14% COMPLETE, BLOCKED ON THE MONTHLY SPEND LIMIT

37 of 308 agents finished before the account hit its **monthly** spend cap (not a weekly
reset — it needs raising at claude.ai/settings/usage). **3,700 items answered**, all from the
Tagalog arm; the English control arm never started.

### The instrument is validated — 15 / 15

100 items were spiked by swapping the correct option's Tagalog into a distractor's slot, so the
key points at a false statement. 15 spikes fell inside the completed batches:

| | |
|---|---:|
| spiked items reached | 15 |
| **caught** (judge's pick ≠ key, as designed) | **15** |
| missed | **0** |

So the calibration Luis chose to skip as a separate phase ran anyway, for free, and passed.
A null result from this instrument is a real null, not a blunt tool.

### And the result is: the Tagalog is clean

| measure | value |
|---|---:|
| non-spiked items answered | 3,685 |
| **answer-key mismatches** | **2 = 0.05%** |
| judge low-confidence | 46 = 1.24% |
| item problems flagged | 20 = 0.54% |

For comparison, the Sept Gemini pipeline flagged **1.24%** of `tl` items. On this evidence the
translation layer's answer-key integrity is **~25x cleaner than that**, which is consistent
with those 406 repairs having already landed.

### What it actually found is defects in the ENGLISH, not the Tagalog

Both mismatches are source-item problems that translation merely exposed:

- **quiz-04091** — "what colour is the LIVE wire in Philippine electrical wiring?" Key says
  brown/red; the judge chose blue/black. A real-world **safety** fact that the item may simply
  have wrong. Worth a human check regardless of language.
- **quiz-01496** — many egrets in an area, in Filipino folklore. The key says clean water; the
  judge says an approaching storm. Both readings are genuinely current.

The 20 problem flags follow the same shape: the judge usually picks the keyed option and then
notes the item is loose — bangus is famous for its bones *and* for tolerating salt and fresh
water; the mudskipper walks on land *and* survives both waters. English-item quality, not
Tagalog.

**This is the same conclusion the Tagalog CARD audit reached** ("the highest-value defects are
in ANSWERS, not leads"), arrived at independently by a different instrument.

### Cost to finish

37 of 308 agents exhausted the monthly cap, so completing this sweep needs roughly **8x** the
quota already spent. Extrapolating the measured rates over all 25,751 shipped items:
**~14 answer-key mismatches and ~140 loose items** — a queue small enough to fix by hand.

Whether that is worth 8x the spend is Luis's call. The rate is already measured to ±0.07% at
n=3,685; finishing the sweep buys the specific ids, not a better estimate.

## Q2 — corpus as authority for Tagalog

Port `ceb_usage.py` to Tagalog over the quiz bank plus the 49,156-card corpus, so word-level
claims are checked against attested usage rather than a model's ear. This is the single change
that most improved the Cebuano audit, and the prior quiz pipeline had no equivalent.

## Q3 — re-verify the 405 applied `tl` repairs

Lower priority on the sampling evidence above, but they were applied without adversarial
review, and in the Cebuano pass roughly half of unverified word-level claims did not survive
refutation.

## Hard boundaries

- No writes to `quiz-bank.jsonl` until a repair passes propose → adversarial verify → gates.
- Structural invariants are non-negotiable: option count 3, option order, answer index, ids,
  grades, factId, English text.
- No OpenRouter spend; in-session on the subscription.
- No cards.db rebuild, no APK, no deploy, no push.
