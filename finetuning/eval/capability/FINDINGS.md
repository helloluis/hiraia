# Capability Benchmark — Findings

Running log of what the benchmark surfaces. These are **not** bugs to fix before running
the benchmark — the benchmark measures the *holistic* device experience (retrieval + model),
so a retrieval miss is a legitimate capability failure and is allowed to score low. We fix
these when we're ready to benchmark a new model, not before.

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
