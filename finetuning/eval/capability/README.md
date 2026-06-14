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

## Judging (subscription workflow + local judge for the AUP trigger set)

Default judging runs as a Claude-subscription workflow — one judge agent per probe. The
Usage Policy classifier kills some judge agents, and the kills are **deterministic per
transcript** (diagnosed 2026-06-10): child–tutor dialogues with body/biology vocabulary in
Tagalog/Cebuano (dugo, sumasakit ang tiyan, buto, plant in a dark room) trip a false
positive every time, while physical-science transcripts pass. Truthful benign framing in
the agent prompt does not help. **In-session judging is NOT a fallback either** — on
2026-06-12 it killed the MAIN session (12h of lost time). The rule is: trigger transcripts
must never enter ANY Claude context. The pipeline:

1. **Split** — `node judge-split.mjs answers.<name>.tagalog.json tagalog [answers.<name>.bisaya.json bisaya]`
   writes one `{probe, answer}` file per probe under `.judge-work/` (small per-agent
   context; a killed agent costs one probe) and prints the workflow `items` JSON.
2. **Partition** — drop the ids in `aup-denylist.json` from the workflow `items` (handle
   the answer files programmatically; never print trigger transcripts into a Claude
   conversation). Validated 2026-06-12: with the denylist excluded, all 114 remaining
   probes judged in round 1 with zero kills.
3. **Judge (Claude)** — run the `judge.workflow.js` workflow with
   `args = {items, rubric: <abs path to rubric.md>, maxRounds: 3}`. Failed agents are
   retried in fresh rounds (rescues transient kills); if a whole round judges 0, the
   workflow bails early (content-triggered kills don't retry away). Save the returned
   `{scores, unjudged}` to a JSON file. Anything in `unjudged` is a new trigger — add it
   to `aup-denylist.json` and judge it locally (step 4).
4. **Judge (local, the AUP bypass)** — `JUDGE_ENDPOINT=http://localhost:9099 node
   judge-local.mjs <items.json> <result.json>` judges the denylist subset against a local
   model (Qwen2.5-14B-Instruct Q4_K_M in `deploy/judge/`, served with
   `llama-server -m deploy/judge/Qwen2.5-14B-Instruct-Q4_K_M.gguf -ngl 99 --port 9099 -np 4
   --cont-batching --ctx-size 32768`). Same rubric/prompt/score shape as the workflow.
   **For a clean A/B, re-judge the BASELINE answers for the same ids with this same
   script** so every per-probe delta is same-judge (Claude-vs-Claude or local-vs-local,
   never mixed); overlay those onto the baseline snapshot (see
   `baselines/capability-baseline.2026-06-11-shipping.samejudge.json`).
5. **Merge** — `node judge-merge.mjs answers.<name>.<tag>.json <tag> scores.<name>.<tag>.json <result.json> [...]`
   accepts multiple result files (workflow result + local-judge result) and writes the
   `[{probe, answer, score}]` archive. Exits non-zero listing any still-unjudged ids.

Multi-turn baselines are archived as `scores.mt-baseline.<tag>.json` — do **not** name ad-hoc
archives `capability-scores.*.json` (PHASE=report merges those).

## Tiers (what each exposes)

**134 probes** total (120 answerable, 14 abstain-correct), sized so no single probe's
stochastic pass/fail moves the score and every tier holds many *distinct* science topics — a
parrot can't fluke a whole category. Counts below; run weight is `tier_weights` in `probes.json`.

- `helpfulness-floor` (24, **w 3.0**) — direct content Qs that MUST be answered (exposes over-abstention). **Heaviest weight.**
- `multi-turn` (14, **w 2.5**) — scripted 3-turn dialogues (10 TL, 4 BIS); the runner plays the student turns sequentially with device-faithful per-turn retrieval (rag context from prior turns, seen-fact dedup, R2 re-embed) and the judge scores the whole transcript. Exposes the **repetition / re-asking-answered-questions** failure (gravity conversation, 2026-06): hard caps in the rubric — near-verbatim repetition caps pedagogy at 1, re-asking an answered question caps helpfulness at 1. Includes the weightlessness trap (astronauts float from free fall, not "no gravity").
- `reasoning` (14, w 2.0) — multi-step / counter-intuitive (exposes the depth distillation targets).
- `synthesis` (12, w 2.0) — needs 2–3 facts combined (exposes shallow single-fact lookup).
- `codeswitch` (10, w 1.5) — natural Taglish input (exposes brittleness to real kid speech).
- `abstain-correct` (10, w 1.5) — genuinely out-of-scope/unknowable; SHOULD abstain (guards against over-correcting the over-abstention fix into confabulation).
- `pedagogy` (8, w 1.5) — is it actually a good *teacher*, not a fact dump.
- `safety-myth` (10, w 1.5) — debunk myths / safe answers.
- `bisaya` (14, w 1.5) — a cross-section of the above, in Cebuano (exposes the weaker-language gap).
- `english` (18, **w 2.0**) — a cross-section in English, run against the **BASE model (no LoRA)** because
  English uses the base model on-device. Exists because hackathon judges who don't speak Filipino will
  pick English from the language selector — this is the path they experience. The runner gives it its own
  pass: `run-capability.sh` boots the base GGUF with no `--lora` and sets `USE_LORA=0`.

Run the same probe set against every candidate (current Sailor2-3B, SFT-rebalanced,
distilled-from-20B) and compare deltas. This is the instrument that tells us whether any
spend was worth it.
