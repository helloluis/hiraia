# Probe CPT config — Qwen3.5-2B → Filipino (checklist ① artifact)

**Status: DRAFT 2026-08-21** (funding confirmed; corpus cleaning in progress on `hiraia-cpt-corpus`).
This is the written spec for the **~6B-token probe CPT** (CPT-FLAGSHIP-PLAN.md §6 de-risk gate) and
the config the **1-GPU stack smoke test** (checklist ②) validates in miniature. Full-run config
derives from this after the probe reads out.

## 1. Base model & precision

- `Qwen/Qwen3.5-2B-Base` @ HF revision pinned at download (record in run manifest; repo unchanged
  since Apr 2026). Arch: 24 layers, 3:1 Gated DeltaNet : gated full attention, hidden 2048,
  vocab **248,320 untied** (embedding+head ≈ 1B of the 2B params — optimizer memory is
  embedding-dominated).
- **bf16 everywhere. No QLoRA/4-bit** (explicitly not recommended on Qwen3.5 — abnormal quant
  deltas on the GDN blocks). Full-parameter training.
- **Text-only verification is a smoke-test gate**: model card mentions early-fusion multimodal
  training and the repo carries `video_preprocessor_config.json`. Assert the training path loads
  `Qwen3_5ForCausalLM` (text config) with **zero vision params in the optimizer/shards**.
- Non-thinking regime is an SFT-stage concern (base model has no chat template); carry
  `enable_thinking=false` into stage-2+ configs.

## 2. Stack + pins (from the 2026-08-21 landscape audit)

| Component | Pin | Why |
|---|---|---|
| trainer | **ms-swift ≥ 4.3.1, Megatron backend** | only documented Qwen3.5 full-param CPT path; packing + fused kernels |
| megatron-core | **≥ 0.16** | GatedDeltaNet support; removes num_query_groups TP limit |
| mcore-bridge | ≥ 1.1.0 | CP training for GDN (not needed at 4k seq, pin anyway) |
| transformers | ≥ 5.2 (use current 5.15.x) | Qwen3.5 classes |
| flash-linear-attention (`fla`) | **0.4.2 (NOT 0.5.0)** | 0.5.0 `chunk_gated_delta_rule` emits corrupted output (fla-org#792) |
| causal-conv1d | latest | install AFTER uninstalling any conflicting fla per axolotl order note |
| Python / CUDA | 3.12 / 12.8+ | fla rec.; 12.8+ required for B200 (Blackwell) |
| llama.cpp (ship path) | **≥ b10152** | GDN fused-kernel layer-count fix; hybrid convert bug #24737 → smoke-test our own convert |

**Job-start assertions (hard-fail, not warnings):** ① fla + causal-conv1d kernels actually loaded
(missing → transformers **silently falls back** to slow PyTorch ops — a silent budget killer);
② fixed-length packed batches only (fla #758: Triton recompiles per distinct seq len);
③ no vision params in optimizer; ④ tokenizer vocab == 248,320.
Fallback stacks if ms-swift fights us: NVIDIA Megatron Bridge (has dense 0.8–27B text pretraining
recipes) → Axolotl FSDP2 (needs fla for packing).

## 3. Probe data mix (~6B tokens)

> **BUILT 2026-08-22 — measured reality:** mix = **~5.1B tokens** at
> `corpus/tokenized/probe-mix-v1/probe-mix.jsonl` (block-interleaved, `source`-tagged).
> Measured chars/token: tl 3.20 / ceb 3.12 / en 4.38 / zh 1.45. Actual slices: tl **3.07B**
> (2 epochs — v1 is 1.53B/epoch, not the 3.9B the inventory penciled), ceb **0.33B** (2 ep ×
> 167M), en 1.2B, zh 0.5B. Ratios hold (~60/6.5/23.5/10). Held-outs carved first (5k tl / 5k
> ceb / 2k en; en from reserved shard `014_00000.parquet`). NOTE: the on-volume
> `MIX-MANIFEST.json` over-reports tl/ceb (script wrote target-on-exhaustion; the build log's
> `[exhausted]` lines are authoritative). Full-run consequence: v1 caps tl at 6.1B over 4
> epochs → the expansion corpus (CORPUS-EXPANSION-BRIEF.md) is REQUIRED for the 25B mix.

Ratios follow §5b-C scaled down; all from the SailCraft-cleaned pools on `hiraia-cpt-corpus`
(US-NE-1) + already-clean anchors. Qwen tokenizer counts (~2.0 tok/word).

| Slice | Tokens | Source | Epochs |
|---|---|---|---|
| tl | ~3.6B (60%) | cleaned `pool_tl` final_output | ~1 |
| ceb | ~0.7B (12%) | cleaned `pool_ceb` final_output (340,960 docs) | ~2 (upsampled) |
| en anchor | ~1.2B (20%) | fineweb sample-10BT subset | <1 |
| zh anchor | ~0.5B (8%) | fineweb-2 cmn_Hani 10-shard slice subset | <1 |

- **Held-out carve-outs FIRST**: 5,000 docs each tl/ceb (+2,000 en) split off the cleaned pools
  before tokenization → `eval/heldout-{tl,ceb,en}.jsonl`. These are the perplexity eval sets;
  never trained on.
- Tokenize with the Qwen3.5 tokenizer → packed 4096-token sequences, document-shuffled
  (lesson from the SailCraft shard-imbalance incident: **shuffle before sharding, always**).
  Interleave slices by ratio per ~100M-token block (no long monolingual runs).

> **RUN-2 CHANGELOG (2026-08-23, post pre-flight verdict — 7-agent adversarial review):**
> Run 1 trained rank-8 LoRA (`swift pt` defaults `tuner_type=lora`; `--tuner_type full` is the
> 4.5.2 fix, empirically verified against the installed wheel). Run-2 deltas vs the table below:
> **backend = HF-Trainer via ms-swift (Megatron deferred to full run)**; **DeepSpeed ZeRO-2**
> (full-param states don't fit plain DDP on 80GB — all run-1 memory/throughput data was
> LoRA-contaminated); **global batch restored to ~4.19M tokens** (bs2×ga64×8×4096; 1,225 steps
> ≈ 5.13B tok; save/eval every 125 steps = 500M tok) so LR 8e-5 sits in the spec's validated
> regime; **WSD scheduler** per spec (decay last 185 steps → 0.1×, re-warmable; cosine fallback
> documented if kwargs fight); stack pinned (ms-swift==4.5.2, transformers==5.15.1,
> torch==2.11.0, fla==0.4.2); canary gates: full-ckpt size (3–6GB band), memory ≤72GiB,
> loss/grad sanity, **projected-cost abort >18h**; epoch note: tl slice ≈1.2 epochs unique.
> Honest cost: **$330–420 / 12.5–16h on 8×H100** (B200 path deferred — needs a cu12.8+ image).

## 4. Hyperparameters (probe)

| Param | Value | Note |
|---|---|---|
| seq len | 4096, packed fixed-length | fla #758 |
| global batch | ~4M tokens (1024 × 4096) | Sailor2-recipe scale; stable at 2B |
| peak LR | 8e-5 | CPT-conservative for a well-trained base |
| schedule | **WSD**: warmup 1% (~15 steps... use 100 steps floor), stable, decay final 15% → 0.1× peak | re-warmable for the full run |
| optimizer | AdamW β(0.9, 0.95), wd 0.1, grad clip 1.0 | standard |
| steps | ~1,500 (≈6B tok @ 4M) | |
| checkpoint + eval | every 125 steps (~500M tok): held-out ppl (tl/ceb/en) + 20-prompt greedy gen battery | trajectory is the deliverable |
| hardware | 8×B200 preferred (~same $ as H100, ~half wall-clock; smoke Blackwell first), else 8×H100 SXM | pure DP, no TP needed at 2B |

Probe cost estimate: 6·N·D ≈ 7.2e19 FLOPs → **~4–6h on 8×B200 / ~9–12h on 8×H100 ≈ $250–400**
(within the plan's $300–600 probe budget).

## 5. Go / no-go readout (gates the full ~25B run)

1. **Tagalog: garbled → fluent trajectory.** Held-out tl ppl drops steeply and monotonically;
   greedy gen battery (the June bake-off probes) produces fluent, coherent Tagalog by end of probe.
2. **Cebuano forming.** ceb ppl clearly declining; short generations coherent (full fluency not
   expected at 0.7B tokens — the *slope* is the signal).
3. **English retained.** en held-out ppl regression ≤ ~15% vs base (anchor ratio doing its job).
4. **Ship path re-proven on the artifact**: probe checkpoint → convert on llama.cpp ≥ b10152 →
   Q4_K_M loads + generates (Mac ok; Redmi spot-check optional here, mandatory for full run).
5. No stack pathologies (kernel fallbacks, loss spikes that don't recover, throughput collapse).

**No-go** → diagnose data mix (most likely) before touching the schedule; the §6 lesson is that
re-runs are the cost driver — probe again cheap rather than full-run on hope.

## 6. Open items folded in from the audit

- KD teacher needs **bf16 Qwen3.5-9B** (the deploy/models Q4 GGUF is data-gen only) — download at
  smoke-test time, SFT later per plan §3.
- LoRA→GGUF is broken upstream for Qwen3.5 (#21125): the CPT line ships **merged weights**;
  language-serving architecture (single bilingual model) to be written into the plan.
- RunPod GraphQL API retires early 2027 — migrate the fire-and-poll launcher to REST v2 before
  the full-run tooling ossifies.
