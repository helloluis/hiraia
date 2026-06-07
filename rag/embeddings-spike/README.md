# Embeddings spike — multilingual-e5-small (decision: SHIP IT)

Validates a semantic + lexical hybrid before building the on-device integration.
Run: `tsx lexical.mts` → `.convert-venv/bin/python embed.py` → `python compare.py`.

## Verdict (2026-06-07): build the hybrid on **e5-small**.
- Model: `intfloat/multilingual-e5-small` (118M, 384-dim). On-device ~80MB GGUF
  via `@qvac/embed-llamacpp`; corpus vectors = **~8MB int8** for all 21k facts.
  bge-m3 rejected: ~350-600MB on-device is untenable on the 4GB target.
- **Lexical and semantic cover COMPLEMENTARY blind spots:**
  - `utak`→brain: lexical FAILS (#7, returns sleep/yawn), semantic NAILS (#1).
  - `baga`→lungs: lexical NAILS (#1, after topic fix), semantic FAILS (#6, e5-small
    ceiling on Tagalog medical terms).
- **Hybrid (RRF, ~equal weight) = 8/8**, beating lexical-only (7/8) and
  semantic-only (7/8). The hybrid recovers each component's miss.
- Abstain floor: on-topic semantic top-1 cosine ranges **0.86–0.93** → a floor
  around ~0.80 is a sane starting point (tune with off-topic negatives).
- Homonym holdouts e5-small misses (like `baga`) are cheaper to fix with a
  one-line topic-weight tweak in the bank than by shipping a bigger model.

## Benchmark (2026-06-07) — 450 labeled queries + 40 negatives
Built `benchmark.jsonl` via gen-queries.workflow.js (16 agents): realistic kid
queries → gold fact id, multilingual (TL/BIS/EN/Taglish) × styles, phrased in a
kid's words (fair to lexical). Eval = bench-embed-corpus.py (e5 + LaBSE, per-lang)
+ bench-lexical.mts (RagStore) + bench-run.py (Recall@k/MRR, lang-scoped).

| method | R@1 | R@3 | R@5 | MRR |
|---|---|---|---|---|
| lexical | .291 | .509 | .598 | .420 |
| e5 | .340 | .538 | .627 | .455 |
| LaBSE | .316 | .507 | .580 | .427 |
| hybrid-e5 | .364 | .611 | .687 | .511 |
| **hybrid-LaBSE** | **.404** | **.624** | **.707** | **.536** |

**Conclusions:** (1) Hybrid (RRF lexical+semantic) beats every single method by ~+10pt
R@3 — ship the hybrid. (2) hybrid-LaBSE wins Cebuano/Taglish/Tagalog (e5 wins only
English) AND LaBSE is BERT-native (runs on QVAC where e5/XLM-R was broken) → LaBSE
is the pick despite ~270MB Q4 footprint. (3) abstain floor ~0.86 keeps 88% pos /
rejects 92% neg (usable, overlapping). Caveat: single-gold Recall = lower bound.
