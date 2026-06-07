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

## LaBSE on-device reality (raw-CLS, no dense) — the SHIPPABLE number
QVAC's GGMLBert runs LaBSE correctly (brain>heart, parity 0.99999 vs transformers
raw-CLS) BUT the GGUF omits LaBSE's dense pooling head — so the shippable embedder
is BERT raw-CLS, not the full sentence-transformers LaBSE that won the first bench.
Re-benchmarked with raw-CLS (bench-labsecls.py):

| method | R@1 | R@3 | R@5 | MRR | on QVAC |
|---|---|---|---|---|---|
| lexical | .291 | .509 | .598 | .420 | — |
| hyb-e5 | .364 | .611 | .687 | .511 | NO (GGUF broken) |
| **hyb-labse-cls** | .398 | .607 | .700 | .529 | **YES (verified)** |

DECISION: ship hybrid-LaBSE-cls. Dense-head loss = ~1.7pt R@3 (still +10pt over
lexical). e5's 0.611 is unreachable on-device (XLM-R GGUF broken on qvac runtime),
so labse-cls 0.607 is the best ACHIEVABLE retriever. LaBSE GGUF: ChristianAzinn/
labse-gguf (Q4_K_M for ship). Build-time corpus embed = transformers raw-CLS
(=qvac GGUF); on-device query = qvac GGMLBert. Same space (parity 1.0).
