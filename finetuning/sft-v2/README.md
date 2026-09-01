# SFT v2 — the card-writer data build

Rebuilds the SFT mix for the surface that actually exists at runtime: the model is a
SINGLE-TURN CARD WRITER (`buildCardPrompt` → one ≤30-word printed card), not a chat tutor.
Design, per-bucket judge acceptance and deltas vs v1: **DATA-CARD.md**. Training driver
(prepared, NOT launched): **driver.sh**.

## Pipeline (all stages resumable via `out/cache/`)

```bash
set -a; source /Users/luis/Code/hiraia/.env.local; set +a       # FIREWORKS_API_KEY
finetuning/eval/harness/embed-serve.sh &                        # LaBSE on :8090 (real retriever)

tsx=node_modules/.bin/tsx
$tsx finetuning/sft-v2/bust-cache.mts  # after ADDING a lint rule: invalidate cache entries it
                                       # forbids so the next run REGENERATES them (vs dropping)
$tsx finetuning/sft-v2/reshape.mts     # v1 chat mix -> card-core bucket (drops logged)
$tsx finetuning/sft-v2/generate.mts    # 6 targeted buckets (BUCKETS=safety,thin,... to subset)
$tsx finetuning/sft-v2/judge.mts       # 100% decorrelated judging (gpt-oss-120b; safety at
                                       # reasoning_effort medium — low missed a legal misclaim)
$tsx finetuning/sft-v2/merge.mts       # -> out/train-v2.jsonl (+ meta sidecar); hard-fails on v1 strings
$tsx finetuning/sft-v2/validate.mts    # final gate; -> out/validation.json
```

Env: `FW_CONC` (default 16), `LIMIT`/`GEN_LIMIT` (smoke slices), `EMBED_ENDPOINT`,
`FW_GEN_MODEL` / `FW_JUDGE_MODEL`.

## Load-bearing rules

- The training user turn is the **imported** `buildCardPrompt` from
  `packages/shared/src/prompts/cards.ts` — never a copied string. `validate.mts` re-renders
  every row and asserts byte-identity.
- **AUP routing:** TL/BIS child-body content is generated AND judged on Fireworks
  (writer `qwen3p7-plus`, judge `gpt-oss-120b` — decorrelated families). Scripts print ids
  and stats only; content stays in files. Seed topics are authored in English.
- Grounding comes from the **real runtime retriever** (RagStore + LaBSE blob + `isOffDomain`),
  so the training fact-distribution matches inference.
- Every reject is logged with a reason (`out/rejects-*.jsonl`), never silently dropped.
- Contamination: any row whose query answers one of the 45 gate cases or the arbitration
  suites is dropped (checked at reshape, generate, merge AND validate) — exact normalised
  key PLUS a fuzzy content-token Jaccard ≥ 0.6 pass (exact-only let ~21 near-verbatim twins
  through, turning the post-training gate A/B into a memorization measurement).
- No card may talk ABOUT the FACT block ("Walang impormasyon sa mga FACTS…"), speak as
  Hiraia, invite questions, or quote a hedge; chitchat/persona queries ("hi hiraia",
  "sino ka po?") are never trained — they route model-free at runtime.
- Identical (lang, card) targets cap at 3 (`CARD_TEXT_CAP`) — measured pre-cap: one Mercury
  sentence ×10 across queries, 700 rows in duplicate-target groups.
- Cebuano rows are seeded from authentic Cebuano (bucket-ceb-neutral / bisaya v5) — the
  synth-ceb lesson. A human Cebuano spot-check before training is still on the checklist.
