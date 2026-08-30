# GRPO RL stage — adherence training (built overnight 2026-06-10)

Trains the *behavior* layer on top of the grounded SFT adapter: stick to the VERIFIED
FACTS block, don't inject unrelated material, abstain only when genuinely unanswerable,
stay brief. Rewards are 100% programmatic — **no Anthropic/LLM calls in the training
loop** (so the AUP child+biology false-positive problem can't wedge a run).

## Files

- `build-rl-prompts.mts` — prompt-set generator. Imports the SAME runtime functions as
  the app + SFT builder (`generateSystemPrompt`/`formatGroundingBlock`/
  `composeGroundedUserTurn`) and the same bank (`rag/bank/science-facts.jsonl`) → train/serve lockstep.
  Rerun: `node_modules/.bin/tsx finetuning/rl/build-rl-prompts.mts` (seed=42, deterministic).
- `prompts/rl-prompts.tagalog.jsonl` (3500 = 2800 tl + **700 en**) /
  `prompts/rl-prompts.bisaya.jsonl` (1700) / `prompts/STATS.md`. Buckets: grounded 50% /
  distractor 15% / **knowledge 10%** (mismatched grounding + answerable basic question →
  answer from knowledge, don't parrot the block — aligned with the Track-A/F4 rebalance
  direction, NOT punished as confab) / abstain 10% (hand-written unanswerable specifics) /
  chitchat 10% / trap 5% (over-abstention counters, messy phrasing). LIVING_THINGS capped
  at 45%. **English rows ride in the tagalog file** (added 2026-06-11): hackathon judges
  use English (tier-1); the capability A/B showed the tagalog adapter beats the base-model
  English path 3.75 vs 1.78 but drifts into Tagalog on English questions — the en rows +
  the `language` reward component train that out. No separate English LoRA.
- `reward.py` — scorer: faithfulness .35 / no-injection .25 / abstention .15 / language .10
  / length .10 (≤86 tok full, 0 at 171 — calibrated to SFT mean 57) / image-tag .05.
  Ports REFUSAL_MARKERS + term matching from `eval/harness/run-eval.mts` (+NFD accent
  folding). TRL-compatible `grpo_reward()` wrapper. Tests: `python3 finetuning/rl/test_reward.py`
  (14/14 green). `contradiction_penalty()` is a stub hook for a future judge pass.
- `train-grpo.py` — Unsloth GRPO continuation from an existing SFT LoRA
  (base `sail/Sailor2-3B-Chat`, r=32/α=64 rebuilt + state-dict-loaded — avoids unsloth
  #1877). Defaults: 600 steps, group 6, lr 5e-6, KL β=0.04, temp 0.8, 256 max new tokens.
  `python3 -m py_compile` clean; needs the pod to actually run.
- `RUNPOD.md` — pod runbook: pinned venv, training commands (tagalog + bisaya), GGUF
  conversion (`convert_lora_to_gguf.py … --outtype f16`), and the in-session
  eval-before-terminate step.

## Verified end-to-end (integration smoke — `python3 finetuning/rl/smoke_reward.py`)

Calibrated 2026-06-11 (run the smoke before every pod run; exits non-zero on inversion):

| pair (same prompt, real generated rows) | scores | gap |
|---|---|---|
| grounded: faithful vs refusal | 1.00 vs 0.25 | +0.75 ✓ |
| distractor: gold-only vs +forbidden injection | 0.65 vs 0.40 | +0.25 ✓ |
| abstain: honest vs fabricated specifics | 1.00 vs 0.50 | +0.50 ✓ |
| chitchat: warm vs lecturing | 0.95 vs 0.75 | +0.20 ✓ |
| knowledge (Track-A/F4): answer vs parrot-block | 0.75 vs 0.40 | +0.35 ✓ |
| knowledge: answer vs refusal | 0.75 vs 0.25 | +0.50 ✓ |
| trap: answer vs refusal | 1.00 vs 0.25 | +0.75 ✓ |
| en grounded: answer vs refusal | 1.00 vs 0.15 | +0.85 ✓ |
| en grounded: EN answer vs Tagalog drift | 1.00 vs 0.84 | +0.16 ✓ |

(distractor row re-sampled when en rows were merged into the tagalog file — gap held.)

Also eyeballed against four REAL gate-v5.log failure transcripts (wrong-physics
astronaut, fabricated biggest-star, 442-char chitchat lecture, paraphrased
photosynthesis) — all ordered below their good counterparts.

### Calibration log (2026-06-11, D1 checklist items 1–2 — DONE)

- Honest abstention now earns faithfulness too ("faithful to not-knowing") → total
  1.0, not capped at 0.65; fabricated specifics (digit / mid-sentence proper-noun
  bigram detector) zero both faithfulness and abstention.
- Chitchat: lecture penalty 0.4 → 0.6 per science term; brevity 60/150 → 40/100
  tokens (gate fails chitchat at ~58 words; a no-science pep-talk scored 0.99 before).
- Required terms: ONE free miss on 4+-term rows (70% of grounded rows have 4 terms,
  some morphology-fragile — demanding 4/4 teaches verbatim parroting).
- **Plumbing bug found by the smoke**: `kind`/`lang` are TOP-LEVEL row fields, not in
  `meta` — chitchat + language scoring silently no-oped. Fixed in `train-grpo.py
  to_row` (merges them into meta; also stopped collapsing `expect_image: None`→False).

## Before spending pod money (D1 checklist)

1. ~~Calibrate the two thin margins~~ DONE 2026-06-11 (see calibration log).
2. ~~Eyeball rewards on real model outputs~~ DONE 2026-06-11 (gate-v5 transcripts).
3. Judge the overnight capability answers in-session → baseline score + failed probes →
   consider appending them as extra RL prompts (failure-mined hard set, medPSY-style).
4. ~~Verify the bisaya init adapter~~ DONE 2026-06-11: shipping
   `adapter-sailor-bisaya-f16.gguf` ← `bisaya-sailor-v3/final-adapter` (md5 match).
5. Pod risk #3: watch the first `[reward]` lines — mean should reflect SFT-quality
   behavior, not base-model (vLLM weight-sync of the pre-loaded adapter).
