# Fact-writing swarm v2 — normalising the feed across grade × quarter × competency
*Revised 2026-08-28 after two adversarial critiques (repo fidelity; product/cost). v1 claims that did not
survive are gone; every stage below names the script, the exact env wiring, or the script that must be added.*

## Product decisions
1. **Measure the real supply before writing.** The 18,816 per-factoid engravings (`packages/images/factoid-webp/`)
   belong to factoids that are in **neither** shipping pool (branch pool ∩ webp = 0; card-ui merged pool ∩ webp = 0).
   Illustrated supply = 36,384 factoids (18,816 engravings + ~16.9k clip-art) + 4,998 illustrated DepEd-module
   `dcard`s. Label all of it, wire the engravings, then measure gaps. Most "zero-card" competencies will move.
2. **JHS:** tags IN (the labeller already uses all 324 G3–10 codes); *writing* OUT for wave 1 (elementary only).
   JHS supply = dcards (module grade/quarter → MATATAG cell via `deped-taxonomy.json`) + existing facts.
3. **Non-fact-shaped competencies (21):** the 11 with `fact_able = 2` (units, instruments, fair-test features,
   electromagnet…) get "did-you-know about a method" cards at a floor of 20 (Lane C, needs a `card_form` input in
   `fw-gen-factoids.py`); the 10 with `fact_able ≤ 1` are OUT of the feed (quiz/activity later).
4. **Floors by fact-ability, not a flat 60:** 40 / 30 / 20 cards for `fact_able` 5 / 4 / 3; method cards 20. And the
   curriculum factor gets a **per-competency normalisation** (`× n_competency^-0.5`, computed at generation time) so a
   709-card competency cannot swamp a 40-card neighbour inside the ×8 cell.
5. **Ordering is date-independent.** The app weights cards dynamically from the device date and the student's grade
   at every draw, so whatever cards exist are surfaced in the right month whenever they ship. Write for the
   **thinnest cells first** (largest deficit relative to floor), G5 before G4/G6/G3 within a tie. No release date needed.

## Step 0 — supply, tags, measurement (in progress)
| | step | tool | status / gate |
|---|---|---|---|
| 0a | multi-label tags for all 36,293 factoids, qwen3.7-plus + deepseek-v4-pro agreement tier | `fw-label-competencies.py` → `assemble-competency-labels.py --also` | ✔ done 2026-08-28: 34,446 tagged, 25,692 with an agreed cell; $22.10 total; calibration 29.5% at ×6 |
| 0a′ | tags for the 19.4k non-pool factoids ✔ ($5.66) and the 10,937 illustrated DepEd-module cards ✔ ($5.13) — 45,073 items labelled in total | same script, `FW_INPUT=`; assembler `--extra` | done 2026-08-28 |
| 0a″ | gate on the 120 judged cards | `/tmp/score-ceiling.py` | measured: qwen3.7-plus cell recall 69% (80% on the clean half of the truth) vs Claude ceiling 78% (89%); deepseek-v4-pro 62/71, gpt-oss-120b 41/45 → qwen stays; see ensemble line in memory |
| 0b | **append-only `ffct` minting** in `assemble-factoids.py` (next free `ffct-36384`) + a re-run test that leaves every existing id untouched; keep all six `DEFAULT_PAIRS` | edit + test | BEFORE any ingest — `card_seen`, tags, and `factoid-webp/<id>.webp` are keyed by id |
| 0c | wire engravings into the shipping pool on **card-ui**: `to-card-png.mjs` → `packages/images/cards-png/<id>.png` → `gen-image-map.mjs` → append to `cardsPool.merged.json` → `wire-app-pool.py` | existing card-ui scripts + an append step (`merge-card-banks.py` takes only OLD + deped v3) | **never** run `gen-cards-pool.py` on card-ui (drops the 12,748 dcards) |
| 0d | real deficit | `competency-gaps.py` (v2: counts every code in `codes[]`, floors by `fact_able`) → `build-competency-briefs.py` (new; existing facts = labelled facts for the code + LaBSE top-k of the competency statement) | briefs quote the gaps file they came from |

## Measured after the re-tag (qwen labels, pool only; `competency-gaps.py --floor 40 --min-conf 0.5`)
Elementary: **21 of 123 fact-able competencies below floor, 344 cards short, 1 zero-card competency** (G6-E-3 volcanic
eruption patterns) — the lexical-era "3,386 short / 15 zero" was mis-tag noise. JHS: 127/180 below floor, 3,081 short,
but measured against the pool only. With ALL 36,293 factoids labelled (`jhs-supply.py`): engraving-backed factoids
not yet in the pool add **7,555 JHS card-cells and 18,750 elementary card-cells** once wired (0c) — e.g. G7-Q2 +507,
G8-Q2 +587, G10-Q3 +459 — leaving only G7-Q4 (+5), G8-Q3 (+9), G9-Q2 (+36), G10-Q1 (+28) genuinely thin. Wire first, write second. Briefs: `rag/bank/competency-briefs.json` (`build-competency-briefs.py --grades 3-6`).

## Final roundup (2026-08-28, `coverage-roundup.py` → rag/bank/COVERAGE-ROUNDUP.md)
After wiring the engravings, counting labelled module cards and appending Lane A (723 ready): **16 laggards, all JHS,
198 cards short** (elementary: zero). Lane B brief for exactly those 16 (461 candidates): `lane-a/LANE-B-BRIEF.md` +
`briefs-lane-b.json`. Tagging spend total ≈ $27.2; Lane A ingest $0.15.

## Status 2026-08-28 03:36 GMT+8
Engravings wired (18,816) and Lane A appended + illustrated (705/723; 18 body-cell declines → qwen-image fallback
worklist, not run): pool **36,469** (19,521 engraving-backed + 16,948 clip-art), bank 50,279, factoids 37,107, tags 34,553/36,469
pool cards; gate rc 0; calibration G5/Q2 25.5% at ×6. Roundup: **16 laggards, all JHS** → Lane B. Open: quiz lane for the
8,849 pool factIds without an MCQ (all 723 Lane A + 8,126 engraving cards), the 18-image fallback, APK size decision
(+~300 MB images, +2 MB gz facts export), commit.

## Lanes
- **Lane A (unblocked now):** fact-able competencies with ≤1 seed label AND `bank_facts < 30` — write immediately.
- **Lane B:** everything else, sized from 0d.
- **Lane C:** method cards for the 11 `fact_able = 2` competencies.

## Stages (corrected)
| stage | tool | wiring / notes |
|---|---|---|
| brief | `competency-briefs.json` (from `build-competency-briefs.py`) | competency text + content standard, kind/card_form, `existing_facts_en`, `target = ceil(need × oversample)`; oversample 3× for `fact_able ≤ 4` (measured survival: novelty ~34%, verify ~77%), 1.6× otherwise |
| write | **new `fw-gen-briefs.py`** (Fireworks lane) — one output file per brief, competency carried on every row; Claude-workflow lane = EN-only, non-AUP competencies only, same canonical candidate schema `{brief_code, domain, topic, en, grades}` | `fw-gen-facts.py` is domain-targeted and cannot take a brief |
| dedup | `fw-dedup-facts.py 0.86 0.90` **with IN/OUT args** (today it globs stale `fact-candidates/cand-*.jsonl`); existing set = bank + dcard text | LaBSE raw-CLS |
| ids | **new `mint-ids.py`**: `<slug>-g<grade>` factIds (competency in a field, not the id) | the fwg2 minting step was never committed |
| verify | `FW_MODEL=accounts/fireworks/models/gpt-oss-120b FW_INPUT=newfacts-to-verify.jsonl FW_OUT=newfact-verdicts fw-verify-facts.py` — default model is the *generator's* qwen3.7-plus, i.e. not decorrelated | disagreements → `fw-adjudicate.py`, not "keep ok from one judge" |
| translate + terms | `assemble-newfacts.py` + tl/bis query terms (extend the translate prompt or run `backfill-terms.py`) — `terms()` today is English-only | source string parametrised |
| exact tags | merge `{codes:[brief_code], cells, confidence:1.0}` into `curriculum-tags.json` v2 for every ingested fact | born-labelled facts need this step to exist |
| stage + feed voice | `build-factoid-src.py` → `fw-gen-factoids.py` (+ `card_form` input for Lane C) → `factoid-qa.py` → `assemble-factoids.py` (append-only) | |
| illustrate | **after** verify/dedup/translate only: `batch-submit-all.py` with `CHUNK≈120` + API download (`imagegen/fetch-batch.sh` + `extract.py`; `download-signed.sh` is the fallback) → `to-card-png.mjs` | ~3.4k × $0.0032 ≈ $11; body cells pre-planned for the qwen-image fallback with a style contact-sheet check |
| review | `review/make-sheets.py` **batch mode** (new worklist arg) → verdicts → regen | reject-rate ≤5% |
| quiz | `fw-genverify.py` → `fw-translate.py` → `assemble-quiz-bank.py` → `gen-cards-questions.py` | ≥1 MCQ per new factId (interject quiz is keyed by factId) |
| miss-card labels | one trilingual kid-facing label per content competency, judged for grade-5 readability | needed by the Miss Card |
| pool + gate | append to `cardsPool.merged.json` → `wire-app-pool.py` → `gen-curriculum-tags.mjs` → `build-vectors.py` → `export-facts-ts.py` → retrieval-stress cases per new competency → `run-harness.sh` green | the gate broke on the +5k expansion before |

## AUP routing
`rag/bank/aup-competencies.json` (new) = **all LIVING_THINGS codes** + any card whose text hits the
`aup-denylist.json` lexeme scan (buto/bukog, lason, plants-in-dark, body/health/reproduction…) → Fireworks for
writing, judging AND translation; Claude lane EN-only otherwise; acceptance judging for these via
`judge-local.mjs` / Fireworks. Never print them into a Claude context.

## Acceptance
- batch = **one competency**; blind fit judging of ALL its cards (judge sees the cell's competency list, must pick
  the code): ≥90% pick the assigned code;
- factual accuracy pooled per cell, n ≥ 200: ≥95%; illustration reject-rate ≤5%; Cebuano native spot-check per wave;
- stop rules: cell-level label agreement on the 120 judged cards <85% → stop and fix tagging; fit <90% after one
  rewrite → stop that competency.

## Cost ledger (script estimates at assumed $0.22 / $0.88 per M tokens — reconcile with the Fireworks bill)
re-tag: pool $8.5 + non-pool factoids ~$10 + dcards ~$6 (+ bank ~$25, RAG-only, optional) · writing (A+B, 3×
oversample) ~$15 · gpt-oss verify ~$5 · translate ~$5 · images after verify ~$11 · quiz MCQs ~$10 → **≈ $70–100**
plus human hours (contact sheets, native spot-check). Uncommitted artefacts this depends on: this spec,
`competency-gaps.py`, `competency-kinds.json`, `competency-seed-labels.json` (1,391 labels, 265 off),
`fw-label-competencies.py`, `assemble-competency-labels.py`, `matatag-jhs-competencies.json` (ignored dir).
