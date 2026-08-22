# fact → illustration matcher QA

Human-visual QA of the `gen-image-map.mjs` fact→image matcher, scored against the live output
over the 49,556-fact bank (5,041 matches: 1,583 exact + 3,458 fuzzy).

- **Sample:** 146 rated rows → **144 unique (fact, slug) pairs** after removing 2 exact duplicate
  rows (`ph-indicator-litmus-g8`, `earth-four-main-layers-g8` were each rated twice, identically).
  All analysis below uses the 144 deduplicated pairs.
- **Rating scale:** `good` (illustrates the claim) · `acceptable` (on-topic, not misleading) ·
  `wrong` (unrelated/does not support the claim) · `harmful` (actively teaches a falsehood).
  **shippable = good + acceptable.**
- **Per-pair data:** `factimage-qa.csv` (stratum, id, slug, rating, reason).
- Two rated pairs (`rooster-cockfight-handler-scene-g4`, `tamaraw-dwarf-buffalo-g4`) are not in the
  current scored dump — they were exact matches in a slightly earlier asset snapshot. They are kept
  in the precision tables and excluded from population joins. Immaterial at this n.

## Stratum definitions (reverse-engineered and confirmed against `/tmp/factimage-scored.json`)

The QA's four strata map exactly onto a partition of the live population:

| stratum | rule | live N | % of matches |
|---|---|---:|---:|
| `exact` | tier = exact, slug **not** in the 12 most-reused slugs | 1,581 | 31.4% |
| `fuzzy-high` | tier = fuzzy, score ≥ 0.60, slug not in top-12 | 828 | 16.4% |
| `fuzzy-threshold` | tier = fuzzy, 0.50 ≤ score < 0.60, slug not in top-12 | 2,193 | 43.5% |
| `high-reuse` | slug is one of the 12 most-reused slugs (any tier) | 439 | 8.7% |
| | | **5,041** | 100% |

Verified: every rated `exact` pair is tier=exact and off the top-12; every `fuzzy-high` pair scores
in [0.60, 1.0]; every `fuzzy-threshold` pair scores in [0.50, 0.571]; all 48 `high-reuse` pairs sit
on a top-12 slug. The top-12 slugs are `kinetic-potential-energy` (75 uses),
`water-cycle-bag-window` (54), `energy-forms-icons` (50), `philippine-eagle-chick` (37),
`heat-conduction` (37), `states-of-matter-water-three` (34), `solar-system` (32),
`physical-vs-chemical-change-sort` (26), `four-s-dengue-prevention` (25),
`frying-egg-chemical-change` (24), `light-refraction` (23),
`complete-vs-incomplete-metamorphosis` (22).

---

## 1. Precision per stratum — MEASURED

| stratum | n | good | acceptable | wrong | harmful | **shippable** | 95% CI† | fail rate |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| exact | 24 | 19 | 4 | 0 | 1 | **95.8%** | [87.8%, 100%] | 4.2% |
| fuzzy-high | 24 | 18 | 5 | 0 | 1 | **95.8%** | [87.8%, 100%] | 4.2% |
| fuzzy-threshold | 48 | 32 | 12 | 3 | 1 | **91.7%** | [83.8%, 99.5%] | 8.3% |
| high-reuse | 48 | 15 | 22 | 8 | 3 | **77.1%** | [65.2%, 89.0%] | 22.9% |
| *sample total (unweighted)* | 144 | 84 | 43 | 11 | 6 | *88.2%* | *[82.9%, 93.5%]* | *11.8%* |

† Normal (Wald) approximation, ±1.96·√(p(1−p)/n). **Caveats:**

- For `exact` and `fuzzy-high` the Wald interval is not trustworthy — n = 24 with a single failure
  violates the usual np(1−p) ≥ 5 rule and the upper bound clips at 100%. The honest reading of
  1/24 is "somewhere around 1–20% failure"; an exact Clopper–Pearson interval on the shippable
  rate would be roughly [79%, 99.7%]. **Do not treat 95.8% as precise.**
- `high-reuse` (11/48) and `fuzzy-threshold` (4/48) are the only two strata where the normal
  approximation is even defensible, and only marginally.
- The sample total row is **not** a population estimate — the strata were sampled at very different
  rates (48/439 = 11% of high-reuse vs 24/1,581 = 1.5% of exact). See §2 for the weighted estimate.

**The one signal that survives significance testing** (Fisher exact, two-sided, on wrong+harmful):

| comparison | rates | p |
|---|---|---:|
| high-reuse vs everything else | 22.9% vs 6.2% | **0.0056** |
| high-reuse vs fuzzy-high | 22.9% vs 4.2% | 0.051 |
| high-reuse vs exact | 22.9% vs 4.2% | 0.051 |
| high-reuse vs fuzzy-threshold | 22.9% vs 8.3% | 0.089 |
| fuzzy-threshold vs fuzzy-high | 8.3% vs 4.2% | **0.659** |
| fuzzy-threshold vs exact | 8.3% vs 4.2% | 0.659 |
| good-rate: fuzzy-threshold vs fuzzy-high | 66.7% vs 75.0% | 0.591 |

Slug reuse is a real predictor. The fuzzy score is not (see §3).

---

## 2. Extrapolation to the 5,041 live matches

### A. Flat stratified estimate

Population sizes are **measured** (counted from the scored dump). Failure rates are **measured on
the sample**. The product is the **extrapolation**.

```
exact            1,581 × (1/24  =  4.17%)  =  65.9 bad
fuzzy-high         828 × (1/24  =  4.17%)  =  34.5 bad
fuzzy-threshold  2,193 × (4/48  =  8.33%)  = 182.8 bad
high-reuse         439 × (11/48 = 22.92%)  = 100.6 bad
                                              -------
                          TOTAL              ≈ 384 bad   (7.6% of 5,041)
```

**95% CI on the total ≈ [155, 613]** (stratified variance Σ Nₕ²·pₕ(1−pₕ)/nₕ, √ = 117; normal
approximation, and the two n=24 strata dominate the width — this interval is wide for a reason).

Splitting out the severe class the same way:

```
harmful only:  1,581×4.17% + 828×4.17% + 2,193×2.08% + 439×6.25% ≈ 174   (3.4% of 5,041)
```

So the extrapolated live picture is **≈ 384 bad pairings of which ≈ 174 are actively
misleading**, against ≈ 4,657 shippable ones.

### B. High-reuse, post-stratified by slug (more accurate than the flat 22.9%)

Failure inside the high-reuse stratum is not uniform — it is concentrated on a few assets. Weighting
each top-12 slug's measured rate by its real usage count:

| slug | live uses | sampled | bad | rate | est. bad |
|---|---:|---:|---:|---:|---:|
| kinetic-potential-energy | 75 | 4 | 0 | 0% | 0.0 |
| water-cycle-bag-window | 54 | 5 | 1 | 20% | 10.8 |
| energy-forms-icons | 50 | 4 | 0 | 0% | 0.0 |
| philippine-eagle-chick | 37 | 7 | 2 | 29% | 10.6 |
| heat-conduction | 37 | 5 | 2 | 40% | 14.8 |
| states-of-matter-water-three | 34 | 7 | 0 | 0% | 0.0 |
| solar-system | 32 | 1 | 0 | 0% | 0.0 |
| physical-vs-chemical-change-sort | 26 | 2 | 0 | 0% | 0.0 |
| four-s-dengue-prevention | 25 | 4 | 0 | 0% | 0.0 |
| **frying-egg-chemical-change** | 24 | 3 | 3 | **100%** | 24.0 |
| **light-refraction** | 23 | 2 | 2 | **100%** | 23.0 |
| complete-vs-incomplete-metamorphosis | 22 | 4 | 1 | 25% | 5.5 |
| | **439** | 48 | 11 | | **≈ 89** |

The weighted high-reuse figure (89) is close to the flat one (101), so the flat total of ~384 stands.
But the composition is the actionable part: **47 of the 89 (53%) sit on just two assets.**

### C. Defective-asset accounting — the single most concentrated cause

Four assets are **internally wrong** — the drawing contradicts its own slug, so *every* fact routed
to them is degraded no matter how good the match logic is:

| asset | live uses | sampled | what's wrong with the image |
|---|---:|---:|---|
| `frying-egg-chemical-change` | 24 | 3/3 bad | shows a **raw** egg cracked into a bowl — a physical change, no heat |
| `light-refraction` | 23 | 2/2 bad | abstract rays bouncing off an opaque box; reads as **reflection** |
| `sampaguita` | 1 | 1/1 bad | draws a lilac-type panicle, not *Jasminum sambac* |
| `food-pyramid-guide` | 1 | 1/1 bad | base tier labels **GRAINS + FATS SWEETS together** |
| **total** | **49 (1.0% of matches)** | **7/7 bad** | |

**49 matches = 1.0% of coverage carry ~13% of all extrapolated bad pairings**, at a measured 7/7
failure rate. This is a picture problem, not a matcher problem: regenerating `factImage.ts` cannot
touch it, and it will follow the assets into any future matcher.

---

## 3. Failure taxonomy — all 17 failures

| # | rating | stratum | fact | slug | slug reuse | class |
|---|---|---|---|---|---:|---|
| 1 | harmful | exact | `sampaguita-g4` | sampaguita | 1 | ART DEFECT |
| 2 | harmful | fuzzy-high | `go-foods-pyramid-base-g4` | food-pyramid-guide | 1 | ART DEFECT |
| 3 | harmful | high-reuse | `fwg-chemical-change-3185` | frying-egg-chemical-change | 24 | ART DEFECT |
| 4 | wrong | high-reuse | `fwg2-chemical-change-2979` | frying-egg-chemical-change | 24 | ART DEFECT + generic reuse |
| 5 | wrong | high-reuse | `fwg-chemical-change-2826` | frying-egg-chemical-change | 24 | ART DEFECT + generic reuse |
| 6 | wrong | high-reuse | `fwg-light-refraction-1817` | light-refraction | 23 | ART DEFECT + generic reuse |
| 7 | wrong | high-reuse | `fwg-light-refraction-1716` | light-refraction | 23 | ART DEFECT + generic reuse |
| 8 | harmful | high-reuse | `fwg-heat-conduction-1717` | heat-conduction | 37 | MECHANISM SWAP |
| 9 | wrong | high-reuse | `fwg2-heat-conduction-1326` | heat-conduction | 37 | MECHANISM SWAP |
| 10 | harmful | fuzzy-threshold | `firefly-light-no-heat-g5` | campfire-light-heat-energy | 14 | POLARITY INVERSION |
| 11 | harmful | high-reuse | `complete-incomplete-flower-g6` | complete-vs-incomplete-metamorphosis | 22 | HOMONYM COLLISION |
| 12 | wrong | fuzzy-threshold | `glass-made-from-sand-g4` | sand-settled-in-glass | 2 | HOMONYM COLLISION |
| 13 | wrong | fuzzy-threshold | `ants-work-as-team-g3` | body-systems-work-together | 6 | HOMONYM COLLISION |
| 14 | wrong | fuzzy-threshold | `fwg-static-electricity-1422` | static-electricity-balloon-hair | 20 | GENERIC-DEMO STAND-IN |
| 15 | wrong | high-reuse | `fwg2-water-cycle-597` | water-cycle-bag-window | 54 | GENERIC-DEMO STAND-IN |
| 16 | wrong | high-reuse | `philippine-eagle-wingspan-g8` | philippine-eagle-chick | 37 | ASSET GAP (wrong life stage) |
| 17 | wrong | high-reuse | `philippine-eagle-largest-eagle-g6` | philippine-eagle-chick | 37 | ASSET GAP (wrong life stage) |

**Recurring patterns, in order of extrapolated mass:**

1. **ART DEFECT — the image contradicts its own slug (7/17 failures).** `frying-egg-chemical-change`
   is not frying anything; `light-refraction` shows reflection; `sampaguita` is the wrong plant;
   `food-pyramid-guide` puts fats and sweets at the "eat most" tier. These fail 7/7 whenever
   sampled and are unfixable by the matcher.
2. **MECHANISM SWAP (2/17).** `heat-conduction` is the only "heat" diagram generic enough to win, so
   *radiant* facts (hot beach sand, hot asphalt, both absorbing sunlight) land on a flame-heats-a-rod
   picture and teach the wrong transfer mode. Two of the five sampled `heat-conduction` uses failed
   this way; both were about the sun.
3. **HOMONYM COLLISION — shared word, opposite meaning (3/17).** `glass-made-from-sand` →
   `sand-settled-in-glass` (sand + glass, opposite claim); `complete-incomplete-**flower**` →
   `complete-vs-incomplete-**metamorphosis**` (the fact is about flower parts; the image invites
   precisely the confusion the fact is trying to prevent); `ants-**work**-as-a-**team**` →
   `body-systems-**work**-**together**` (a human torso full of organs, no ants).
4. **GENERIC-DEMO STAND-IN (2/17).** A classroom demo asset absorbs facts about real-world
   phenomena of vastly different scale: Lake Lanao feeding Maria Cristina Falls → a ziplock bag on a
   window; 280 lightning strikes/hour over Venezuela → a balloon rubbed on a child's hair.
5. **ASSET GAP (2/17).** The only Philippine eagle asset is a downy chick, so both *size superlative*
   facts ("nearly 2 m wingspan", "largest eagle in the world") get an image conveying the opposite
   sense of scale. Five further chick pairings were rated only `acceptable` for the same reason —
   `philippine-eagle-chick` produced **0 `good` ratings in 7 samples.**

### Hypothesis 1 — do generic high-reuse slugs cause most failures? **Partly — they cause the highest RATE, but not the majority of the MASS.**

Yes on rate: high-reuse fails 22.9% vs 6.2% everywhere else, **p = 0.0056** — the only statistically
significant split in the whole QA. And the effect extends past the arbitrary top-12 cutoff. Failure
rate among the *non*-high-reuse rated pairs, bucketed by how often their slug is reused:

```
reuse = 1      2/30 =  6.7%
reuse = 2–4    1/32 =  3.1%
reuse = 5–9    1/18 =  5.6%
reuse = 10–21  2/16 = 12.5%
```

14 of the 17 failures sit on a slug reused ≥ 14 times. (`static-electricity-balloon-hair`, 20 uses,
and `campfire-light-heat-energy`, 14 uses, are top-13-to-20 slugs that fail exactly like top-12 ones
— the top-12 boundary is a sampling artefact, not a real cliff.)

No on mass: high-reuse is only **8.7% of matches**, so it contributes only **~26% (101/384)** of
extrapolated bad pairings. **~48%** of the bad mass is in `fuzzy-threshold`, simply because that
stratum is 43.5% of all matches. Fixing reuse alone cannot fix the majority of failures.

Reuse concentration overall: 2,283 distinct slugs are used; 1,463 matches are on a slug used once,
but 544 matches sit on slugs used 20+ times and 1,181 on slugs used ≥ 10 times.

### Hypothesis 2 — does the score threshold separate good from bad? **No. The score is not predictive.**

```
fuzzy-threshold (0.50–0.60):  4/48 fail =  8.3%   |  32/48 good = 66.7%
fuzzy-high      (0.60–1.00):  1/24 fail =  4.2%   |  18/24 good = 75.0%
                                 Fisher p = 0.659            p = 0.591
```

A 4-point difference on n = 48 vs 24 is indistinguishable from noise on both the fail rate and the
strict-good rate. And note `exact` — the *maximum-confidence* tier — also fails at 4.2%, the same as
`fuzzy-high`. **Score does not rank quality.**

Consequence, in numbers: raising the threshold 0.50 → 0.60 would delete **2,193 matches (43.5% of
all coverage, cutting the bank from 10.2% illustrated to 5.7%)** to remove an estimated **183** bad
ones — **12 shippable matches destroyed per bad match removed**, and it would not touch the
frying-egg / light-refraction / heat-conduction failures at all, since those score up to 0.75.
**Raising the threshold is the single worst available intervention.**

### Hypothesis 3 — does the `max()` denominator punish good matches? **Yes, severely — it is a recall bug, not a precision bug.**

`score = inter / max(|conceptTokens|, |slugTokens|)` means a fact with a long id + long topic is
penalised for its own verbosity even when it matches a slug *completely*. Re-running the matcher
read-only over the bank and capturing near-misses:

- **3,068 facts** score in [0.40, 0.50) and are rejected.
- **3,000 of those 3,068 (98%)** would score ≥ 0.5 under a `min()` denominator — i.e. they are
  rejected *only* by the choice of denominator.
- **424** of them have **inter ≥ 3** (three or more shared content tokens).

Concrete rejects, all with `min`-score 0.8–1.0 (every token of the slug matched):

| fact | topic | rejected slug | inter | ct | st | max-score | min-score |
|---|---|---|---:|---:|---:|---:|---:|
| `poso-water-pump-g5` | hand pump lifts water… | `hand-water-pump-poso` | 4 | 9 | 4 | 0.444 | **1.00** |
| `kalan-clay-stove-combustion-g5` | burning firewood in a clay stove | `kalan-clay-stove-firewood-scene` | 4 | 9 | 4 | 0.444 | **1.00** |
| `pawikan-green-turtle-eats-seagrass-g4` | green sea turtles eat seagrass | `green-sea-turtle-pawikan` | 4 | 9 | 4 | 0.444 | **1.00** |
| `ph-flying-fox-endangered-international-g6` | giant golden-crowned flying fox | `giant-golden-crowned-flying-fox` | 5 | 11 | 5 | 0.455 | **1.00** |
| `compound-machine-can-opener-g5` | can opener uses lever + wheel | `can-opener-compound-machine` | 4 | 9 | 4 | 0.444 | **1.00** |
| `em-north-pole-compass-needle-g5` | the compass needle's north pole | `compass-needle-points-north` | 4 | 9 | 4 | 0.444 | **1.00** |
| `plant-response-light-tropism-g4` | plants grow toward light | `phototropism-plant-toward-light-box` | 4 | 9 | 5 | 0.444 | 0.80 |

These are exactly the *specific, hand-drawn-for-this-fact* assets — the opposite of the generic
reused slugs that cause the failures. The scorer is systematically discarding its best matches and
keeping its worst.

A second denominator artefact: **855 of 3,458 accepted fuzzy matches (24.7%) have two or more
candidate slugs tied at the winning score**, and the winner is decided by JS `Set` iteration order
(i.e. asset filename order). 80 facts have 5+ tied candidates. `philippine-eagle-*` facts land on
`philippine-eagle-chick` vs `philippine-eagle-nesting-scene` purely by that accident.

### Side test — does the intersection size (`inter`) predict quality? **Confounded; do not act on it.**

Pooled, it looks like a strong signal: sampled fuzzy pairs with `inter = 2` fail **15/97 (15.5%)**
versus **1/21 (4.8%)** for `inter >= 3`, and **15 of the 16 fuzzy failures have `inter = 2`**. But
this is Simpson's paradox against the sampling design: the `high-reuse` stratum is 94% `inter = 2`
(382 of 408 in the population) and was deliberately oversampled at 11%. Within strata the cells
collapse:

```
fuzzy-high        inter=2: 0/10    inter>=3: 1/13
fuzzy-threshold   inter=2: 4/41    inter>=3: 0/6
high-reuse        inter=2: 11/46   inter>=3: 0/2
```

No stratum has enough `inter >= 3` samples to establish an independent effect. And the intervention
is unaffordable anyway: requiring `inter >= 3` would drop **2,452 matches (48.6% of all coverage)** —
worse than raising the threshold. Noted for a future, larger QA; not actionable now.

### Hypothesis 4 — ambiguous tokens funnelling unrelated facts onto one image? **Yes, and they are countable.**

Most frequent bridge tokens across the 3,458 accepted fuzzy matches:

```
energy 197 · water 196 · philippine 113 · cycle 97 · change 77 · light 76 · heat 71
forms 57 · rock 57 · system 56 · food 49 · earth 48 · moon 48 · eagle 44 · plant 42
```

Concentration per token (matches / distinct slugs they spread over):

| token | matches | slugs | dominant sink |
|---|---:|---:|---|
| `energy` | 197 | 11 | `kinetic-potential-energy` (78), `energy-forms-icons` (50) |
| `water` | 196 | 49 | `water-cycle-bag-window` (53) |
| `cycle` | 97 | 9 | `water-cycle-bag-window` (53) |
| `change` | 77 | 9 | `physical-vs-chemical-change-sort` (30), `frying-egg-chemical-change` (26) |
| `heat` | 71 | 6 | `heat-conduction` (37) |
| `light` | 76 | 14 | `light-refraction` (23) |
| `matter` | 27 | **1** | `states-of-matter-water-three` (27) — a single sink |
| `system` | 56 | 8 | `solar-system` (32) |
| `work` | 10 | 2 | `body-systems-work-together` (5) ← failure #13 |

Distinct fact **topics** funnelled onto one asset: `philippine-eagle-*` pulls **28 distinct topics**,
`kinetic-potential-energy` **27**, `water-cycle-bag-window` **18**, `physical-vs-chemical-change-sort`
**14**. This is where the "acceptable but generic" mass lives — 22 of 48 high-reuse pairs were rated
`acceptable`, i.e. topically right but not illustrating the specific claim.

Important nuance: token ambiguity mostly produces **`acceptable`, not `wrong`**. `energy` (197
matches, the single most ambiguous token) produced **zero** failures in 12 sampled pairs across
`kinetic-potential-energy` and `energy-forms-icons`. The tokens that actually caused failures were
narrow-but-polysemous ones (`complete`/`incomplete`, `sand`+`glass`, `work`+`together`,
`light`+`heat`), not the high-frequency ones. Adding `water`/`energy`/`plant`/`cycle` to the stopword
list would delete large amounts of correct coverage and prevent almost none of the observed damage.

---

## 4. Recommendation

**Regenerating `factImage.ts` against the 49,556-fact bank is safe to ship, with one 15-minute
change first.**

The measured shippable rate is 95.8% / 95.8% / 91.7% / 77.1% across the four strata, and the
weighted live estimate is **≈ 4,657 of 5,041 matches shippable (92.4%), ≈ 384 bad, ≈ 174 actively
misleading (3.4% of matches, 0.35% of the 49,556-fact bank)**. For a zero-cost decorative layer on
a feed where the *text* carries the teaching, that is a good trade — and the matcher's failures are
overwhelmingly *boring* (generic stand-in) rather than *false*.

**Do this one thing first:**

> **Quarantine the 4 self-inconsistent assets** — `frying-egg-chemical-change`,
> `light-refraction`, `sampaguita`, `food-pyramid-guide` — by removing/renaming their PNGs (or
> regenerating the artwork), then regenerate.

Justification, all measured: those 4 assets carry **49 live matches (1.0% of coverage)** and were
rated bad **7 out of 7 times sampled** — a 100% observed failure rate, versus 11.8% overall. They
account for **~13% of all extrapolated bad pairings** and **~53% of the high-reuse bad mass**.
Cost ratio ≈ **1.0 match destroyed per bad match removed** — an order of magnitude better than any
other lever. `food-pyramid-guide` in particular is the clearest *harmful* case in the whole QA: it
tells a child that fats and sweets belong at the "eat most often" tier. This is also the only
finding that is genuinely a **safety** issue rather than a polish issue.

**Do NOT do these** (each grounded in a number above):

- **Do not raise the threshold.** The score is not predictive: fuzzy-threshold 8.3% vs fuzzy-high
  4.2% fail, **p = 0.659** (and good-rate p = 0.591); `exact` fails at the same 4.2%. Moving
  0.50 → 0.60 costs **2,193 matches to remove ~183 bad ones — 12 destroyed per 1 fixed** — and
  misses every failure scoring above 0.6 (heat-conduction pairs score up to 0.75).
- **Do not add `water`/`energy`/`plant`/`cycle` to the stopword list.** They drive 196/197/42/97
  matches respectively and caused **zero** sampled failures; `energy` in particular bridged 8 sampled pairs, 8/8 shippable. They generate genericity (`acceptable`), not error.
- **Do not build a per-slug reuse cap now.** The economics are mediocre at every setting: cap = 10
  drops 481 matches (9.5% of coverage) to remove an estimated 83 bad ones — **5.8 destroyed per 1
  fixed** — and it would blindly discard the many *good* reuses (`four-s-dengue-prevention` 4/4,
  `states-of-matter-water-three` 7/7, `kinetic-potential-energy` 4/4, `energy-forms-icons` 4/4 all
  shippable). Reuse predicts risk (p = 0.0056) but a blunt cap cannot tell the good reuse from the
  bad, and the bad reuse is already ~53% explained by the 4 defective assets.

**Optional follow-ups, in value order — none blocking:**

1. **Draw an adult Philippine eagle.** `philippine-eagle-chick` is used 37 times and scored **0
   `good` in 7 samples** (2 wrong, 5 acceptable). It is the national bird and the most-reused
   organism asset in the bank; one new image upgrades ~37 pairings.
2. **Fix the `max()` denominator — this is the big coverage win, not a precision fix.** 3,068 facts
   are rejected at [0.40, 0.50) and **3,000 of them (98%) clear 0.5 under `min()`**, including
   **424** with three or more shared tokens, like `poso-water-pump-g5` → `hand-water-pump-poso` where *every* slug token matched.
   The safe form is not swapping to `min()` wholesale (that makes `inter = 2` on a 2-token slug score
   1.0 automatically) but adding a **full-slug-coverage** admit rule: accept when
   `inter == |slugTokens| && inter >= 3`, keeping `max()` as the ranking score. That targets the
   *bespoke* assets, which are the highest-precision ones in the set.
3. **Break score ties deterministically.** 855 of 3,458 fuzzy matches (24.7%) are decided by
   filename iteration order among tied candidates. Prefer the *least-reused* tied slug — free, and
   it pushes directly against the one factor that is statistically proven to cause failures.
4. **Use fact text, not just id + topic?** No evidence either way from this QA — none of the 17
   failures would obviously have been caught by tokenising the fact body, and several
   (`glass-made-from-sand`, `ants-work-as-a-team`) share the offending tokens with the body too.
   Not recommended without a fresh experiment.

### Method caveats

- Ratings are single-rater visual judgements; there is no inter-rater agreement measurement, and the
  good/acceptable boundary is the softest one (43 of 144 pairs sit on it).
- Within-stratum sampling is assumed representative. It is visibly *not* proportional per slug inside
  `high-reuse` (`solar-system` sampled 1/32, `philippine-eagle-chick` 7/37), which is why §2B
  post-stratifies; the two estimates agree within 12%.
- All extrapolated figures inherit the wide CI in §2A, [155, 613]. The qualitative conclusions
  (reuse matters, score does not, 4 assets are broken) are far more robust than the point estimates.
