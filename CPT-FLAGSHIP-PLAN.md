# CPT Flagship Plan — make the on-device ~2B the *true* flagship

**Status:** PLANNED. **Trigger:** Tether funding confirmation.
**Predecessor / why this exists:** [`finetuning/distill/ceb-heal/PRUNE-HEAL-RETROSPECTIVE.md`](finetuning/distill/ceb-heal/PRUNE-HEAL-RETROSPECTIVE.md) — the budget prune+heal+SFT attempt that proved capacity is fine but calibration can't be SFT'd in.
**Strategy lineage:** this is **Option C** of [`PARAMETRIC-VS-RAG.md`](PARAMETRIC-VS-RAG.md) (CPT a clean base → Filipino), made concrete.

---

## 1. The goal (and why it's the flagship, not a side tier)

Make the **on-device ~2B model the flagship** — the one that sees the most usage. This is a social-responsibility decision, not a technical convenience: the children Hiraia exists for are on **budget, offline, CPU-only devices** (Redmi-class, ~2B ceiling). The model that reaches the most kids *is* the budget model. The 3B "cat" is a comfort tier for better hardware; the ~2B is where the mission lives. So it deserves flagship-grade investment.

**Success = a ~2B that beats the shipped 1B kitten's capability (3.24) decisively AND is well-calibrated** (does not regress the abstain-correct tier into confabulation — the exact failure that sank the prune+heal model), preserves Cebuano, and runs at acceptable TTFT on the Redmi.

## 2. Why CPT, not more SFT (the lesson we paid for)

The prune+heal retrospective is unambiguous: the 2.4B was **more capable** than the 1B on grounded science but scored **−1.18 lower** because it **confabulates** instead of abstaining. Three SFT iterations (conservative → heavy → targeted-data) could not fix it, because:

- **Calibration is not learnable by response-level SFT.** SFT teaches surface behavior; it does not teach the model *what it doesn't know*.
- The heal corpus was **synthetic and science-only**, giving an over-strong "always explain" prior that *regressed* abstention and chitchat.
- We pruned the **base** (not chat-tuned) → the English path was uninstructed garbage.

The principled fixes are different in kind from SFT — and that's this plan.

## 3. Approach (one line)

> **Qwen3.5-2B (text-only) → Sailor2-recipe Filipino+Cebuano CPT → tutor SFT → token-level KD from the cat-3B → grounded-reader training → DPO calibration.**

Each layer targets a specific lesson: CPT fixes the *foundation* (real, diverse, non-synthetic Tagalog+Cebuano); KD transfers the teacher's *uncertainty* (the calibration SFT can't); grounded-reader makes "retrieve-or-abstain" *architectural* (confabulation has no surface to appear on); DPO finishes residual *abstain ≫ confabulate* calibration.

### Stage map

| Stage | What | Why it's here |
|------|------|------|
| 0. Data | Source tl+ceb+anchor (MADLAD-400, CulturaX, FineWeb-2 `fil_Latn`/`ceb_Latn`, OPUS, BloomLibrary, filtered web) → clean with **SailCraft** (open: `sail-sg/sailcraft`) | Real diverse corpus, not synthetic-science (the prune+heal brittleness) |
| 1. CPT | Continued-pretrain Qwen3.5-2B on ~50–100B tokens, Tagalog-heavy + Cebuano (upsampled) + English/Chinese anchor | Fix the linguistic foundation; Qwen3.5's Tagalog is garbled out-of-box, Cebuano ~zero |
| 2. SFT | Tutor instruction-tune (reuse/expand the kitten/cat datasets, both languages) | Behavior + persona; now on a *chat-capable, calibrated* base |
| 3. KD | Token-level distillation from the cat-3B (or larger) | Transfer the teacher's **uncertainty distribution** — the calibration lever |
| 4. Grounded-reader | Train strict retrieve-or-abstain over the RAG bank | Remove the confabulation surface for facts the bank doesn't cover |
| 5. DPO | Preference pairs (honest abstain ≫ confident-wrong on unverifiable superlatives/specifics) | Finish residual calibration; viable on a capable 2B (1B collapsed — capacity-bound) |
| 6. Ship | GGUF + QVAC integration + Redmi speed validation + capability/gate/role-play QA | The on-device reality checks |

## 4. Base-model decision

**Qwen3.5-2B (text-only weights), Apache-2.0.** Confirmed real (the Qwen3.5 small series is 0.8B / 2B / 4B / 9B — the 2B is *new* in 3.5; Qwen3 had no 2B). Rationale over pruning Sailor2-3B again: purpose-built at the device size, no prune scars, newest arch + best-in-class-under-10B reasoning, clean license.

**Known handling required:**
- **Garbled Tagalog out-of-box, ~zero Cebuano** (our bake-off) → this is the *premise* of the CPT, not a blocker.
- **Strip the native vision tower** — we use retrieval-images, not a VLM; the encoder is dead weight in the on-device GGUF.
- **Hybrid-thinking by default** — must run/train in non-thinking mode or it leaks `<think>` to kids (the 1B already had a `<think>`-leak problem).
- Verify the exact text-only 2B repo + license on the official Qwen HF org before committing.

## 5. Data — the constraint that *isn't*

Sailor2 demonstrably learned Cebuano from **public sources we have equal access to** — we were over-pessimistic earlier (we'd only tapped FineWeb-2). Key points:
- **Cebuano is assemblable**: MADLAD-400, CulturaX, OPUS, filtered Wikipedia, BloomLibrary, web crawl. You don't need it to equal Tagalog's volume — Sailor2's method is a **multilingual mix + upsampling + cross-lingual transfer** (Tagalog↔Cebuano are closely related Austronesian, so Tagalog mass helps Cebuano).
- **SailCraft is open** (`github.com/sail-sg/sailcraft`): the exact 4-stage curation pipeline (clean → near-dedup → exact-dedup → re-clean; rule + model-based + URL-dedup + frequent-line removal). Confirm/extend Tagalog+Cebuano language configs.
- **Trap: Cebuano Wikipedia is ~99% bot-generated** (Lsjbot) — looks like a token goldmine, is templated noise. Downweight hard.
- The Sailor2 paper documents the full data mix + CPT recipe — this is a **reproduction**, not novel R&D.

## 5a. SailCraft readiness — dry-run + fork hunt (validated 2026-06-22)

We did a low-budget recon + minimal local run of SailCraft and a full sweep of its branches/forks/adjacent repos, specifically to head off Filipino gotchas. **Verdict: no architectural surprises; the Filipino config work is bounded and unblocked; the only genuinely effortful piece (a Cebuano/Tagalog perplexity LM) is optional for a first pass.**

- **Architecture is low-budget-friendly.** Single-machine, **CPU-first** (parallelism = HF `datasets.map` across cores), **no Spark/Slurm/Ray, no GPU**. Four stages: ① initial clean (config-driven, per-language) → ② near-dedup (MinHash) → ③ exact-dedup (Rust suffix-array — only stage needing a Rust toolchain) → ④ second clean. Input/output = JSONL with a `text` field; intermediates are HF Arrow; each stage emits a `_filter_cases.xlsx` reason log (built for threshold tuning).
- **Filipino is NOT shipped — and there is NO fork shortcut.** Verified: upstream has only `main`; all 11 forks are stale/identical (the one "ahead" adds an unrelated CI file); and no adjacent repo has it either — cc_net (Filipino LMs 403), `edugp/kenlm` (24 langs, no tl/ceb), SailCraft's own `sailcraft_lm_resource` (14 langs, no Filipino), SEA-LION (models only, no pipeline). **Do not chase forks.**
- **Setup gotcha #1 — use Python 3.10/3.11, NOT 3.14.** The 2022-era pins rot on modern Python (`kenlm` won't build — removed CPython internals; `pandas==1.5.2` no wheel; `text-dedup` 0.4.0→0.4.1 CLI change; `emoji` API change). On 3.11 (pyenv/conda) the pins install as authored — removes ~80% of the friction.
- **Setup gotcha #2 — a latent `NaN`-guard bug** bites exactly when you add a *partially*-resourced language (the Filipino case): an empty config cell becomes `NaN` → `KeyError: nan`. One-line `pd.notna(x) and x` fix in `filtering.py`.
- **The cheap pieces all exist as free MIT/CC assets:**
  - **Thresholds:** SailCraft ships a `default` `parameters_filtering` dict — copy → `parameters_filtering_{tl,ceb}` (this is precisely how `lo`/`ms`/`th` already run, with no native lists). Re-tune on real crawl.
  - **Tagalog stopwords:** `stopwords-iso/stopwords-tl` (146 words, MIT) — drop-in.
  - **Flagged/profanity:** `jromest/filipino-badwords-list` (~97, MIT; tl-centric + some ceb terms).
  - **Language ID:** fastText `lid.176` already emits `__label__ceb` + `__label__tl` — the LID step needs nothing.
  - **Corpus:** CulturaX has both `tl` and `ceb` folders (+ MADLAD-400/OSCAR).
  - **Model slot:** `download_sentencepiece_kenlm_models.py` is the drop-in for trained LMs (host alongside `sailcraft_lm_resource`).
- **The one hard gap — KenLM `.arpa.bin` + SentencePiece `.sp.model` for tl AND ceb** (the perplexity filter). Nobody published them. **It is OPTIONAL for a first pass** — set `cond_check_perplexity=False` and lean on LID + heuristics. When wanted (worth it to catch Cebuano-Wikipedia bot-noise), train on CulturaX (cc_net recipe: SentencePiece, then a 5-gram KenLM on SP-tokenized text), then **re-calibrate the perplexity thresholds to your own LM** (the shipped per-lang cutoffs were tuned to cc_net's LMs and won't transfer).
- **Small must-build list:** a **Cebuano stopword list** (none exists clean — build from ceb frequency/function words, cross-check against Tagalog), native Cebuano flagged-words, and empirical threshold tuning.
- **Dry-run proof:** with `ceb`+`tl` configs added, **stage 1 ran end-to-end** on a synthetic ceb/tl corpus (18→12 docs, sensible filter reasons). Stage 2 needs the `text-dedup` call updated to the 0.4.1 CLI; stage 3 needs Rust installed.

**Day-1 data recipe (when funded):** Python-3.11 venv → add `tl`/`ceb` `languages_id` rows + `default`-seeded threshold dicts + `stopwords-tl` + `filipino-badwords` → decide perplexity (skip first; train ceb/tl LMs later) → run all 4 stages on a CulturaX ceb+tl sample → tune cutoffs against the `_filter_cases.xlsx` logs. The config edits are trivial; the only real effort is the optional LM training + Cebuano stopword curation.

## 5b. Tier-1 prep — VALIDATED (2026-06-22, $0 local)

We ran the three highest-value de-risks before any funding. **All three favorable; only one empirical gate remains (on-device speed on the Redmi).**

**A — Base device path: GREEN.** Validated end-to-end on local tooling:
- Repo **`Qwen/Qwen3.5-2B-Base` (apache-2.0)**; vision auto-strips at convert (omit `--mmproj`; add `--no-mtp`); non-thinking via `enable_thinking=false` (Qwen3.5 dropped the soft `/no_think` switch).
- **GGUF converts natively** in the local llama.cpp (b9501 has a dedicated `QWEN35` arch) → Q4_K_M **1.2GB**, loads + serves on Mac (runtime kernels work, not just format).
- **QVAC supports it on the Redmi tier**: `@qvac/llm-llamacpp@0.24.0` ships compiled `llm_build_qwen35`/`qwen35moe` builders, a `qwen35` chat-format, and `libqvac-ggml-cpu-android_armv8.0_1.so` (the SD685 ISA). **No QVAC update needed.**
- **Architecture surprise — it's a hybrid SSM + attention model** (Mamba-style linear attention interleaved with full attention; 2048 hidden / 24 layers / vocab 248320). Implication: SSM is cheaper on prefill (the ARMv8.0 binding limit) → potentially *faster* than Sailor2-2.4B on-device — BUT the SSM/conv1d kernels at armv8.0 (no i8mm) are the specific empirical unknown.
- Probes confirm the premise: Tagalog garbled, Cebuano near-absent → ideal CPT starting condition.
- **The one remaining gate: on-device Redmi TTFT/decode** — GGUF preserved at `deploy/models/Qwen3.5-2B-Base.Q4_K_M.gguf`; `adb push` + force the CPU backend (separate from the known Adreno-610 Vulkan issue).

**B — Data pipeline: VALIDATED end-to-end on real Filipino.** All 4 SailCraft stages ran on MADLAD-400 tl+ceb (3k docs each) via `uv venv --python 3.11`. **Committable configs + `git apply`-verified patches at `finetuning/cpt/sailcraft-filipino/`** (one-command driver `run_filipino_pipeline.sh`). New operational gotchas captured there: needs **two venvs** (text-dedup vs cleaning deps conflict); **MADLAD-400 Tagalog is the `fil` folder, not `tl`**; on 3.11 stay on `text-dedup==0.4.0` (`--path json --data_files`, drop `--local`); stage 3 needs `rustup` (the upstream TF deps are vestigial); **the `ceb` LID gate (cutoff 0.70) already filters Cebuano noise** the missing perplexity LM would have caught. CulturaX content access now granted (terms accepted on the `Cryptopop` HF account; 302 ✓) — though FineWeb-2 (ungated) is the practical core.

**C — Corpus inventory: the token budget is smaller (and cheaper) than first penciled.** Measured the Qwen tokenizer at **~2.0 tokens/word** (dataset-card "token" counts are ~words → ~2× understated). Distinct clean: **Tagalog ~3.9B / Cebuano ~0.37B** Qwen-tokens (natural ratio ~10.6:1). **A Filipino-heavy CPT realistically caps at ~20–30B tokens** — forcing 50–100B would mean 63–82% English/Chinese, defeating the purpose. Recommended **~25B mix: ~63% tl (15.6B, ~4 epochs) / ~12% ceb upsampled (~2.9B, ~8 epochs) / ~25% en+zh anchor**; lean probe at ~5–8B first. **Cebuano-Wikipedia is 99.12% Lsjbot bot-stubs** — filter by `Lsjbot` creator metadata; do NOT count it raw (it teaches boilerplate). "Is there enough Cebuano?": not standalone (~0.37B is data-starved), but viable via upsampling + Tagalog cross-lingual transfer — exactly Sailor2's bet.

## 6. Budget

Compute is cheap at 2B; **the cost is iteration + human time**, not GPU-hours.

| Phase | Compute $ | Calendar |
|------|----------|---------|
| Data (SailCraft on CPU boxes; lean = lean on pre-cleaned sources) | $0.2–1k | 2–4 wks |
| CPT (**~25B tok realistic ceiling — see §5b**; ~$1k/run, ~30h on 8×H100) | ~$1–2k × runs | run ≈ 1–1.5 days; +ablations |
| SFT | $0.1–0.5k | 1–2 wks |
| KD + DPO | $0.5–1.5k | 2–3 wks |
| Ship (GGUF/QVAC/QA) | $0.2–0.5k | 2–4 wks |

- **Lean / MVP** (single ~15–20B CPT at the §5b mix, light calibration): **~$1.5–2.5k, ~6–8 weeks.**
- **Thorough** (~25B CPT + 2–3 ablation re-runs, full KD+DPO+grounded-reader, full QA): **~$4–8k, ~2.5–4 months.** (Lower than first penciled — the §5b inventory caps the CPT smaller/cheaper than 50–100B.)
- **The cost driver is the number of CPT re-runs** (you won't nail the data mix first try) — that's the $1.5k↔$5k swing.
- **Human/engineering time is the real expense** (the $ is compute only). In-house = ~a quarter of focused work; contracted ML eng ≈ $30–60k+ loaded (would dwarf compute).

### De-risk first — the probe gate

> **CPT probe: ~$300–600, ~1 week.** A small ~5–10B-token CPT on Qwen3.5-2B. Go/no-go on: (a) Tagalog garbled→fluent with our data, (b) Cebuano starts forming, (c) the GGUF→QVAC→Redmi path works. Commit the full run only if the trajectory is there.

## 7. Time & GPU scaling

- **CPT scales near-linearly** with GPUs (2B fits one GPU → pure data parallelism). 50B tokens: 8×H100 ≈ ~50h; 16× ≈ ~28h; 32× ≈ ~15h. Cost ~flat (FLOP-bound) + 10–30% multi-node efficiency tax. **Provision a full 8×H100 node minimum; go multi-node if available** (per the standing rapid-runs preference). Ceilings: global batch size (~dozens of GPUs before convergence-per-token degrades) and on-demand availability.
- **SFT/DPO do NOT scale** with more GPUs — too small (the dataset is swallowed in a few steps). Already minutes-to-an-hour; 1 node max.
- **GPUs compress each *run*, not the *project*** — total time is dominated by iteration + data + QA. Reduce *cycles* (probe-first, good ablations), not GPU count.

## 8. Infrastructure

- **Data / dedup (CPU + RAM heavy):** Vultr SG Memory-Optimized — **`voc-m-32c-256gb-1600s` (~$1.9/hr, hourly, spin down after)** for speed/headroom; `voc-m-16c-128gb-1600s` (~$1.17/hr) for the lean path. SG = in-region (PH latency/residency), near RunPod SG. RunPod also has CPU pods (no egress fee, colocated with the GPU node) — fine for the lean path; move to Vultr/Hetzner only if dedup needs more RAM than RunPod CPU pods offer.
- **CPT / KD (GPU):** RunPod 8×H100 node (NVLink). Reuse the fire-and-poll launcher + guard pattern from `finetuning/distill/ceb-heal/` (proven this arc).
- **Only the final tokenized corpus (tens of GB) moves to the GPU pod** — one-time, RunPod ingress is free.

## 9. Success / kill criteria (learned from prune+heal)

A candidate ships only if **all** hold (run after CPT → SFT → KD → DPO, before APK):
1. **Capability benchmark beats the 1B (3.24) decisively** — target ≥ 3.5, and **abstain-correct must NOT regress** below the 1B's ~4.6 (the prune+heal model's fatal flaw — confident-wrong on unanswerables). This is the headline calibration gate.
2. **Cebuano preserved** — bisaya tier within −0.3 of the 1B, native-speaker spot-check, no systematic disfluency.
3. **English path coherent** — must be chat-capable (don't repeat the bare-base mistake).
4. **Regression gate green** (`finetuning/eval/harness/run-harness.sh`, 39 assertions) + role-play QA (temp 0.5).
5. **On-device speed acceptable on the Redmi** — re-verify TTFT/decode (prefill is the binding limit on ARMv8.0; Qwen3.5-2B arch differs from Sailor2).

**Pre-committed:** if calibration (abstain-correct) regresses, do **not** ship — that was the whole lesson. A confident-but-wrong kids' tutor is worse than a stiff-but-honest one (accuracy > fluency, and honesty > both).

## 10. Milestones

1. Funding confirmed → stand up data infra (Vultr SG) + SailCraft.
2. Assemble + clean the tl+ceb+anchor corpus; QC the Cebuano slice (Wikipedia-bot filter).
3. **Probe CPT** (~$500, 1 wk) → go/no-go.
4. Full CPT (50–100B) on 8×H100 → ablate data mix (1–2 re-runs).
5. Tutor SFT (both languages) on the CPT'd base.
6. KD from cat-3B → grounded-reader rows → DPO calibration.
7. GGUF (text-only, non-thinking) → QVAC → Redmi speed check.
8. Capability + gate + role-play QA against §9. Ship or iterate.

## References

- Retrospective (what we tried + why it failed): `finetuning/distill/ceb-heal/PRUNE-HEAL-RETROSPECTIVE.md`
- Strategy lineage: `PARAMETRIC-VS-RAG.md` (Option C)
- Eval instruments: `finetuning/eval/capability/` (scored A/B) + `finetuning/eval/harness/` (green/red gate); shipped 1B baseline `finetuning/eval/capability/baselines/capability-baseline.2026-06-11-shipping.json` (3.24)
- Open external: `github.com/sail-sg/sailcraft`, Sailor2 paper (arXiv 2502.12982), `huggingface.co/sailor2`, Qwen HF org
- Filipino data assets (§5a): `github.com/stopwords-iso/stopwords-tl` (MIT), `github.com/jromest/filipino-badwords-list` (MIT), `huggingface.co/datasets/uonlp/CulturaX` (tl+ceb), `huggingface.co/edugp/kenlm` (KenLM format ref; no Filipino), `github.com/facebookresearch/cc_net` (LM-training recipe); fastText `lid.176` (supports ceb+tl)
- Device limits: memory `hiraia-redmi-cpu-llama-bench`; GGUF gotcha: `hiraia-gguf-convert-tokenizer-gotcha`
