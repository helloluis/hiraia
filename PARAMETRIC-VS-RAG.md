# Knowledge & language architecture: RAG vs. parametric (and the hybrid)

**Status: RAG + skill-distillation remains our shipping path — but this is a *budget-premised*
decision, not a verdict that parametric loses on the merits.** This document exists so we can
relitigate deliberately, not from memory. Last substantive review: **2026-06-14**.

> **One-line decision (for now):** keep facts in a retrieval bank (RAG) and distill only the
> *tutoring skill* into a LoRA on Sailor2-3B. We are **not** leaving this path before the
> **DoraHacks hackathon (2026-06-20)** — too close to ship. **But the original call assumed a
> <$1k / 3-week budget**, and that premise is load-bearing. If external funding lands (see
> [Tether Foundation trigger](#when-to-relitigate)), the live contenders become **Option C**
> (own-CPT a stronger base) and **Option D** (hybrid) — not the status quo by default.

---

## The four approaches

**A. RAG + skill-distillation — *what we ship today*.** Sailor2-3B + a LoRA that learns *behavior* —
intent extraction (`<think>`), grounding-faithfulness, distractor-robustness, Socratic tone — while
the *facts* come from a retrieval bank (~35k verified facts + LaBSE embedder) injected at runtime.
We **measured** that the LoRA learns the skill but **not** the facts (v1: grounding was identical on
trained vs. unseen facts). Cheap, low-risk, OTA-updatable.

**B. Parametric facts-into-Sailor2 (MedPsy-style).** Bake the *facts* into the existing base's
weights — no RAG bank. MedPsy (huggingface.co/blog/qvac/medpsy) shipped medical knowledge in a
**1.7B / 4B** model via a **235B teacher (Baichuan-M3)** generating fresh `<think>` CoT,
**curriculum learning**, then **DAPO RL**.

**C. Own-CPT a stronger *base* (Qwen3.5 → Filipino) — RAG stays.** Don't bake facts; build a *better
base model* ourselves by continual-pretraining a generational base (Qwen3.5) on Tagalog+Bisaya,
following the **public Sailor2 recipe**, then keep RAG for the facts. This is **not the
parametric-vs-RAG debate** — it's the **base-model bake-off reopened**. None of the
knowledge-injection arguments below apply, because facts still live in the bank. The reward is on a
different axis: a stronger base lifts reasoning, instruction-following, multi-turn coherence, and
directly attacks the small-model failure modes we currently patch by hand (over-abstention,
distractor sensitivity, garbled extensions).

**D. Hybrid — *probably the real frontier with funding*.** CPT a strong Filipino base (C) **+** bake
only the **settled curriculum core** into weights (the facts that never change — water is H₂O, Earth
orbits the Sun) **+** RAG the **long tail** and anything still being QA'd or updated over the air.
Captures most of the parametric upside while keeping the auditable/updatable safety net where it
matters.

---

## The correction that reframes everything: **augmented vs. naive, not SFT vs. CPT**

An earlier draft of this doc leaned on "the research discourages fine-tuning for facts." That
conflated two different regimes. Reading the literature carefully, the real dividing line is
**whether the knowledge was augmented**, not whether it was injected via SFT or CPT:

- **Gekhman et al.** (FT → hallucination) tested **small-scale SFT on a handful of *new* facts late
  in training** — the failure mode is the model learning to *guess in a confident style*. Real, but
  narrow.
- **Ovadia et al.** (RAG beat FT) used **naive** next-token exposure to documents — **no
  augmentation**. RAG won *that* matchup.
- **Allen-Zhu** (Physics of LMs) is actually a **recipe *for* parametric**, not against it:
  knowledge becomes *extractable* from weights when each fact is seen in **~20–50 diverse
  rephrasings**, ideally at pretraining/CPT scale (~2 bits/param of capacity). We previously cited
  this as anti-parametric — that was a misread.

So: **naive exposure fails; massive rephrasing succeeds.** That is *exactly* why **MedPsy worked** —
their 235B teacher generating fresh CoT *was* the augmentation engine, and it was **~97% of their
~8,250 H100-hr cost**. They didn't find a shortcut; they paid the Allen-Zhu augmentation tax in
full. **With CPT + augmentation + budget, baking the science bank into weights is feasible.** The
honest blocker is cost and the risks below — *not* "it doesn't work."

---

## Why we still ship RAG (the honest reasons, post-correction)

Once feasibility is granted, "RAG because parametric doesn't work" collapses. What remains:

1. **It was the <$1k / 3-week path; the budget premise was load-bearing.** We chose RAG under a hard
   cost constraint, not because it dominated on capability. Relaxing the budget legitimately
   reopens the decision — that is the whole point of this document.
2. **Augmentation cost is MedPsy-scale.** ~35k facts × ~30 rephrasings ≈ ~1M examples, done
   *bilingually*. Doable with funding; ~free with RAG.
3. **Frozen + un-auditable.** Baked facts can't be OTA-corrected, and you verify them only
   *statistically* (probing/eval), never completely. We are **actively still fixing bank errors**
   (e.g. the solar-system mistakes in the v4 agenda). For an **accuracy-first child tutor**
   (accuracy ranks ABOVE fluency), an inspectable 35k-row fact store is a genuine safety property; a
   wrong baked fact is invisible until a kid hits it.
4. **The multilingual capacity tug-of-war — the risk specific to *us*.** Parametric facts-in-weights
   would ask a small model to *simultaneously* learn Filipino, absorb the science bank, **and** not
   forget its English reasoning — a three-way fight over limited capacity. **MedPsy was
   ~monolingual; they never fought this.** It is the part of our problem genuinely harder than
   theirs, and it inflates iteration count and risk.

### The distinction that actually resolves it
- **Language is a weights problem.** You cannot RAG your way to Tagalog/Bisaya fluency — that
  belongs in CPT. **Option C's case is strong and stands on its own**, independent of the facts
  debate.
- **Facts are where RAG's operational edge lives** — updatable, auditable, cheap.
- ⇒ The strongest architecture is likely **neither pure RAG nor pure parametric, but Option D**:
  CPT the language, bake the *settled core*, RAG the tail.

---

## Resource estimates

### A. RAG + skill-distillation — **what we're actually doing** (rough but real)
- **< $1,000** and **~3 weeks** of focused work — the present cycle.
- **GPU:** a single **A6000 48 GB** (or L40) — LoRA SFT only; a handful of ~1-3 hr runs.
- **Data:** reuse the 35k-fact bank + ~8–12k teacher-distilled *skill* rows. Mostly already built.
- **Risk:** **low.** Failure modes (retrieval miss, over-abstention) are *fixable* by editing the
  bank / retrieval, no retraining. Knowledge is **OTA-updatable**.

### B. Parametric facts-into-Sailor2 (MedPsy-style) — **estimate** (projections; not done)
| Item | Estimate | Notes |
|---|---|---|
| **Data generation (augmentation)** | ~**1M augmented rows**; **$0–500** | Allen-Zhu: ~35k facts × ~30 diverse rewrites ≈ ~1M. Cheap via Claude subscription vs MedPsy's metered 235B, but **agent-time-heavy (days–weeks)**; a local-35B teacher pass is ~$200–500 GPU. This is the active ingredient *and* the bulk of the work. |
| **Training: full-FT SFT** | ~**100–300 H100-hrs** | LoRA capacity is too low to inject knowledge (Biderman); full-FT of a 3B over ~1M rows × several epochs. |
| **Training: RL (DAPO)** | ~**100–200 H100-hrs** | The MedPsy accuracy step. Iteration-heavy — our GRPO round-2 already failed once. ~2–3 attempts realistic. |
| **GPU type** | **A100 / H100 80 GB** | Full-FT + RL rollouts need 80 GB. |
| **GPU total** | ~**300–700 H100-hrs** → ~**$2,000–5,000** | At ~$2.5/hr, plus RL iteration overhead. |
| **Wall-clock** | ~**2–4 months** | Pipeline + full-FT + RL tuning + **multilingual-regression validation** + iterations. |
| **MedPsy anchor** | ~**8,250 H100-hrs** (~$20–25k); ~97% data-gen | We'd be cheaper on data-gen (subscription) but carry the same training-risk profile **plus** the multilingual tug-of-war they didn't face. |

### C. Own-CPT a stronger base (Qwen3.5 → Filipino) — **estimate** (projections; not done)
- **The cost driver is *data*, not GPU, and not the number of languages.** "13 langs → 2, so ~6×
  cheaper" is mostly wrong: CPT token budget and **low-resource corpus sourcing** dominate. Cutting
  to TL+CEB also **removes the cross-lingual transfer Sailor2 relied on** to rescue data-starved
  languages (Cebuano high-quality text after dedup is plausibly **<1–2B tokens** — we may be
  *data-bound*).
- **Counterweight in our favor:** Qwen3.5 starts far better at Tagalog than Qwen2.5 did → the **gap
  to close is smaller** → fewer CPT tokens needed. This is the strongest argument for C.
- **Compute:** ~**250–1,250 H100-hr per CPT pass** (≈ 6·N_params·N_tokens; ~600 H100-hr / 50B tokens
  for a 3–4B) + anneal + SFT/DPO + 2–3 iterations. **All-in ≈ $3–10k + 2–4 months**, *dominated by
  data engineering (esp. Cebuano corpus building)* — a different muscle than we exercise now.
- **GPU type:** A100 / H100 80 GB.
- **Risk:** medium. Language CPT is well-trodden (Sailor2 recipe is public); the risk is **corpus
  availability for Cebuano** and **forgetting** of base reasoning/English.

### D. Hybrid (CPT base + bake settled core + RAG tail) — **estimate**
- ≈ **C + a *smaller* B**: the augmentation set shrinks to just the **settled curriculum core**
  (hundreds–low-thousands of facts, not 35k), so the parametric tax is a fraction of B. RAG carries
  the rest.
- **All-in ≈ C's cost + ~10–30%.** Best capability-per-dollar *if* we're already paying for C.

**Bottom line:** A is ~$1k/3wk/low-risk. B is ~$2–5k/2–4mo and fights a tug-of-war MedPsy never did.
C is ~$3–10k/2–4mo, data-bound, but buys a genuinely better base. D layers a cheap parametric core
on C. **None is infeasible — the question is whether funding unlocks C/D's capability upside.**

---

## Where parametric / own-CPT would genuinely win
- **A stronger base (C/D) attacks the failure modes we currently hand-patch** — over-abstention,
  distractor sensitivity, garbled extensions, weak multi-turn — at the root, instead of via
  data/retrieval band-aids.
- **Baking the settled core (B/D) eliminates that slice of retrieval failures** (word-association
  collisions like "solar system"→solar-panel, context pollution) for facts that never change.
- **Faster** — baked facts drop the ~6 s on-device brute-force vector search for that slice (helps
  TTFT).
- **Fluency** — only CPT can actually *raise Tagalog/Bisaya fluency*; RAG cannot.

**Caveat:** the cheaper, lower-risk way to capture the *retrieval-failure* win alone is a better
QVAC-compatible retriever — but the only upgrade path (XLM-R embedders) is blocked on QVAC (see
embedder note below). So today retrieval is improved via **bank/retrieval fixes** (context-gating,
term tuning), not a model swap.

---

## Hard external dependencies (true for B/C/D)
- **QVAC must add Qwen3 arch support** before *anything* Qwen3.5 (C/D) ships on-device — same
  external-dependency shape as the XLM-R embedder block. We don't control this timeline.
- **No "tiny embedder" escape on QVAC.** The ~383 MB LaBSE embedder dominates the RAG stack and
  can't be shrunk: QVAC's `GGMLBert` runtime only runs **BERT-native** embedders; the small/strong
  multilingual ones (e5-small ~80 MB, BGE-M3) are **XLM-RoBERTa → GGUF broken on QVAC** (benchmarked,
  `rag/embeddings-spike/`). So dropping RAG's ~0.57 GB requires dropping RAG entirely.
- **We have never measured *stock* Qwen3.5 on TL/CEB.** This is the cheap, decisive test gating C:
  if stock (or a community SEA finetune) already speaks good Tagalog/Cebuano, we may not need to CPT
  at all — just swap the base when QVAC supports it. We rejected **Qwen3-1.7B** in the bake-off for
  weak Tagalog; whether Qwen3.5 fixed that is empirical and ~free to check off-device.

---

## When to relitigate
Reopen this decision if **any** of these fire:

- **🎯 Tether Foundation grant (or comparable funding) lands** → **primary trigger.** Budget was the
  load-bearing premise for choosing A. With external funding, evaluate **C (own-CPT Qwen3.5 →
  Filipino)** and **D (hybrid)** head-on. First moves, in order: (1) benchmark *stock* Qwen3.5 on
  our TL/CEB capability set (cheap, off-device, do this *first*); (2) scope the Cebuano corpus
  (the real risk); (3) only then commit to CPT. **Do not leave the RAG path before the
  2026-06-20 hackathon regardless.**
- **QVAC adds Qwen3 / XLM-R support** → unblocks C/D on-device (Qwen3.5) and/or a stronger small
  embedder (e5/BGE) for RAG.
- **A capable ~1.7B with strong Tagalog/Bisaya appears** → makes MedPsy-style smallness achievable
  without sacrificing the language moat. (We may *manufacture* this trigger via C.)
- **Retrieval failures prove unfixable** by bank/retrieval tuning (they haven't so far).
- **Footprint becomes the #1 constraint** (hard <3.5 GB target) AND OTA databank updates become
  irrelevant → the ~0.57 GB RAG saving may matter.

> **Recommended first step whenever this reopens:** start with **D (hybrid)**, not full B. CPT the
> language (clear win), bake only the settled core (cheap, safe), keep RAG for the tail
> (auditable, updatable). It's the lowest-risk way to capture the parametric upside.

## References
- Ovadia et al., *Fine-Tuning or Retrieval?* (EMNLP 2024) — arxiv 2312.05934 — *RAG beat **naive**
  (un-augmented) FT.*
- Allen-Zhu & Li, *Physics of Language Models 3.1 / 3.3* (ICML 2024) — arxiv 2309.14316 — *knowledge
  IS storable in weights **with ~20–50× augmentation**; a recipe for parametric, not against it.*
- Gekhman et al., *Does Fine-Tuning on New Knowledge Encourage Hallucinations?* (EMNLP 2024) —
  arxiv 2405.05904 — *small-scale **SFT** on new facts; narrow regime.*
- Biderman et al., *LoRA Learns Less and Forgets Less* (TMLR 2024) — arxiv 2405.09673 — *LoRA can't
  inject knowledge → parametric needs full-FT.*
- Sailor2 — *Sailing in South-East Asia with Inclusive Multilingual LLM* (public CPT recipe;
  Qwen2.5 base, ~13 SEA langs, two-stage CPT + anneal).
- MedPsy — huggingface.co/blog/qvac/medpsy — *augmented CPT/curriculum + DAPO; ~97% of cost was
  data-gen; ~monolingual.*
- Internal: `rag/embeddings-spike/README.md` (embedder bake-off), the v1 distill eval (LoRA teaches
  behavior not facts), `hiraia-base-model-bakeoff` (why Sailor2-3B over Qwen3-1.7B).
