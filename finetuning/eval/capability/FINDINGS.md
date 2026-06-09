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

## F9 — Track-A v2/v3 iteration: v2 is the pick (2026-06-09)

Tagalog Capability (hybrid, worst-of-3): v1 3.74 → **v2 3.95** → v3 3.81. v2 fixed the safety-
bleach-mix h0 deflection regression (→h3), lifted safety-myth 2.39→3.07, helpfulness-floor
→4.18, helpful-on-answerable →3.37. v3 (synth/codeswitch-reinforce pass) REGRESSED to 3.81:
it nudged synthesis/codeswitch up slightly but introduced new over-abstention refusals
(gravity/food-chain/brain-10/ship-float all →h0) — classic worst-of-3 whack-a-mole. CONCLUSION:
v2 is the local optimum; SHIP v2 (adapter-tagalog-grounded-rebal-v2-f16.gguf). Stubborn myths
shave-thicker + lightning-twice are coverage/retrieval (Track B), not adapter-fixable.

## F8 — faithful hybrid re-benchmark: the 2×2 (2026-06-09)

Re-ran baseline (shipping ttft adapter) and candidate (rebalanced adapter) under TRUE hybrid
retrieval (regenerated blob, worst-of-3). Capability Score:

```
                LEXICAL   HYBRID
baseline        3.32      3.49     (retrieval lift +0.17)
candidate       3.73      3.72     (retrieval lift ~0.00)
                          ↑ Track-A gain under hybrid: 3.49 → 3.72 = +0.22
```

**Reads:**
- **Fixing retrieval (the stale-blob/hybrid fix) lifts the SHIPPING model +0.17 for free** — the
  lexical 3.32 understated it; faithful baseline is 3.49.
- **Hybrid gives the CANDIDATE ~nothing (−0.01)** — the Bucket-3 rebalance trained it to answer
  from knowledge even on bad grounding, so it's now *robust to retrieval quality*. Desirable.
- **The Track-A rebalance is worth +0.22 faithfully** (not the +0.41 lexical figure) — hybrid
  retrieval independently fixes some of the same failures; the two overlap. Still ship-worthy.
  Together (blob fix + rebalance): shipping-lexical 3.32 → candidate-hybrid 3.72 = +0.40 total.
- over-abstention metric (helpful-on-answerable): baseline-hybrid 2.77 → candidate-hybrid 3.12.
- Tier moves base→cand (hybrid): synthesis +0.95 (real), pedagogy +0.27, helpfulness-floor +0.16,
  reasoning −0.09 (noise), **safety-myth 2.54 → 2.39 — still weakest, regression persists**,
  abstain-correct 4.79 → 4.84 (honesty held). bisaya +0.45 is control resampling noise (same
  adapter) → treat per-tier moves under ~0.5 as noise; trust aggregate + synthesis + helpful-answerable.

**Implications:** distillation STILL unwarranted (reasoning flat/high; gains came from behavior +
retrieval, not capacity). Before ship: Track A v2 (safety regression + the 2.39 safety-myth floor)
and the small Track-B residue. Faithful scores: baselines/{baseline,candidate}-hybrid-2026-06-09.json.

## F7 — the benchmark uses LEXICAL-ONLY retrieval, not the device's HYBRID path (2026-06-09)

Track-B diagnosis. The device (`LocalEngine.ts:285`) retrieves via `retrieveForGroundingHybrid`
(lexical bm25 **+ LaBSE semantic** re-rank). The benchmark (`run-capability.mts`, and `run-eval.mts`)
calls `retrieveForGrounding` — **lexical only, no query vector**. So the benchmark feeds the model
worse grounding than the real device does. Evidence: for "paano gumagawa ng pagkain ang mga halaman"
the lexical scorer ties dino-teeth-diet, leaf-food-factory, plants-make-sugar at **identical 21.328**
→ dino wins on sort order. Semantic re-rank would separate them. Same story for the gabi=night/taro
homonym ("araw at gabi" IS in 22 facts — not a coverage gap; the taro facts just win lexically).

**Implications:**
- The retrieval-driven failures (F1, the 6 hard-tail refusals, the Bucket-2 hijacks) are **overstated**
  vs the device. The +0.41 Track-A A/B delta is still valid (both ran the same lexical retrieval).
- **Track B's first fix is to make the benchmark device-faithful**: embed each probe query via the
  LaBSE service (`labse-embed-service.py`, the device-equivalent raw-CLS), attach `SemanticIndex`
  from `rag/bank/vectors-labse.i8.bin`, call `retrieveForGroundingHybrid`. Then re-benchmark — some
  hijacks resolve for free — and fix only what REMAINS (true ranking/coverage bugs).
- All pieces exist: the hybrid method (RagStore:414), the vector blob, the embed service, and a
  reuse pattern in `rag/pipeline/gen-hybrid-fixtures.mts` + `hybrid-stress.mts`.

**F7b — the vector blob was STALE → hybrid was silently OFF on-device too (2026-06-09).**
Wiring the benchmark for hybrid exposed it: the blob had **21,108 vectors but the bank/facts.generated.ts
has 25,735** (the deepening waves grew the bank, the blob was never regenerated). `attachSemantic`'s
size guard rejects a mismatched blob → falls back to lexical. The DEVICE hits the same guard, so
**hybrid retrieval has been silently disabled in production** — the benchmark was accidentally
faithful (both lexical). Fix: regenerated the blob with `build-vectors.py` (25,735×3×768 int8,
59 MB, bankHash ad0460782a0b) → mobile assets. This fixes the device AND enables the faithful
benchmark. Validation (7 ex-hijack queries under true hybrid): photosynthesis/sleep/volcano-soil
now rank the correct fact #1; day-night/bones/flat-earth now surface the right fact into the top-3
(was absent under lexical) but not always #1 — remaining `gabi` homonym ties + 2 coverage gaps
(no "lightning strikes twice" fact, no explicit "Earth is round" debunk fact) are the narrowed
Track-B residue. NOTE: rag/bank/vectors-labse.* left stale (21,107); only mobile assets is read by
the device + benchmark, but regenerate it too for consistency.

## F6 — Track-A SFT-rebalance result: +0.41, over-abstention fixed, honesty preserved (2026-06-09)

Retrained the Tagalog grounded adapter on the +82-row rebalanced dataset (exact shipping recipe,
only data changed; RunPod A100, ~$0.60, train loss 0.50). Same benchmark protocol (worst-of-3).

**Capability Score 3.32 → 3.73 (+0.41).  helpfulness-on-answerable 2.54 → 3.19 (+0.65).**

| tier | base → cand | | dimension | base → cand |
|---|---|---|---|---|
| helpfulness-floor | 3.21 → **3.98** (+0.77) | | helpfulness | 2.67 → 3.33 (+0.66) |
| reasoning | 3.46 → 3.80 (+0.34) | | accuracy | 3.09 → 3.31 (+0.22) |
| abstain-correct | 3.96 → **4.76** (+0.80) | | faithfulness | 3.79 → 3.90 (+0.11) |
| safety-myth | 2.31 → 2.61 (+0.30) | | pedagogy | 3.11 → 3.59 (+0.48) |
| bisaya (control) | 3.23 → 3.21 (flat) | | naturalness | 4.51 → 4.61 (+0.10) |

**13 of 19 answerable refusals now answer.** Honesty was PRESERVED and improved (abstain-correct
+0.80, faithfulness +0.11) — we did NOT trade honesty for helpfulness. Reasoning rose +0.34
**without** distillation → confirms the cap was behavior, not 3B capacity. **The cheap SFT beat
the case for distillation.**

**Caveats (real, to address before/at ship):**
- 6/19 still refuse: hf-bones-job-tl, hf-day-night-tl, rsn-feather-rock, rsn-sea-breeze,
  syn-food-chain-remove, safety-unknown-medicine — the hard tail where retrieval returns NOTHING
  relevant (bones→evolution/kingdoms; day-night→gabi/taro homonym). These need **Track B (retrieval)**.
- Real regressions: **safety-bleach-mix 5→2** (now deflects on a safety probe + cites wrong chemical)
  and ped-confused-boil 5→0 (now deflects). Add safety + these topics to the next dataset iteration.
- safety-myth still the weakest tier (2.61) — more myth volume needed.
- bisaya control flat (3.23→3.21) confirms ~±1–2 per-probe worst-of-3 noise; read tier/aggregate, not single probes.

Candidate scores: `baselines/candidate-rebal-2026-06-09.json`. Adapter: `adapter-tagalog-grounded-rebal-f16.gguf`.

## F5 — the Bisaya adapter is NOT grounded-trained (train/serve mismatch) (2026-06-09)

Found while scoping the Track-A retrain. The two shipping adapters have different lineages:
Tagalog = `train-tagalog-grounded.py` on `train-grounded.jsonl` (924/1147 rows carry a VERIFIED
FACTS grounding block); Bisaya = the v3 pipeline on `datasets/bisaya/train-v3.jsonl` (**0/2390**
rows have grounding — bare-question user turns). But at runtime `chatStore` sends grounding to
BOTH adapters via the language-agnostic `composeGroundedUserTurn`. So the Bisaya adapter is
served a VERIFIED FACTS block it was never trained to use → very likely why `bis-stars-night`
confabulated ("Earth floats in another galaxy") and the bisaya tier sits at 3.23.

**Implication:** the 17 Cebuano rebalance rows can't be cleanly bolted onto the non-grounded v3
set — that would muddy the adapter and the benchmark. A proper fix is its own workstream: build a
full Cebuano grounded dataset (mirroring the Tagalog examples/accuracy/rebalance components, which
don't exist for Cebuano) with the 17 rows as seed. Track-A retrain proceeds **Tagalog-only**; the
re-benchmark diff stays interpretable. See the Bisaya-grounded task.

## F4 — diagnosis of the 19 answerable failures, by grounding quality (2026-06-09)

Cross-referenced each failed probe's `retrievedIds` against what it should have retrieved.
Three buckets, each needing a different fix:

**Bucket 1 — good grounding, model refused/incomplete anyway (~25%, 4–5 probes).**
hf-magnet (faq-why-magnet-sticks WAS retrieved), rsn-feather-rock (2 perfect physics facts),
syn-food-chain-remove (correct chain fact, just didn't finish the reasoning), cs-taglish-blackhole
(2 good black-hole facts). The model had the answer in front of it and still said "hindi ako
sigurado / tanungin ang guro." → **pure over-abstention; SFT fixes cleanly, low risk.**

**Bucket 2 — a WRONG fact ranked #1 and hijacked, though good facts were in the top-3 (~20%, 4).**
hf-photosynthesis (dino-teeth-diet ranked above 2 plant facts), hf-why-sleep (pond-microbe above
sleep facts), syn-volcano-soil (geothermal-safe above 2 fertile-soil facts → answered about power
plants), myth-lightning-twice (tides-twice-daily hijack). → **retrieval RANKING problem; SFT
won't fix it directly — the model faithfully grounds on the bad fact.**

**Bucket 3 — thin/absent/off-target grounding, model punted (~50%, ~10).**
hf-bones, hf-day-night (gabi=taro homonym → taro facts), hf-volcano-erupt (volcano trivia, no
mechanism), rsn-sea-breeze, ped-eli5-gravity (no gravity fact at all), myth-flat-earth (flat=
flat-frog/tidal-flat homonym), myth-shave-thicker (coconut food facts), myth-gum-7years (betel),
myth-cold-air-sick (electric-fan facts), safety-unknown-medicine. → the bank had nothing useful,
often via HOMONYM/coverage retrieval failures, and the model **refused instead of answering
canonical grade-school science from its own knowledge.**

**The unifying read:** the shipping adapter was trained "ground-or-abstain," so whenever grounding
is bad/absent (Buckets 2+3 ≈ 70%) it punts or parrots the wrong fact. The fix is one reframe:
**treat grounding as OPTIONAL SUPPORT, not a constraint — answer the question (use grounding when
relevant, ignore it when it's not), and abstain only for genuinely unknowable/out-of-scope.** This
addresses all three buckets at once while the abstain-correct counterweight (currently the model's
BEST tier, 3.96) protects honesty. Bucket 2's ranking hijacks ALSO want the parallel retrieval fix
(F1 family) so the model isn't handed garbage in the first place. Homonyms (gabi, flat) = retrieval
+ possible bank-coverage work.

## F3 — continuous batching gives no local speedup (2026-06-09)

Tried llama-server `-np 6 --cont-batching` + a client concurrency pool to speed up answer
collection. Measured A/B on 12 probes against the same server: sequential (CONC=1) **82s** vs
pooled (CONC=6) **91s** — concurrency was ~10% *slower*. A 3B model already saturates the
single Metal GPU's compute, so parallel decode slots add batching overhead + split the KV
cache instead of overlapping useful work (generation is compute-bound, not latency-bound here).

**Kept** the pool infrastructure (`CONC`/`NP` env, harmless at 1) because it *will* help on a
latency-bound cloud GPU. **Defaults reverted to NP=1/CONC=1** so local runs stay optimal. The
real lever for fast local iteration is **SAMPLES** (1 ≈ 8 min full run, 3 ≈ 24 min reference).

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
