# Full-run mix (mix-v1) — built 2026-08-24

**Location:** volume `1atl7503ky` (`hiraia-cpt-corpus`, US-NE-1)
`/workspace/fullmix/mix-v1/full-mix.jsonl` — 21,730,569,538 B (20.2 GiB)
Held-outs: `/workspace/fullmix/eval/heldout-{tl,ceb,en}.jsonl` (5k / 5k / 2k)

## What it is

**One "mix epoch" that the trainer loops 4×.** Repetition is expressed as copies inside the
file, not as four passes on disk — 20GB instead of 80GB, and a 4.5-minute build.

| slice | in mix | × 4 epochs | share | effective epochs |
|---|---|---|---|---|
| tl | 4.297B | **17.19B** | 69.4% | 4 |
| ceb | 0.347B (2 copies) | **1.39B** | 5.6% | **8** |
| en anchor | 1.030B | 4.12B | 16.6% | <1 |
| zh anchor | 0.520B | 2.08B | 8.4% | <1 |
| **total** | **6.19B** | **24.78B** | | |

Docs: tl 17,855,407 · ceb 689,426 · en 1,490,519 · zh 522,654.

## Why these ratios

- **tl at exactly 4 epochs** — the efficient frontier; ≤4 epochs of repeated data behaves close
  to fresh data, beyond that returns decay.
- **ceb at 5.6%, not the originally planned 12%** — forced by measurement, not preference.
  Consolidation found only **0.178B distinct Cebuano tokens** (less than half the June estimate
  of 0.37B). Twelve percent would demand ~17 epochs of a 350k-doc pool: memorisation, not
  learning. The mission leans instead on Tagalog→Cebuano cross-lingual transfer (the Sailor2
  bet) plus synthetic pedagogical Cebuano at anneal time.
- **25% anchor** — the probe measured English held-out ppl at +1.5% (retained) with ~23.5%
  anchor, so this ratio has direct evidence behind it.

## Provenance and integrity

- Sources: consolidated v1+v3+v2 (cross-version deduped, 14.0% of tl dropped as duplicates),
  anchors from `corpus/raw/anchor-{en,zh}`.
- **Held-outs carved fresh from the consolidated pools** — the probe's came from v1 only and no
  longer represent a corpus that is now largely v2/v3 material.
- **Leak check: 0 exact duplicates** of held-out docs in the mix. 10 of 5,000 share a 400-char
  prefix with a training doc (different bodies) = 0.2% near-duplicate overlap.
- tokens/byte calibrated per slice by sampling with the real tokenizer (tl 0.31138, ceb 0.31798,
  en 0.22492, zh 0.24395) — byte-based on purpose, since Chinese is ~3 bytes/char and a
  chars-vs-bytes mix-up would mis-size the zh anchor ~3×.

## Before launching the full run

1. **Keep dataset shuffling on** (HF Trainer default). Interleaving is block-based at 120M
   tokens, so ~350k consecutive tl docs can appear in file order; shuffling makes that
   irrelevant, and the probe trained smoothly on the same scheme. Do not switch to
   `--streaming` without re-checking this.
2. **Do NOT wait for synth-ceb.** By 2026-08-28 it reaches ~1.8M tokens: ~1% of the distinct
   ceb pool, and after 8x upsampling **0.058% of the 24.78B tokens trained**. Rebuilding this
   mix for that is not worth a four-day delay, and uniform mixing would not capture its value
   anyway. Its register (clean, pedagogical, child-appropriate) pays off in two places that do
   **not** gate this run: **SFT data**, and optionally a short **anneal phase afterwards** —
   annealing means concentrating high-quality data in the final decay steps, which is a separate
   run, not an edit to this mix.
3. Steps: at a 4.19M-token global batch, 24.78B tokens ≈ **5,900 steps**.
