# CPT Flagship Plan — make the on-device ~2B the *true* flagship

**Status:** PLANNED → **PREP WEEK (reviewed 2026-06-29; funding still pending — $0 prep only, GPU spend holds for the trigger).** **Trigger:** Tether funding confirmation.
**Predecessor / why this exists:** [`finetuning/distill/ceb-heal/PRUNE-HEAL-RETROSPECTIVE.md`](finetuning/distill/ceb-heal/PRUNE-HEAL-RETROSPECTIVE.md) — the budget prune+heal+SFT attempt that proved capacity is fine but calibration can't be SFT'd in.
**Strategy lineage:** this is **Option C** of [`PARAMETRIC-VS-RAG.md`](PARAMETRIC-VS-RAG.md) (CPT a clean base → Filipino), made concrete.

### 2026-06-29 review — decisions + what changed since this was written

- **KD teacher swapped** (§3 note): cat-3B has a tokenizer mismatch with Qwen3.5 → token-level KD teacher is now a **tutor-SFT'd Qwen3.5-9B**; cat-3B demoted to data-gen teacher.
- **Fresh live evidence for the thesis (2026-06-26):** the shipped 1B, running on the real Redmi, answered a bare "Hello po" with a confabulated lecture ("the Philippine Eagle is a mammal", "you can see a platypus on Mount Apo") *with RAG grounding present* — §2's failure class and §11's missing-domain-gate, observed on-device. It is the standing A/B target for this model.
- **New tailwinds:** the RAG fact bank is now **49,556 verified/gap-filled trilingual facts** (better grounded-reader substrate for stage 4; 27,775 quiz-backing facts 3-layer-verified, 111 corrected); and a proven **Fireworks bulk pipeline** (`rag/pipeline/fw-*.py`, ~$29 for a 27k-quiz + 9k-fact run) can mass-generate the SFT/DPO/**out-of-scope abstention buckets** §11 requires, without Claude-cap exposure.
- **Pre-GPU checklist added:** ① **write the probe CPT config down** (LR/WSD schedule, seq len, mix weights, held-out tl/ceb perplexity eval — source: the Sailor2 paper recipe); ② **1-GPU stack smoke test** — full-param training of the *hybrid SSM+attention* Qwen3.5 arch needs recent `transformers` + mamba/causal-conv1d kernels + FSDP, and our existing pipelines are unsloth/TRL LoRA-centric (a few hundred steps on one rented GPU validates this before an 8×H100 commit); ③ the Redmi speed gate (§5b-A) — run in progress 2026-06-29.
- **Prep-week plan ($0-ish, pre-funding):** full corpus pull (FineWeb-2 `fil_Latn`/`ceb_Latn` core + MADLAD-400 + CulturaX) → SailCraft at scale (the §5a Day-1 recipe, validated on samples) → tokenize a ~5–10B probe mix → stack smoke test. Then the **probe CPT (§6) is the first GPU spend** when the trigger lands.

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

> **Qwen3.5-2B (text-only) → Sailor2-recipe Filipino+Cebuano CPT → tutor SFT → token-level KD from a Qwen3.5-9B tutor-SFT teacher → grounded-reader training → DPO calibration.**

Each layer targets a specific lesson: CPT fixes the *foundation* (real, diverse, non-synthetic Tagalog+Cebuano); KD transfers the teacher's *uncertainty* (the calibration SFT can't); grounded-reader makes "retrieve-or-abstain" *architectural* (confabulation has no surface to appear on); DPO finishes residual *abstain ≫ confabulate* calibration.

### Stage map

| Stage | What | Why it's here |
|------|------|------|
| 0. Data | Source tl+ceb+anchor (MADLAD-400, CulturaX, FineWeb-2 `fil_Latn`/`ceb_Latn`, OPUS, BloomLibrary, filtered web) → clean with **SailCraft** (open: `sail-sg/sailcraft`) | Real diverse corpus, not synthetic-science (the prune+heal brittleness) |
| 1. CPT | Continued-pretrain Qwen3.5-2B on **~25B tokens** (the realistic ceiling — §5b-C; *not* the 50–100B first penciled), Tagalog-heavy + Cebuano (upsampled) + English/Chinese anchor | Fix the linguistic foundation; Qwen3.5's Tagalog is garbled out-of-box, Cebuano ~zero |
| 2. SFT | Tutor instruction-tune (reuse/expand the kitten/cat datasets, both languages) | Behavior + persona; now on a *chat-capable, calibrated* base |
| 3. KD | Token-level distillation from a **Qwen3.5-9B tutor-SFT teacher** (decided 2026-06-29 — see note below) | Transfer the teacher's **uncertainty distribution** — the calibration lever |
| 4. Grounded-reader | Train strict retrieve-or-abstain over the RAG bank | Remove the confabulation surface for facts the bank doesn't cover |
| 5. DPO | Preference pairs (honest abstain ≫ confident-wrong on unverifiable superlatives/specifics) | Finish residual calibration; viable on a capable 2B (1B collapsed — capacity-bound) |
| 6. Ship | GGUF + QVAC integration + Redmi speed validation + capability/gate/role-play QA | The on-device reality checks |

> **KD-teacher decision (2026-06-29): the cat-3B CANNOT be the token-level KD teacher.** Sailor2-3B uses the Qwen2 tokenizer (~151k vocab); Qwen3.5-2B's vocab is 248,320 — token-level logit distillation requires a **shared tokenizer**, and cross-tokenizer KD (ULD-style) is research-grade risk on the exact step the calibration story depends on. **Resolution: SFT a Qwen3.5-9B on the tutor data as the KD teacher** (same tokenizer → clean token-level KD; the 9B Q4 GGUF is already in `deploy/models/`). The cat-3B is demoted to a *data-generation* teacher (responses, preference pairs) where tokenizers don't need to match.

## 4. Base-model decision

**Qwen3.5-2B (text-only weights), Apache-2.0.** Confirmed real (the Qwen3.5 small series is 0.8B / 2B / 4B / 9B — the 2B is *new* in 3.5; Qwen3 had no 2B). Rationale over pruning Sailor2-3B again: purpose-built at the device size, no prune scars, newest arch + best-in-class-under-10B reasoning, clean license.

**Known handling required:**
- **Garbled Tagalog out-of-box, ~zero Cebuano** (our bake-off) → this is the *premise* of the CPT, not a blocker.
- **Strip the native vision tower** — we use retrieval-images, not a VLM; the encoder is dead weight in the on-device GGUF.
- **Hybrid-thinking by default** — must run/train in non-thinking mode or it leaks `<think>` to kids (the 1B already had a `<think>`-leak problem).
- ~~Verify the exact text-only 2B repo + license on the official Qwen HF org before committing.~~ ✅ **Done (§5b-A):** `Qwen/Qwen3.5-2B-Base`, apache-2.0.

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
- ~~The one remaining gate: on-device Redmi TTFT/decode~~ ✅ **MEASURED (2026-06-29, llama-bench on the real Redmi, CPU, 4 threads, same-binary Sailor2-1B baseline reproduced the known 19.3/11.8):**
  - **Qwen3.5-2B Q4_K_M: prefill 10.94 t/s · decode 5.93 t/s** (vs 1B: 20.13 / 12.73 → **1.8× / 2.1× slower**, i.e. exactly the ~2B envelope the `hiraia-redmi-cpu-llama-bench` memory predicted; the Sailor 1.7B interpolation was 11.0/6.9, so the hybrid arch is **in line with a same-size transformer** at armv8.0).
  - **Read: the SSM prefill *bonus* did NOT materialize at pp512 — but neither did an SSM kernel *penalty*.** The kernels run correctly at armv8.0; the model costs what a 1.9B costs. VERDICT: **GO, with UX mitigation required** — naïve in-app TTFT would roughly double vs the 1B's measured ~13–24s, so the static-system-prompt KV cache (already shipped), lean grounding turns, and a Q4_0-with-runtime-repack quant test are required levers for stage 6, and §9-crit-5 stays a hard ship gate.
  - *(Adreno-610 load blocker RESOLVED 2026-06-26 — the kitten Vulkan-free + armv8.0-forced build runs the 1B on-device: TTFT ~24s / 4.4 tok/s in-app. The in-app tax vs bench is ~2-3×; apply the same haircut when projecting the 2B.)*

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
4. Full CPT (**~25B, §5b mix**) on 8×H100 → ablate data mix (1–2 re-runs).
5. Tutor SFT (both languages) on the CPT'd base.
6. SFT the **Qwen3.5-9B KD teacher** → token-level KD → grounded-reader rows → DPO calibration.
7. GGUF (text-only, non-thinking) → QVAC → Redmi speed check.
8. Capability + gate + role-play QA against §9. Ship or iterate.

## 11. Hallucination defense-in-depth (on-device)

The honest answer to "you can't stop a small model hallucinating" is: don't make the model perfect — **stack independent, cheap layers so any single fabrication is caught before a child sees it** (the failure rate compounds *down*). Deep-research (2023–2026, claims adversarially verified, 24/25 confirmed) on what is both *effective* and *cheap-phone-feasible*:

**Two kinds of hallucination need different defenses — the key distinction:**
- **Contextual stray** — the answer drifts from the retrieved facts. Catchable by *cheap* single-pass detectors.
- **Parametric confabulation** — the model invents a fact with no/weak grounding (our prune+heal failure: elections, "biggest star"). The cheap detectors do **not** catch this; it's defeated either *architecturally* (domain gate + strict retrieve-or-abstain → no ungrounded answer exists to fabricate) or by *expensive* sampling reserved for high-stakes.

**Tier 0 — FREE (training-time or single-pass; always on):**
- **Abstention tuning** (R-Tuning [arXiv:2311.09677]; GRAIT [2406.15927]): teach-to-abstain at training time, zero inference cost; R-Tuning reaches 93.23 AP on OpenLLaMA-**3B** (works at our scale). **⚠️ Verification KILLED the convenient assumption that learned refusal *generalizes* to untrained out-of-scope (refuted 0–3).** So abstention must be trained on explicit out-of-scope buckets, and a **bounded-domain gate must be its own layer** — the model will not "just know" what's off-curriculum. (This is exactly why the prune+heal model confabulated on elections/addresses.)
- **Bounded-curriculum domain gate**: a cheap OOD/scope classifier → refuse off-curriculum. **Highest leverage for us** — grade-5 science is finite.
- **TARG logit-margin gating** (training-free, single-pass, no second model): retrieve-or-abstain from the logit margin.

**Tier 1 — CHEAP (one extra pass; on grounded answers):**
- **Lookback Lens** [2407.07071]: a single linear classifier over attention ratios — detects contextual stray with **no extra inference pass** (AUROC ~58–66; transfers across models). Caveat: needs FlashAttention **off** to expose attention maps.
- **OR a small encoder verifier** over (query, context, answer): **MiniCheck-FT5 770M** (GPT-4-level faithfulness, ~400× cheaper [2404.10774]) / **Luna 440M** (beats GPT-3.5 [2406.00975]) → now **LettuceDetect** [2511.09803]. One forward pass of a <1B encoder — plausibly cheap on CPU, but **unmeasured on our hardware**.

**Tier 2 — EXPENSIVE (multi-sample; ONLY on flagged high-stakes: numbers, safety, medical):**
- **Semantic entropy** (Farquhar/Kuhn, Nature 2024 [s41586-024-07421-0]): sample K≈5–10, cluster by meaning, measure entropy — the one method shown to catch *parametric* confabulation. ~5–10× inference → never always-on. Cheaper variants: **Semantic Entropy Probes** (single forward pass) and a **Bayesian estimator validated on Llama-3.2-3B** (sub-3B!) at ~half the samples — the one uncertainty method with sub-3B evidence.

**Honest caveats (carry these to skeptics — they strengthen the case):**
- **No technique here has published 1–3B-CPU wall-clock numbers.** The decoding-time methods are mostly 7B+ GPU-validated, and one (END) was *negative* on Qwen-2-7B. We'd be early adopters → **measure each layer on the Redmi before trusting it.**
- The cheap detectors catch *contextual* stray only; *parametric* confabulation is defeated by the Tier-0 architecture (domain gate + retrieve-or-abstain) — which is why those layers matter most, and why "we have RAG" alone is insufficient without strict abstention.

**Folds into the build:** Tier-0 abstention + domain-gate data joins SFT/DPO (§3.5) and the scope gate is a product layer; Tier-1 runs as a post-generation check; Tier-2 fires only on the high-stakes flag. The **`abstain-correct` benchmark tier (§9) is the measurement** — every layer is validated against it on-device. **Compounding argument for skeptics:** independent layers multiply — if scope-gating catches 80%, retrieve-or-abstain 80% of the rest, a verifier 70%, calibration 50%, the fabrication-reaching-a-child rate is a fraction of a percent *even with a model that hallucinates freely in isolation*.

Refs: semantic entropy (Nature s41586-024-07421-0), Lookback Lens (2407.07071), R-Tuning (2311.09677), GRAIT (2406.15927), MiniCheck (2404.10774 / github.com/Liyan06/MiniCheck), Luna (2406.00975), LettuceDetect (2511.09803), CoVe (2309.11495), SelfCheckGPT (2303.08896); Semantic Entropy Probes + Bayesian estimator on Llama-3.2-3B (training-time-calibration sources in the deep-research run). Full verified claim set + the 1 killed claim: deep-research run `wdhb4g90h`.

## References

- Retrospective (what we tried + why it failed): `finetuning/distill/ceb-heal/PRUNE-HEAL-RETROSPECTIVE.md`
- Strategy lineage: `PARAMETRIC-VS-RAG.md` (Option C)
- Eval instruments: `finetuning/eval/capability/` (scored A/B) + `finetuning/eval/harness/` (green/red gate); shipped 1B baseline `finetuning/eval/capability/baselines/capability-baseline.2026-06-11-shipping.json` (3.24)
- Open external: `github.com/sail-sg/sailcraft`, Sailor2 paper (arXiv 2502.12982), `huggingface.co/sailor2`, Qwen HF org
- Filipino data assets (§5a): `github.com/stopwords-iso/stopwords-tl` (MIT), `github.com/jromest/filipino-badwords-list` (MIT), `huggingface.co/datasets/uonlp/CulturaX` (tl+ceb), `huggingface.co/edugp/kenlm` (KenLM format ref; no Filipino), `github.com/facebookresearch/cc_net` (LM-training recipe); fastText `lid.176` (supports ceb+tl)
- Device limits: memory `hiraia-redmi-cpu-llama-bench`; GGUF gotcha: `hiraia-gguf-convert-tokenizer-gotcha`
