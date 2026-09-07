# Depth-fill — REPORT

Worktree `/Users/luis/Code/hiraia-depth-fill`, branch `depth-fill-facts` (off `unified` @ `b90d8e739`). Body-stream sentences never appear in this file: ids and counts only.

## 0. Prep (2026-09-07)

### Brief totals — first build differed from the snapshot by far more than 10 % (cause found, resolved)

| build | codes | need | target |
|---|---:|---:|---:|
| BRIEF §4 snapshot (unified, 2026-09-07) | 131 | 1,434 | 3,837 |
| first build in this worktree (as checked out) | **16** | **168** | **476** |
| after copying the post-audit inputs in (below) | **131** | **1,434** | **3,837** |

**Why.** The audit + recovery outputs are **uncommitted** in `hiraia-unified`: `packages/mobile/src/generated/curriculumTags.generated.json` (modified, 1.7 MB post-audit vs the committed 3.5 MB pre-audit file), `packages/mobile/src/data/curriculumTagOverrides.json`, `curriculumTagExclusions.json`, `tools/curriculum-tag-audit/`, and a modified `packages/mobile/scripts/gen-curriculum-tags.mjs`. The worktree was created from commit `b90d8e739`, which has none of them, so `build-briefs.py` counted `have` from pre-audit tags (most codes looked >= 20).

**Resolution.** Copied those inputs from `hiraia-unified` into this worktree (read from unified, nothing written there): the regenerated `curriculumTags.generated.json`, both override/exclusion JSONs, `gen-curriculum-tags.mjs`, and `tools/curriculum-tag-audit/{*.py,README.md}` (the 862 MB `runs/` dir was not copied). Re-running the builder against unified's own files read-only reproduced 131 / 1,434 / 3,837 exactly, and the worktree now matches. These copies are uncommitted here too (same state as unified); they must be committed on `unified` (or on this branch) before merge, otherwise Phase C (`gen-curriculum-tags.mjs`, `card-harness.mts`) runs against the wrong tags.

### Files

| file | what |
|---|---|
| `build-briefs.py` -> `briefs.json` | 131 briefs; card_form counts fact 99 / did-you-know-method 15 / method 10 / quiz 7; fact_able 2:21, 3:24, 4:49, 5:37 |
| `ingest.py` | copy of `lane-a/ingest-lane-a.py`; STREAMS main/body, AUP {'body'}, default verify+translate = `deepseek-v4-pro-0813`, `--writer` default `deepseek-v4-flash`, refuses any `gpt-oss` model, DeepSeek thinking on for the judge / off for the translator, emits `depth-ingest-ready[.body].jsonl` + `depth-tags.json`, `generator='depth-fill'`; venv = `/Users/luis/Code/hiraia/finetuning/.convert-venv/bin/python` |
| `append.py` | copy of `lane-a/append-lane-a.py`; `TAG='depth-fill'`, SRC `rag/pipeline/factoids-depth-fill-src.jsonl`, pair `rag/pipeline/factoids-gen-depth-fill:rag/pipeline/factoids-depth-fill-src.jsonl`, streams `depth-ingest-ready[.body].jsonl`, AUP {'body'}, `generator='depth-fill'`, absolute venv path |
| `fw-write-depth.py` | Flash writer (section 1) |
| `import-lane-b.py` | Lane B English import (below) |
| `out/depth-candidates.jsonl`, `out/depth-body.jsonl` | main / body candidate streams |
| `out/write-ledger.json` | writer token ledger per model, per-code counts, reject reasons |

### Models

| role | model |
|---|---|
| writer | `accounts/fireworks/models/deepseek-v4-flash-0731` (FW_MODEL; thinking on, temp 0.6) |
| judge | `accounts/fireworks/models/deepseek-v4-pro-0813` (LANE_A_VERIFY_MODEL / `ingest.py --verify-model` default) |
| translator | `accounts/fireworks/models/deepseek-v4-pro-0813` (FW_TRANSLATE_MODEL / `--translate-model` default) |
| factoid voice | `fw-gen-factoids.py` default (`qwen3p7-plus`), unchanged |
| images | OpenAI `gpt-image-2` low 1024 (batch-submit-all.py body), unchanged |

No gpt-oss anywhere: `ingest.py` and `fw-write-depth.py` exit if a model id contains `gpt-oss`. Family check: writer `deepseek-v4-flash` vs verify `...deepseek-v4-pro-0813` — `deepseekvflash` is not a substring of the verify id, so `--allow-same-family` is not needed.

### Lane B import (BRIEF section 6)

454 rows from `/Users/luis/Code/hiraia-lane-b/rag/pipeline/lane-b/out/lane-b-candidates.jsonl` -> `out/depth-candidates.jsonl`, tmp_ids rewritten `depth-<CODE>-001..`, `brief_code` kept, `origin='lane-b'` + `lane_b_tmp_id` added for provenance. `lane-b-body.jsonl` (G10-L-8, already at 20) skipped. `ingest.py --stages validate --dry-run`: 454 in, 454 valid, 0 rejected.

| code | imported | target | Flash quota |
|---|---:|---:|---:|
| G7-E-1 | 4 | 21 | 17 |
| G8-L-7 | 40 | 21 | 0 (over by 19) |
| G8-E-1 | 4 | 13 | 9 |
| G8-E-10 | 69 | 51 | 0 (over by 18) |
| G8-E-12 | 60 | 48 | 0 (over by 12) |
| G8-F-8 | 3 | 45 | 42 |
| G9-E-10 | 28 | 23 | 0 (over by 5) |
| G9-L-4 | 39 | 24 | 0 (over by 15) |
| G9-M-4 | 90 | 48 | 0 (over by 42) |
| G10-E-1 | 18 | 26 | 8 |
| G10-E-4 | 36 | 51 | 15 |
| G10-F-3 | 24 | 45 | 21 |
| G10-F-6 | 6 | 15 | 9 |
| G10-F-7 | 21 | 13 | 0 (over by 8) |
| G10-M-5 | 12 | 48 | 36 |

Seven codes carry more Lane B rows than their oversampled target (119 surplus). Imported whole per the handoff ("targets become target - imported"); the surplus only costs Pro verify/translate tokens and dedup will thin it. If a hard cap at `target` is wanted, trim at emit — not decided here.

Flash still to write: 3,837 - (454 - 119) = **3,502** across 124 codes (7 codes need nothing).

## 1. Writer (`fw-write-depth.py`)

Per brief the prompt carries: LC text + quarter Content title (`competency-content-map.json`) + grade/quarter/domain + cell kind/fact_able + form guidance (method cells: how a class or scientists actually do it, never "go do the activity"; content cells: the science a diagram would show; quiz cells: the lookup and the rule behind it) + BRIEF section 5 / GENERATION-BRIEF rules + three register examples (G9-M-4 valence, G5-F-2 fair-test method, G10-L-9 Golden Rice) + `existing_facts_en` as DO-NOT-RESTATE + already-written rows for that code as a second DO-NOT-RESTATE list + body routing rule (model flag OR a regex backstop -> `out/depth-body.jsonl`).

Writes exactly `target` per code: rows present on disk (both streams, Lane B included) count; a call asks for `min(remaining, FW_PER_CALL=25)`; rows are validated (15-35 words, one sentence, confidence in {2,3}, >= 6 terms after the English content-word floor, no exact restatement, no activity-prompt voice on method cells) and capped at the remaining quota; a code is topped up in rounds until complete (max ceil(target/25)+3 rounds). Resumable per code. `FW_LIMIT` = max codes per run, `FW_CODES` = restrict to codes.

### Writer result (2026-09-07, finished 21:29)

Three runs (2-code dry run, main run, detached resume at 79/131 with FW_CONC=8). 124 codes written, **none short of target** (G7-E-10, short 11 after a `finish_reason=length` round in the main run, was completed by the resume; the one-time `FW_THINKING=0 FW_PER_CALL=10` top-up was not needed). The 7 codes whose Lane B import already exceeds target got nothing written (G8-E-10, G8-E-12, G9-M-4, G9-L-4, G9-E-10, G8-L-7, G10-F-7).

| stream | rows |
|---|---:|
| `out/depth-candidates.jsonl` (main) | 3,952 (454 Lane B + 3,498 Flash) |
| `out/depth-body.jsonl` (body, ids/counts only) | 4 |

Writer-side rejects (never written): en-words 2, restates-existing 19, activity-prompt-voice 18, truncated 13, en-multi-sentence 1.

## 2. Ingest — validate / dedup / mint (dry run on the final set)

`ingest.py --writer deepseek-v4-flash --stages validate,dedup,mint --dry-run` (log `out/ingest-dryrun.log`):

| stage | main | body | note |
|---|---:|---:|---|
| validate | 3,952 / 3,952 | 4 / 4 | 0 rejects |
| dedup (LaBSE 0.86 vs bank 50,279 + factoids 37,107 + dcards 9,889 + briefs-feed 1,186; 0.90 within batch) | 3,175 | 3 | 730 near-existing, 48 near-candidate dropped |
| mint | 3,175 | 3 | 3,178 ids, 19 collision-suffixed, `out/id-map.json` |

After dedup 12 codes were already below `need` (35 short in total) — every one of them lost >50 % of its candidates to near-existing (they restate what the pool already says in other words): G7-M-4 (need 15, 9 left), G8-E-3 (7, 2), G8-L-1 (16, 12), G9-L-9 (16, 12), G8-E-5 (15, 11), G7-E-1 (13, 10), G9-E-1 (12, 10), G7-F-8 (9, 7), G9-E-3 (8, 6), G10-E-3 (9, 8), G10-E-7 (5, 4), G8-M-3 (4, 3).

## 3. Ingest — Pro verify / Pro translate / emit (2026-09-07 21:33–22:11)

`ingest.py --writer deepseek-v4-flash --stages verify,translate,emit --conc 8 --batch 12` with `LANE_A_VERIFY_MODEL` = `FW_TRANSLATE_MODEL` = `accounts/fireworks/models/deepseek-v4-pro-0813` (logs `out/ingest-full.run1.log`, `out/ingest-full.run2.log`). The family check passed on `--writer deepseek-v4-flash`; `--allow-same-family` was not needed. No rate limiting at conc 8. Run 2 is the cache-driven resume for the 12 ids the judge did not return in run 1 and the translate stragglers. `out/ingest-summary.json` records `verify_model` and `translate_model` = DeepSeek v4 Pro; no `gpt-oss` string in any summary or ledger.

| stage | main | body | drops |
|---|---:|---:|---|
| verify (thinking on, keep `ok` only) | 3,175 → **2,860** | 3 → **2** | suspect 262, wrong 54 (316 of 3,178 = 9.9 %) → `out/verify-drops.jsonl` |
| translate (thinking off; tl + bis + trilingual terms) | 2,860 → **2,859** | 2 → 2 | 1 pending: `assigning-rock-layer-to-period-g9` (G9-E-6; Pro's translation failed `translation_ok` in both runs — G9-E-6 is above need without it) |
| emit | **2,859** → `out/depth-ingest-ready.jsonl` | **2** → `out/depth-ingest-ready.body.jsonl` | `out/depth-tags.json`: 2,861 v2 entries keyed by bank fact id |

Emitted rows: every one has non-empty `fact.tl/en/bis`, ≥6 terms with ≥1 hit in each of tl and bis, `generator = depth-fill`, `source = "depth-fill deepseek-v4-flash + deepseek-v4-pro-0813 verify (2026-09)"`; 0 duplicate ids, 0 collisions with `science-facts.jsonl`.

### Codes still below `need` after verify (14 codes, 46 short)

2,861 survivors against a total need of 1,434; 117 of 131 codes are at or above need. Not re-written: these are the codes where the pool already says most of what there is to say at this grade, so more Flash rounds mostly produce near-existing paraphrases (the dedup table above). Reported, not retried.

| code | need | surviving | short | where it was lost |
|---|---:|---:|---:|---|
| G7-M-4 | 15 | 7 | 8 | 15 near-existing, 2 verify |
| G8-L-1 | 16 | 11 | 5 | 14 near-existing, 1 verify |
| G9-L-9 | 16 | 11 | 5 | 14 near-existing, 1 verify |
| G8-E-5 | 15 | 10 | 5 | 13 near-existing, 1 verify |
| G8-E-3 | 7 | 2 | 5 | 10 near-existing |
| G7-F-8 | 9 | 5 | 4 | 8 near-existing, 2 verify |
| G7-E-1 | 13 | 10 | 3 | 11 near-existing |
| G9-M-7 | 14 | 12 | 2 | verify |
| G9-E-1 | 12 | 10 | 2 | 10 near-existing |
| G10-E-3 | 9 | 7 | 2 | 19 dedup, 1 verify |
| G9-E-3 | 8 | 6 | 2 | 7 near-existing |
| G8-L-10 | 7 | 6 | 1 | verify |
| G10-E-7 | 5 | 4 | 1 | 4 near-existing |
| G8-M-3 | 4 | 3 | 1 | 4 near-existing |

Downstream (factoid voice, image declines) will thin these further; the Phase C recount decides whether a targeted second write for these 14 is worth it.

## 4. Spend ledger (Fireworks; tokens authoritative, USD estimated)

| stage | model | calls | tokens in | tokens out | est USD | price basis |
|---|---|---:|---:|---:|---:|---|
| write (3 runs) | deepseek-v4-flash-0731 | 269 (0 failed) | 487,703 | 2,893,413 | 0.878 | $0.14 / $0.28 per M (fw_audit.py Flash list prices) |
| verify | deepseek-v4-pro-0813 | 267 | (run 1+2 combined below) | | | |
| translate | deepseek-v4-pro-0813 | 291 | | | | |
| verify + translate total | deepseek-v4-pro-0813 | 558 | 443,904 | 1,452,886 | 2.276 | ingest.py default $1.20 / $1.20 per M (`FW_PRICE_IN/OUT`; no Pro list price is recorded in-repo — re-price from the Fireworks invoice) |
| **Fireworks total so far** | | 827 | 931,607 | 4,346,299 | **≈ 3.15** | |

Not yet spent: factoid voice (`qwen3p7-plus`, append stage) and images (~$0.0032 × landed).

Authoritative numbers: `out/write-ledger.json` (writer), `out/ingest-summary.run1.json` + `out/ingest-summary.json` (Pro run 1 / resume run 2), later `out/append-state.json` (factoid voice, images).

## 5. Next (append stage — not started)

```bash
python3 rag/pipeline/depth-fill/append.py --stages bank,src,gen,assemble,tags,vectors
python3 rag/pipeline/depth-fill/append.py --stages images   # submit
python3 rag/pipeline/depth-fill/append.py --stages fetch
```
Then Phase C: wire webp → pool append → `gen-curriculum-tags.mjs` → titles/cats (`FW_MISSING=1 fw-gen-card-titles.py`, `assemble-card-titles.py`) → `build-cards-db.py` → `card-harness.mts` → recount → `run-harness.sh`. The audit inputs copied in during prep (§0) are still uncommitted here and on `unified`.

