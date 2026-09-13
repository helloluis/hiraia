# Bisaya / heal-corpus collection spec — prune-3B→2B kitten

**Status: SCOPED (2026-06-21).** Architecture + pipeline settled; source list + token budget
**filled from the Cebuano scoping** (`wf_2305426b-9b0`) in §3. **Verdict: CONDITIONAL GO** — clean
native Cebuano caps at ~0.35B tokens, so the `ceb` heal slice is **majority-synthetic by necessity**;
run the cheap pilot prune as the GO/NO-GO gate with a **pre-committed 1B revert** (§4).

## 0. Why this corpus exists

Building the **KD-heal corpus** for the planned structured prune **Sailor2-3B → ~2.4B** (the budget
"kitten" tier upgrade). Decision trail that got us here (see `memory/hiraia-kitten-2b-decision.md`):

- The 1B kitten's failures (safety-negation reflex, myth-affirmation, confabulation) are
  **capacity-bound** — proven: data+decoding can't fix them, quant can't (Q4→Q8 was +0.00), but
  **3B + our SFT scores 4.09/5 vs the 1B's 2.47** on the failure tiers (+1.62, decisive).
- Raw base-3B with no SFT scores **1.97** — so the win is **capacity + our SFT together**; a pruned
  2B must be **re-SFT'd, never shipped raw**.
- The only credible build path is **prune-3B→2.4B + heal** (Sailor2's own method made their 3B by
  pruning 8B). **Cebuano-preservation is the kill-switch** — structured pruning destroys the long
  tail first, and Cebuano is a tiny minority of capacity, so the heal must **upsample Cebuano
  heavily**. The realistic clean-`ceb` budget decides whether the prune is even viable.

**Corpus = the heal mix:** Cebuano (upsampled — the risk), Tagalog, and an English/math **replay
anchor** (~20%, **no code** — per the Sailor2 recipe) to fight catastrophic forgetting.

## 1. Architecture — canonical object-storage + on-demand hydrate (DC-portable)

The load-bearing design choice (so GPU-DC availability never blocks the heal):

```
  collect+clean (CPU pod, any DC)
        │
        ▼
  CANONICAL cleaned corpus  ──►  object storage (private HF dataset repo, versioned)
   (single source of truth)         ▲ the ONE artifact we maintain
        │
        ▼  (hydrate at pod start, minutes)
  GPU heal pod in WHATEVER DC has H100/A100 capacity
   → attach a right-sized network volume in THAT DC
   → pull canonical corpus  → prune + KD-heal → checkpoints
```

- **Canonical corpus lives in object storage** — a **private Hugging Face dataset repo** (preferred:
  versioned, deduped-by-Xet, trivial cost, `huggingface_hub` pull) or S3/R2. This is the single
  source of truth. **DC-agnostic.**
- **RunPod network volumes are region-locked** — you can resize (grow-only) but **cannot move or
  natively mirror** one across DCs. So we do NOT fight a volume's DC pinning for the corpus; the
  volume just holds the **cached venv + active checkpoints** for a given run, and we hydrate the
  corpus from object storage into whatever DC we land in.
- **Existing volume:** `5uwc7qp731` "**hiraia-ks**", **150 GB, US-KS-2** (the deploy scripts' cached
  venv volume; US-KS-2 is GPU-supply-constrained — exactly why we don't pin the corpus to it).
  Resize when the full-heal corpus size is known (⏳ from scoping).
- **Optional:** keep one **warm volume mirror** in a backup high-availability DC (populated by
  re-running the deterministic collection job, *not* a cross-DC copy) for instant starts. Cheap, but
  the object-storage hydrate already gives full portability, so this is a nicety, not a requirement.
- **Net:** launch the heal wherever capacity is, hydrate, train. DC pinning is no longer a blocker.

## 2. Pipeline stages (collection job)

Runs on a **CPU pod** (no GPU burn for the harvest); reuses SailCraft (`sail-sg/sailcraft`) where it fits.

1. **Acquire** — download per-language shards (`ceb`, `tl`, `en`/math anchor) to `/workspace/raw/`
   per the ⏳ source list. Per-language pulls only (don't fetch whole multilingual dumps).
2. **Language-ID filter** — **GlotLID / fastText `lid218e`** to keep genuine `ceb` (drop tl/en
   mis-ID, drop **Lsjbot machine-generated Cebuano Wikipedia stubs** — the big quality trap).
3. **Quality filter** — KenLM 5-gram perplexity (trained on a clean `ceb` seed, e.g. Bible +
   genuine-Wikipedia + our SFT) to drop boilerplate/noise.
4. **Dedup** — MinHash-LSH document-level + URL dedup (`text-dedup`/`datasketch`) to collapse the
   heavy CommonCrawl cross-source overlap (CulturaX/MADLAD/OSCAR/CC100 all derive from CC).
5. **PII / safety scrub.**
6. **Mix assembly** — RegMix-style: `ceb` upsampled to the target %, `tl`, `en`/math anchor (~20%,
   no code). Emit the heal mix + a per-language token manifest.
7. **Synthetic top-up — MANDATORY** (native `ceb` ~0.35B can't fill even the *pilot* `ceb` slice; the
   slice is majority-synthetic by necessity). Priority order:
   - **(a) Generate `ceb` with Sailor2-20B-Chat (the biggest = best `ceb` writer; teacher, not shipped)** —
     the backbone (91.2% retention precedent, arXiv 2410.09982). **EXPAND, don't translate:** the fact
     bank is already trilingual (`fact.{tl,en,bis}`, **40,534 verified `bis` facts**, grade/topic/term
     tagged) — so prompt the 20B to expand each **verified `bis` fact** into rich grade-school Cebuano
     (explanation / analogy / Q&A / story / misconception-fix), **grounded in the verified fact** so
     accuracy is guaranteed (accuracy>fluency). Diverse formats + temperature to avoid mode collapse.
     ⚠️ **TIME-ORDERED: generate BEFORE pruning** (scarce asset); store in the canonical corpus. Hard
     caveat: even the 20B's `ceb` is a ceiling (~0.30B training) → keep the native anchor + spot-check.
     **Run 8× single-80GB-GPU vLLM replicas (data-parallel) on RunPod A100-80GB ($1.19/hr); ≤$160 cap,
     auto-teardown, all `ceb` output stays on-pod/object-storage (AUP — never into Claude context).**
   - **(b) NLLB-200-3.3B EN/TL→`ceb` MT** (NOT Google — `ceb` fails 80%+) — volume filler; FLORES
     chrF++ ~52–57, verified usable 2/3. **Guardrails: filter every output through Sailor2-3B
     perplexity + LID + code-switch detection; cap MT share; ALWAYS co-mix the native core.**
   - **(c) In-repo SFT + RAG `ceb` (~4M)** — quality/register anchor; **upsample ≤3–5×** (overfitting
     ceiling). Accumulate-not-replace (avoids model collapse); keep a ≥10–20% native anchor + a
     **native-only cooldown pass**.
8. **Publish canonical** → push cleaned corpus + manifest to the **private HF dataset repo** (versioned
   tag). This is the artifact every heal run pulls.
9. **Hydrate script** — `hydrate-corpus.sh <dataset-repo> <tag> /workspace/heal-corpus` for pod start
   in any DC.

## 3. Source list + token budget — FILLED from scoping `wf_2305426b-9b0` (2026-06-21)

**Realistic total clean, unique, human-written Cebuano ≈ 0.3–0.5B tokens (point ~0.35B, HIGH).**
The deduped *union* of all open sources — NOT a naive sum (every web source shares one CommonCrawl
lineage → not additive). Corroborated 3 ways: Sailor2's own maximal-effort ceiling (**0.30B HQ
`ceb`**), FineWeb-2 (~170–210M) + MADLAD-clean (58.2M) convergence, and the "≥2B clean `ceb`" hope
**falsified 0/3**. This is **~½ of CulturaX-Tagalog (242M)** and **~13× smaller than MADLAD-Tagalog
(742M)** — Cebuano is genuinely data-starved.

### Native `ceb` budget (dedup-adjusted)
| Source | Clean `ceb` (BPE) | License | Note |
|---|---|---|---|
| **FineWeb-2** `ceb_Latn` | **~170–210M** (HIGH) | ODC-BY | **SPINE.** Wikipedia excluded → dodges Lsjbot |
| HPLT v3 `ceb_Latn` (top bins) | +~50–150M net-new | CC0 | union+dedup w/ FineWeb-2 |
| MADLAD-400 clean `ceb` | 58.2M (HIGH) | CC-BY-4.0 | ~0 net-new (subset); strip wiki domains |
| CulturaX `ceb` | ~180–230M (LOW, withheld) | ODC-BY, gated | ~0 net-new; **measure locally** |
| OSCAR-2301 / CC100 | ~8M / ~0 | CC ToU | subsumed; CC100-`ceb` may not exist |
| Genuine Wikipedia (non-Lsjbot) | +5–15M (HIGH) | CC-BY-SA | **drop 99.12% Lsjbot bot-stubs** |
| Curated (Leipzig\*/PALITO/CebuaNER/Bible) | +10–20M | mixed (\*Leipzig **NC**) | print register; Bible archaic → cap |
| Our in-repo (SFT+RAG-`ceb`+Bloom) | +~4M (MEDIUM) | ours/CC | cleanest, on-domain → upsample seed |
| **TOTAL UNIQUE CLEAN CEB** | **~0.3–0.5B (~0.35B)** | | **HIGH** |

Tagalog + English anchor are abundant (tl ~242M CulturaX + ~110M OSCAR; en effectively unlimited) —
**not** the constraint.

### Heal-tier feasibility (`ceb` slice ≈ 8–15% of total heal)
| Tier | Total heal | `ceb` slice | Composition | Bisaya-safe? |
|---|---|---|---|---|
| **Pilot** | ~3–5B | ~0.3–0.6B | native ×1–2 + self-distill + light MT | **YES marginally — run first** |
| Cheapest-viable ship | ~20–30B | ~1.6–4.5B | upsampled native (≤5×) + self-distill + filtered MT | YES *if* synthesis quality holds (majority-synthetic) |
| Stretch | ~50–80B | ~4–12B | ~80%+ synthetic | **RISKY — not recommended** |

**Recommended `ceb` mix ≈ 10% of heal**, composed **~25–35% native (upsample ≤5×) / ~40–50% Sailor2
self-distill / ~20–30% filtered NLLB MT** + native-only cooldown; the other ~90% = TL+EN (lean on
cross-lingual transfer, as Sailor2 did).

### GO / NO-GO: **CONDITIONAL GO — via synthesis, with a pre-committed 1B revert**
Native `ceb` (~0.35B) **cannot fill even the pilot `ceb` slice alone** → the slice is **majority-
synthetic by necessity**. That's a proven recipe (Sailor2 did exactly this), so the kill-switch does
**not** auto-fire — but this is a GO on the *engineering plan*, not a guarantee. Honest risk:
synthetic-`ceb` fluency is **capped by the thin teacher** (self-distill can't exceed Sailor2's own
`ceb`) and **risks translationese** (MT) — exactly the data-bound risk `PARAMETRIC-VS-RAG.md` flagged.
The pilot prune is the cheap instrument that converts this into a measured GO/NO-GO (§4).

## 4. Cebuano kill-switch (preservation gate) + pre-committed revert

Run AFTER heal + re-SFT, BEFORE any APK build (green-gate-first hard rule). **Eval ALL languages,
not just Cebuano** — the kitten is primarily a TAGALOG tutor (default lang), so Tagalog regression is
as disqualifying as Cebuano:
- **Tagalog (primary language):** regression gate (`run-harness.sh`) stays **green**, AND the
  capability-benchmark **Tagalog pass** (`run-capability.sh`) must **not regress vs the shipped 1B
  kitten** — and SHOULD **improve** on the safety-myth/abstain-correct tiers (the whole reason for the
  2B; the 3B+SFT scored 4.09 vs the 1B's 2.47, the 2B should land meaningfully above 2.47).
- **Cebuano (kill-switch):** capability-benchmark **Bisaya pass** regresses **≤0.3** (0–5) vs the 1B
  kitten + a **native-speaker spot-check** + FLORES `ceb` chrF (FLORES over-reports for low-resource
  langs — don't trust it alone).
- **English:** hold (must not collapse).
- **Per-language perplexity** is the cheap in-loop signal during the heal (`eval-holdout.jsonl`:
  ceb/tl/en) — recovery toward the pre-prune ppl (~10) on ALL three, not just `ceb`.
- **Plus** role-play QA (temp 0.5) + the on-device Redmi latency check.

**PRE-COMMITTED REVERT:** if the pilot fails the Bisaya kill-switch (gate red / capability-bis past the
delta / native-speaker flags systematic disfluency), **revert to keeping the 1B kitten** — do not ship
a degraded Bisaya tutor. Defensible on **accuracy > fluency** (stub-like `ceb` violates the top
priority) and **not-for-profit budget** (the pilot is the cheap GO/NO-GO gate before ship-tier spend).

## 5. Tooling & cost

- **Reuse:** SailCraft (clean), RegMix (mixture), our RunPod deploy pattern, our SFT/distill pipeline
  (for the post-heal kitten adapter re-train).
- **Greenfield:** the structured prune (NVIDIA Minitron / LLM-Shearing), the CLM heal/KD loop, and
  this collection orchestration.
- **Storage:** trivial (corpus in object storage + per-run volume). **Compute:** pilot **~$75–150**,
  cheapest-viable ship **~$350–700**, stretch **~$1.5–2.5k** (see `hiraia-kitten-2b-decision`).

## 6. First moves (scoping landed 2026-06-21)

1. ✅ **DONE (2026-06-21): generate `ceb` core from Sailor2-20B-Chat** (§2.7a) — **152M clean `ceb`
   tokens** (485,547 gens, **99.8% GlotLID yield**, drift ~0.2%) expanding the 40,534 verified `bis`
   facts, grounded → accurate, full curriculum spread; `finetuning/distill/ceb-heal/out/ceb-pilot-core.jsonl`,
   ~$42 on 8× A100-80GB. Pipeline in `finetuning/distill/ceb-heal/`.
2. Pull the native spine: **FineWeb-2 `ceb_Latn`** → MADLAD-clean → HPLT-v3 top bins → in-repo
   (upsample) → curated. **Measure exact `ceb` counts with Sailor2's tokenizer** (replace the CulturaX
   estimate); **do NOT bulk-train raw `ceb` Wikipedia** (99.12% Lsjbot; the downstream gain comes from
   *deleting* it).
3. Generate filtered **NLLB-200-3.3B MT** of our EN/TL science curriculum → `ceb` (§2.7b).
4. Assemble the ~10% `ceb` heal mix (§3) + publish the canonical corpus (§1); size/confirm the volume.
5. Run the **pilot prune** (~$75–150, ~3–5B heal) — the cheap GO/NO-GO gate — with the Bisaya
   kill-switch (§4) and the **1B revert pre-authorized**.
