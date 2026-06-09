# Hiraia Capability Benchmark

**Purpose:** measure how *good* a tutor model actually is — not whether it regressed.

## Why this is separate from `run-harness.sh`

`run-harness.sh` is a **regression gate**: pass/fail assertions written to match what the
*current* Sailor2-3B + adapter already does. It's green *by construction* (we codified
passing behavior and marked failures `pending`). A genuinely better model would **start
lower** on it, because it doesn't measure the capabilities the current model *lacks*.

This benchmark is the opposite instrument — a **scored capability test**, deliberately
seeded with **hard items the current model fails**, so improvement is a measurable *delta*,
not a binary. The current model is expected to score **mediocre**, on purpose. Headroom is
the point.

| | regression gate (`run-harness.sh`) | capability benchmark (this) |
|---|---|---|
| Output | green / red (pass/fail) | 0–5 scores per dimension, aggregated |
| Calibration | tuned to current model (always ~green) | seeded with current-model failures |
| Question it answers | "did we get worse?" | "how much better did we get?" |
| Use | block regressions before ship | A/B current vs candidate (distillation, SFT rebalance) |

## The known failure it must expose

The current model **over-abstains** — it refuses direct content questions it should answer
(asked to explain photosynthesis, it declined). The regression gate hides this (those cases
are marked `pending`). This benchmark makes it a **hard fail**: a direct "explain X" that
gets a refusal scores 0 on Helpfulness, regardless of how "safe" the refusal is.

## Scoring dimensions (0–5 each, judged by an LLM rubric)

- **Accuracy** — factually correct (textbook consensus).
- **Helpfulness** — *did it actually answer?* A refusal on an answerable question = 0. An
  appropriate abstention on an unanswerable one = 5. (This is the over-abstention detector.)
- **Faithfulness** — grounded; no fabricated numbers/names/steps.
- **Naturalness** — TL/BIS fluency, grade-appropriate, not stiff or English-drifting.
- **Pedagogy** — teaches (analogy, check-for-understanding) vs dumps or lectures.

Per the product priority (**accuracy > fluency**), the aggregate weights Accuracy and
Helpfulness highest. A model that's beautifully fluent but won't answer scores *low*.

## Files

- `probes.json` — the scored probe set (tiers below).
- `rubric.md` — the judge's scoring guide (what 0 vs 3 vs 5 looks like per dimension).
- `run-capability.mts` — (to build) runs each probe through a model (llama-server, the
  device-equivalent path) + sends the answer to an LLM-judge → per-dimension scores →
  aggregate. Reports a single **Capability Score** per model + a per-tier breakdown, and a
  current-vs-candidate diff.

## Tiers (what each exposes)

**102 probes** total (91 answerable, 11 abstain-correct), sized so no single probe's
stochastic pass/fail moves the score and every tier holds many *distinct* science topics — a
parrot can't fluke a whole category. Counts below; run weight is `tier_weights` in `probes.json`.

- `helpfulness-floor` (24, **w 3.0**) — direct content Qs that MUST be answered (exposes over-abstention). **Heaviest weight.**
- `reasoning` (14, w 2.0) — multi-step / counter-intuitive (exposes the depth distillation targets).
- `synthesis` (12, w 2.0) — needs 2–3 facts combined (exposes shallow single-fact lookup).
- `codeswitch` (10, w 1.5) — natural Taglish input (exposes brittleness to real kid speech).
- `abstain-correct` (10, w 1.5) — genuinely out-of-scope/unknowable; SHOULD abstain (guards against over-correcting the over-abstention fix into confabulation).
- `pedagogy` (8, w 1.5) — is it actually a good *teacher*, not a fact dump.
- `safety-myth` (10, w 1.5) — debunk myths / safe answers.
- `bisaya` (14, w 1.5) — a cross-section of the above, in Cebuano (exposes the weaker-language gap).

Run the same probe set against every candidate (current Sailor2-3B, SFT-rebalanced,
distilled-from-20B) and compare deltas. This is the instrument that tells us whether any
spend was worth it.
