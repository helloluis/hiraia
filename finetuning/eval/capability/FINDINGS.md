# Capability Benchmark — Findings

Running log of what the benchmark surfaces. These are **not** bugs to fix before running
the benchmark — the benchmark measures the *holistic* device experience (retrieval + model),
so a retrieval miss is a legitimate capability failure and is allowed to score low. We fix
these when we're ready to benchmark a new model, not before.

---

## Baseline — current shipping model (2026-06-09)

Sailor2-3B-Chat.Q4_K_M + shipping adapters (tagalog=`adapter-tagalog-ttft-f16`,
bisaya=`adapter-sailor-bisaya-f16`), temp 0.7, worst-of-3 sampling, 102 probes, judged by
the subscription judging workflow. Saved: `baselines/current-2026-06-09.json` (use as
`BASELINE=` for candidate diffs).

**Capability Score: 3.32 / 5**  ·  **helpfulness on answerable probes: 2.54 / 5** (over-abstention metric)

| dimension | score | | tier | score (w) |
|---|---|---|---|---|
| accuracy | 3.09 | | safety-myth | **2.31** (1.5) ← weakest |
| helpfulness | 2.67 | | helpfulness-floor | 3.21 (3.0) |
| faithfulness | 3.79 | | bisaya | 3.23 (1.5) |
| naturalness | **4.51** | | synthesis | 3.44 (2.0) |
| pedagogy | 3.11 | | reasoning | 3.46 (2.0) |
| | | | pedagogy | 3.50 (1.5) |
| | | | codeswitch | 3.76 (1.5) |
| | | | abstain-correct | **3.96** (1.5) ← best |

**Read:** the model is **fluent** (naturalness 4.51) and **honest** (faithfulness 3.79,
abstain-correct its best tier at 3.96) but **won't reliably answer** (helpfulness 2.67;
**19 of 91 answerable probes scored helpfulness 0** — outright refused/deflected). Crucially,
**reasoning (3.46) is one of the HIGHER tiers**, not the floor — so the score is capped by
*behavior* (over-abstention) and *retrieval* (hijacks), NOT reasoning capacity. This is the
evidence for the gated plan: a cheap SFT-rebalance should move the needle far more than
distillation. Re-run the benchmark after Step-1 SFT and diff against this baseline.

**The 19 answerable refusals/deflections:** hf-photosynthesis-tl, hf-why-sleep-tl,
hf-bones-job-tl, hf-magnet-tl, hf-day-night-tl, hf-volcano-erupt-tl, rsn-feather-rock,
rsn-sea-breeze, syn-volcano-soil, syn-food-chain-remove, cs-taglish-blackhole, ped-eli5-gravity,
myth-flat-earth, myth-shave-thicker, myth-gum-7years, myth-cold-air-sick, myth-lightning-twice,
safety-unknown-medicine, bis-stars-night. (Some — photosynthesis, sleep — are F1-style retrieval
hijacks, not pure abstention; the rest are "tanungin ang guro mo" refusals.)

## F2 — safety-myth is the weakest tier (2.31) (2026-06-09)

Myth-debunking underperforms across the board (brain-10%, flat-earth, shaving, swallowed gum,
cold-air-colds, lightning-twice). The model either refuses ("tanungin ang guro") or fails to
clearly state *hindi totoo* + the correct fact. For a kid science tutor this matters as much as
the helpfulness-floor — debunking is a core job. The SFT-rebalance set should include myth→clear-
debunk pairs, not just answerable-content pairs. Re-check this tier specifically after Step 1.

---

## F1 — Retrieval hijacks the flagship photosynthesis probe (2026-06-09)

**Probe:** `hf-photosynthesis-tl` — *"Ipaliwanag mo nga kung paano gumagawa ng pagkain ang
mga halaman."* (the single most important helpfulness-floor item).

**Observed (smoke test, shipping tagalog adapter `adapter-tagalog-ttft-f16.gguf`, temp 0.7):**
top-3 retrieved facts were `dino-teeth-tell-diet-g5`, `leaf-is-food-factory-g4`,
`plants-make-sugar-food-g6`. The dinosaur-teeth fact ranked **first**, so the model grounded
on it and answered about **how dinosaur teeth reveal diet** — not photosynthesis at all.

**Cause (hypothesis):** the query's "gumagawa ng **pagkain**" (makes *food*) tokens collide
with the dino *diet/eating* fact's terms; lexical IDF + topic weighting floats it above the
two correct plant facts that are right there in the candidate set.

**Why we're leaving it:** any model we benchmark rides the same retrieval, so this is part of
the holistic score we want to measure. Capturing it as a baseline data point. The fix
(retrieval-side: de-weight diet/eating collisions, or boost the plant-food facts for this
query) belongs to the retrieval-quality pass we'll do alongside the new-model benchmark.

**Where it'll show up in scores:** low Accuracy + low Helpfulness on `hf-photosynthesis-tl`
(answered the wrong question). If a candidate model scores high here, confirm it's because
retrieval improved — not because the model ignored the (wrong) grounding.

**Related:** the QUERY_STOP / FIELD_WEIGHT tuning in `packages/shared/src/rag/RagStore.ts`;
the lexical retrieval stress tests in `rag/pipeline/retrieval-stress.*`.
