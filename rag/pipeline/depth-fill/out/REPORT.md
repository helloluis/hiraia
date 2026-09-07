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

## 5. Append — bank → src → factoid voice → assemble → tags → vectors (2026-09-07 22:34–23:03, DONE)

`append.py` (logs `out/append.run1.log`, `out/append.run2.log`; state + ledger `out/append-state.json`). Input = the post-prune emit
(2,729 main + 2 body = **2,731** rows). Every stage is idempotent; the bank is append-only; every pre-existing row is byte-identical.

| stage | result |
|---|---|
| bank | backups `rag/bank/.backup-2026-09-07/{science-facts,factoids,curriculum-tags}.jsonl/json` (sha256 = live at backup time); `science-facts.jsonl` **50,279 → 53,010** (+2,731: main 2,729, body 2), ids unique, `generator=depth-fill`, `reviewed=false`; `brief_code`/`card_form` stripped to `out/depth-bank-meta.json` |
| src | `rag/pipeline/factoids-depth-fill-src.jsonl` 2,731 rows, `has_image=false`, main first / body last (no 8-row call mixes streams); gitignored by repo rule (`factoids-*-src.jsonl`) |
| gen | `fw-gen-factoids.py` default voice **`accounts/fireworks/models/qwen3p7-plus`** (hard-coded in that script; `FW_MODEL` was unset for this run): smoke 1 call (8/8 rows, prompts well-formed) → full 341 calls, 0 failed, 2,699 rows → `factoid-qa.py` round 0 found 24 `missing-row` (model returned 7 of 8 in 24 calls; no other rule tripped) → regen round 1 (3 calls, 24 rows, 0 failed) → round 1 QA: **0 issues**. 2,731 rows for 2,731 src rows, dups 0, formats straight 1,547 / qa 1,184. Gen dir `rag/pipeline/factoids-gen-depth-fill/` (343 files) is gitignored by repo rule (`factoids-gen-*/`), as Lane A's was |
| assemble | **`--assemble-pairs registry-only`** (new flag, see below): `assemble-factoids.py --check` with the depth-fill pair alone → carried over 37,107 verbatim, content changed under an existing id 0, append-only OK → WRITE → post-write `--check`: byte-identical YES, append-only OK. `factoids.jsonl` **37,107 → 39,838**; new ids **`ffct-37107`..`ffct-39837`** (contiguous); pre-existing 37,107 rows byte-identical to git HEAD **and** to the backup; image prompt 2,731 / slug 0; trilingual 2,731; by domain EARTH_SPACE 923, LIVING_THINGS 688, FORCE_MOTION_ENERGY 602, MATTER 518 |
| tags | `out/depth-tags.json` re-keyed to the new ffct ids → `curriculum-tags.json` `factoids` section **+2,731 → 48,527** entries (v2 entry: codes `[brief_code]`, score/confidence 1.0, cells_strong = cells, models 1); 45,796 pre-existing entries unchanged vs loaded file and vs backup; `bank` section left as found (0). `gen-curriculum-tags.mjs` re-run: `curriculumTags.generated.json` **UNCHANGED** (22,511/46,421 pool cards tagged, 0 unknown-code) — expected, the new factoids have no illustration yet so they are not pool cards |
| vectors | `build-vectors.py` (LaBSE, main-checkout venv): `vectors-labse.i8.bin` 122 MB, meta count **53,010**, bankHash **13ff876529fa** = bank; `build-facts-db.py` → `cards.db` fact tables (139.1 → 142.1 MB; `cards.db` is gitignored — it was seeded from unified's copy so the db is whole, and Phase C's `build-cards-db.py` recreates it anyway) with `fact_meta` count/hash = bank; `cardsIndex.generated.json` `dbVersion` restamped 39328b634e19 → 1edb5e1397e5 (only key that changed) |

**Why `--assemble-pairs registry-only`.** Lane A's assemble pre-check re-reads the six `DEFAULT_PAIRS` gen dirs + src files and demands byte-identity. Those inputs are gitignored and exist only in the stale `question-cards` checkout, not on `unified` or in this worktree (run 1 stopped at `pair does not resolve`, rc 1, bank/src/gen already applied and left intact). Copying 70 MB of another branch's gen dirs in and hoping they still reproduce this tree's registry is the fragile option; `assemble-factoids.py` already carries every banked row over **verbatim** when it is "banked but no longer in the inputs", so passing only the depth-fill pair makes the pre-existing prefix identical by construction. `append.py` grew the explicit flag (default mode unchanged; default mode now names the unresolved pair and points at the flag), and the registry-only dry run must carry over exactly `len(registry)` rows with 0 content changes before it writes. Same post-write proofs as Lane A (prefix vs HEAD, prefix vs backup, contiguous ids).

## 6. Images — SUBMIT BLOCKED by the OpenAI billing hard limit (2026-09-07 23:07)

`append.py --stages images` (log `out/append.run3-images.log`) built the worklists — `out/image-worklist.main.jsonl` **2,729**, `out/image-worklist.body.jsonl` **2** (AUP prompts stay on disk) — and the first request file `out/image-req-01.main.jsonl` (119 requests; gpt-image-2, quality low, 1024×1024, `batch-submit-all.py` STYLE suffix, max prompt 801 chars). The file upload succeeded (`file-HHRM3tt9qatBBNkv3JnUbH`, purpose batch, processed) but `POST /v1/batches` returned **HTTP 400 `billing_hard_limit_reached`** ("Billing hard limit has been reached"). Reproduced with curl on the same file id. The account had no active batches at the time (17 completed / 3 failed in the recent list); two uploads named `image-req-01.main.jsonl` / `r.jsonl` from ~2.6 h earlier suggest another run hit the same wall.

**Not a pipeline problem — a billing action for Luis:** raise the monthly hard limit on the OpenAI organisation (or wait for the cycle to reset), then re-run `append.py --stages images`. The stage is resumable and nothing was booked: `out/image-batches.json` does not exist, `append-state.json` has no `images` entry, and a re-run re-uploads (the orphaned `file-HHRM3tt9qatBBNkv3JnUbH` can be deleted or ignored). Expected: 23 main batches (~119 each) + 1 body batch (2) = **24 batches, 2,731 requests, ≈ $8.74** at $0.0032/image.

**Batches submitted: 0. Images submitted: 0.**

## 7. Per-code funnel — candidates → dedup → verified → emitted (post-prune) → banked → factoids minted

Generated by `report-per-code.py` (also `out/per-code-funnel.md` / `.json`). `have` = pool cards before this run; `short` = need − banked.
Totals: 131 codes, need 1,434, target 3,837 → candidates 3,956 (454 Lane B) → dedup kept 3,178 → verified ok 2,862 → emitted after the four prune rounds 2,731 → **banked 2,731** → **factoids minted 2,731**. **117 codes at or above need; 14 below (46 short)** — the same 14 as after verify (§3): the prune rounds never touched a code at or below need. Seven codes sit exactly at need (G9-L-4, G7-L-6, G10-F-7, G8-E-4, G7-L-9, G9-M-5, G8-F-7) — any image decline there drops the code below 20; the Phase C recount decides whether a targeted second write for these 21 codes is worth it.

Skipped by design (BRIEF §2, `fact_able ≤ 1`, never briefed): G3-M-2, G3-L-1, G3-F-3, G4-M-7, G4-F-2, G4-F-4, G5-M-5, G6-M-8, G6-L-3, G7-M-7, G8-F-3, G9-L-11.



## 3.5 Pre-append prune (2026-09-07 22:0x–22:3x) — sample-review holds released

The adversarial 72-row sample held twice (6.9 % at seed 20260907, 5.6 % at seed 20260908). Both holds were dominated by one
systematic writer artifact that Pro-verify cannot catch because nothing in it is false: a **source-literacy / self-instruction
register** ("In one sentence:", "Sources note…", "cite that page rather than a forwarded text", "The competency asks…"),
concentrated in the seven Lane-B "gather information from secondary sources" codes — G8-E-10, G8-E-12, G9-E-10, G9-L-4,
G9-M-4, G10-E-4, G10-F-7 — all of which were over their oversampled target, so pruning there never touches `need`.

`prune-emitted.py` removed rows from `out/depth-ingest-ready.jsonl` + `out/depth-tags.json` in three rounds (bank untouched;
the pre-prune file is commit 9268471e7; cumulative log `out/prune-drops.cumulative.jsonl`, ids + reasons only):

| round | source of the drop list | rows |
|---|---|---:|
| 1 | reviewer's 27 explicit ids stream-wide + register regex inside the seven codes | 58 |
| 2 | reviewer 2's stream-wide sweep (41) + 1 misleading mechanism + 1 Cebuano inversion | 42 |
| 3 | 32-agent judge workflow (judge → keep-skeptic per 30-row chunk over all 357 rows in the seven codes + 88 attribution-flavoured rows elsewhere): 45 proposed, 12 rescued by the skeptic, 20 new after de-dup with round 2 | 20 |
| 3 | 400-row tl/bis translation audit (8 agents, clear meaning errors only): 4 errors in 398 checked (1.0 %; 2 tl, 2 bis) — rows dropped | 4 |
| 4 | append agent's hold list (2026-09-07 22:33, `out/prune-extra.round4.jsonl`): 1 TL meaning error (G8-F-2, "accelerating" rendered as *bumibilis* next to *pantay na bilis*), 1 second-person misconception drill (G9-M-4), 3 "secondary sources" meta-register residues (G8-E-10, G8-E-12 ×2), 1 attribution-flavoured residue (G9-L-4) | 6 |
| **total** | 2,859 → **2,729** main (body 2 unchanged) | **130** |

Per code (rounds 1–3): G8-E-10 −34 (→28/need 17), G8-E-12 −18 (→37/16), G9-L-4 −17 (→16/15), G10-E-4 −16 (→28/17), G9-M-4 −11 (→75/16),
G10-F-7 −10 (→8/8), G9-E-10 −8 (→19/14), G10-F-3 −2, singletons in G10-E-1, G5-F-2, G8-L-4, G9-M-9, G3-E-1, G7-E-8, G8-M-8,
G8-F-7 (→2/need 2). Round 4: G8-E-10 → 27/17, G8-E-12 → 35/16, G8-F-2 → 8/6, G9-L-4 → 15/15 (exactly need), G9-M-4 → 74/16.
No code fell below `need` in any round.

Recurrence guard for the next run: add a register criterion to the ingest verify prompt (advice / meta / self-instruction ⇒
`suspect`) and treat Lane-B "gather information" competencies as advice-prone at write time. Translation error rate measured
at ~1 % (meaning-level) — acceptable under the brief's 5 % sample rule; a full Pro back-check pass is optional follow-up.
### 7.1 Full per-code funnel (sorted by shortfall, then code)

| code | have | need | target | candidates | laneB | dedup kept | verified ok | emitted | banked | factoids | short |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| G7-M-4 | 5 | 15 | 24 | 24 | 0 | 9 | 7 | 7 | 7 | 7 | 8 |
| G8-E-3 | 13 | 7 | 12 | 12 | 0 | 2 | 2 | 2 | 2 | 2 | 5 |
| G8-E-5 | 5 | 15 | 24 | 24 | 0 | 11 | 10 | 10 | 10 | 10 | 5 |
| G8-L-1 | 4 | 16 | 26 | 26 | 0 | 12 | 11 | 11 | 11 | 11 | 5 |
| G9-L-9 | 4 | 16 | 26 | 26 | 0 | 12 | 11 | 11 | 11 | 11 | 5 |
| G7-F-8 | 11 | 9 | 15 | 15 | 0 | 7 | 5 | 5 | 5 | 5 | 4 |
| G7-E-1 | 7 | 13 | 21 | 21 | 4 | 10 | 10 | 10 | 10 | 10 | 3 |
| G10-E-3 | 11 | 9 | 27 | 27 | 0 | 8 | 7 | 7 | 7 | 7 | 2 |
| G9-E-1 | 8 | 12 | 20 | 20 | 0 | 10 | 10 | 10 | 10 | 10 | 2 |
| G9-E-3 | 12 | 8 | 13 | 13 | 0 | 6 | 6 | 6 | 6 | 6 | 2 |
| G9-M-7 | 6 | 14 | 23 | 23 | 0 | 16 | 12 | 12 | 12 | 12 | 2 |
| G10-E-7 | 15 | 5 | 8 | 8 | 0 | 4 | 4 | 4 | 4 | 4 | 1 |
| G8-L-10 | 13 | 7 | 12 | 12 | 0 | 7 | 6 | 6 | 6 | 6 | 1 |
| G8-M-3 | 16 | 4 | 7 | 7 | 0 | 3 | 3 | 3 | 3 | 3 | 1 |
| G10-E-1 | 4 | 16 | 26 | 26 | 18 | 24 | 24 | 23 | 23 | 23 |  |
| G10-E-12 | 18 | 2 | 4 | 4 | 0 | 4 | 4 | 4 | 4 | 4 |  |
| G10-E-4 | 3 | 17 | 51 | 51 | 36 | 49 | 44 | 28 | 28 | 28 |  |
| G10-E-6 | 17 | 3 | 5 | 5 | 0 | 4 | 4 | 4 | 4 | 4 |  |
| G10-F-1 | 10 | 10 | 30 | 30 | 0 | 26 | 20 | 20 | 20 | 20 |  |
| G10-F-11 | 3 | 17 | 28 | 28 | 0 | 19 | 18 | 18 | 18 | 18 |  |
| G10-F-2 | 8 | 12 | 20 | 20 | 0 | 15 | 14 | 14 | 14 | 14 |  |
| G10-F-3 | 5 | 15 | 45 | 45 | 24 | 42 | 39 | 37 | 37 | 37 |  |
| G10-F-5 | 4 | 16 | 48 | 48 | 0 | 47 | 33 | 33 | 33 | 33 |  |
| G10-F-6 | 15 | 5 | 15 | 15 | 6 | 15 | 11 | 11 | 11 | 11 |  |
| G10-F-7 | 12 | 8 | 13 | 21 | 21 | 21 | 18 | 8 | 8 | 8 |  |
| G10-F-8 | 13 | 7 | 21 | 21 | 0 | 18 | 15 | 15 | 15 | 15 |  |
| G10-F-9 | 14 | 6 | 10 | 10 | 0 | 8 | 8 | 8 | 8 | 8 |  |
| G10-L-10 | 18 | 2 | 4 | 4 | 0 | 3 | 3 | 3 | 3 | 3 |  |
| G10-L-11 | 3 | 17 | 51 | 51 | 0 | 47 | 45 | 45 | 45 | 45 |  |
| G10-L-9 | 5 | 15 | 45 | 45 | 0 | 45 | 43 | 43 | 43 | 43 |  |
| G10-M-3 | 13 | 7 | 21 | 21 | 0 | 16 | 14 | 14 | 14 | 14 |  |
| G10-M-5 | 4 | 16 | 48 | 48 | 12 | 42 | 38 | 38 | 38 | 38 |  |
| G10-M-7 | 4 | 16 | 48 | 48 | 0 | 44 | 42 | 42 | 42 | 42 |  |
| G3-E-1 | 8 | 12 | 36 | 36 | 0 | 21 | 17 | 16 | 16 | 16 |  |
| G3-E-4 | 7 | 13 | 39 | 39 | 0 | 31 | 30 | 30 | 30 | 30 |  |
| G3-E-7 | 15 | 5 | 15 | 15 | 0 | 13 | 12 | 12 | 12 | 12 |  |
| G3-L-2 | 13 | 7 | 21 | 21 | 0 | 19 | 17 | 17 | 17 | 17 |  |
| G3-M-4 | 18 | 2 | 6 | 6 | 0 | 5 | 5 | 5 | 5 | 5 |  |
| G4-E-1 | 6 | 14 | 42 | 42 | 0 | 34 | 33 | 33 | 33 | 33 |  |
| G4-E-3 | 6 | 14 | 42 | 42 | 0 | 40 | 38 | 38 | 38 | 38 |  |
| G4-E-8 | 18 | 2 | 6 | 6 | 0 | 6 | 5 | 5 | 5 | 5 |  |
| G4-F-1 | 3 | 17 | 51 | 51 | 0 | 49 | 41 | 41 | 41 | 41 |  |
| G4-L-3 | 4 | 16 | 48 | 48 | 0 | 27 | 24 | 24 | 24 | 24 |  |
| G4-L-4 | 4 | 16 | 48 | 48 | 0 | 34 | 30 | 30 | 30 | 30 |  |
| G4-L-5 | 4 | 16 | 48 | 48 | 0 | 39 | 34 | 34 | 34 | 34 |  |
| G4-L-7 | 3 | 17 | 51 | 51 | 0 | 33 | 28 | 28 | 28 | 28 |  |
| G5-E-12 | 5 | 15 | 45 | 45 | 0 | 29 | 25 | 25 | 25 | 25 |  |
| G5-E-2 | 9 | 11 | 33 | 33 | 0 | 29 | 24 | 24 | 24 | 24 |  |
| G5-E-3 | 5 | 15 | 45 | 45 | 0 | 42 | 35 | 35 | 35 | 35 |  |
| G5-E-7 | 5 | 15 | 45 | 45 | 0 | 45 | 38 | 38 | 38 | 38 |  |
| G5-F-1 | 15 | 5 | 15 | 15 | 0 | 13 | 13 | 13 | 13 | 13 |  |
| G5-F-10 | 17 | 3 | 9 | 9 | 0 | 8 | 7 | 7 | 7 | 7 |  |
| G5-F-2 | 3 | 17 | 51 | 51 | 0 | 51 | 50 | 49 | 49 | 49 |  |
| G5-F-8 | 8 | 12 | 36 | 36 | 0 | 32 | 32 | 32 | 32 | 32 |  |
| G5-F-9 | 9 | 11 | 33 | 33 | 0 | 23 | 20 | 20 | 20 | 20 |  |
| G5-L-4 | 6 | 14 | 42 | 42 | 0 | 25 | 22 | 22 | 22 | 22 |  |
| G5-L-6 | 14 | 6 | 18 | 18 | 0 | 15 | 11 | 11 | 11 | 11 |  |
| G5-M-9 | 4 | 16 | 48 | 48 | 0 | 45 | 40 | 40 | 40 | 40 |  |
| G6-E-2 | 4 | 16 | 48 | 48 | 0 | 30 | 27 | 27 | 27 | 27 |  |
| G6-E-3 | 19 | 1 | 3 | 3 | 0 | 2 | 2 | 2 | 2 | 2 |  |
| G6-F-3 | 8 | 12 | 36 | 36 | 0 | 30 | 26 | 26 | 26 | 26 |  |
| G6-F-8 | 3 | 17 | 51 | 51 | 0 | 42 | 40 | 40 | 40 | 40 |  |
| G7-E-10 | 3 | 17 | 51 | 51 | 0 | 42 | 40 | 40 | 40 | 40 |  |
| G7-E-11 | 7 | 13 | 39 | 39 | 0 | 29 | 24 | 24 | 24 | 24 |  |
| G7-E-2 | 17 | 3 | 9 | 9 | 0 | 6 | 6 | 6 | 6 | 6 |  |
| G7-E-4 | 7 | 13 | 39 | 39 | 0 | 39 | 36 | 36 | 36 | 36 |  |
| G7-E-5 | 3 | 17 | 51 | 51 | 0 | 21 | 20 | 20 | 20 | 20 |  |
| G7-E-6 | 8 | 12 | 36 | 36 | 0 | 32 | 31 | 31 | 31 | 31 |  |
| G7-E-8 | 8 | 12 | 36 | 36 | 0 | 25 | 24 | 23 | 23 | 23 |  |
| G7-F-11 | 18 | 2 | 6 | 6 | 0 | 6 | 6 | 6 | 6 | 6 |  |
| G7-F-3 | 6 | 14 | 42 | 42 | 0 | 41 | 35 | 35 | 35 | 35 |  |
| G7-F-5 | 11 | 9 | 15 | 15 | 0 | 15 | 13 | 13 | 13 | 13 |  |
| G7-F-6 | 10 | 10 | 30 | 30 | 0 | 27 | 24 | 24 | 24 | 24 |  |
| G7-F-7 | 13 | 7 | 21 | 21 | 0 | 21 | 19 | 19 | 19 | 19 |  |
| G7-L-10 | 13 | 7 | 12 | 12 | 0 | 8 | 8 | 8 | 8 | 8 |  |
| G7-L-2 | 5 | 15 | 45 | 45 | 0 | 31 | 26 | 26 | 26 | 26 |  |
| G7-L-4 | 11 | 9 | 15 | 15 | 0 | 12 | 12 | 12 | 12 | 12 |  |
| G7-L-6 | 10 | 10 | 16 | 16 | 0 | 11 | 10 | 10 | 10 | 10 |  |
| G7-L-8 | 6 | 14 | 23 | 23 | 0 | 20 | 18 | 18 | 18 | 18 |  |
| G7-L-9 | 16 | 4 | 7 | 7 | 0 | 5 | 4 | 4 | 4 | 4 |  |
| G7-M-1 | 13 | 7 | 21 | 21 | 0 | 19 | 17 | 17 | 17 | 17 |  |
| G7-M-12 | 7 | 13 | 39 | 39 | 0 | 31 | 30 | 30 | 30 | 30 |  |
| G7-M-6 | 6 | 14 | 42 | 42 | 0 | 35 | 33 | 33 | 33 | 33 |  |
| G8-E-1 | 12 | 8 | 13 | 13 | 4 | 11 | 11 | 11 | 11 | 11 |  |
| G8-E-10 | 3 | 17 | 51 | 69 | 69 | 65 | 62 | 27 | 27 | 27 |  |
| G8-E-12 | 4 | 16 | 48 | 60 | 60 | 59 | 55 | 35 | 35 | 35 |  |
| G8-E-2 | 3 | 17 | 51 | 51 | 0 | 38 | 35 | 35 | 35 | 35 |  |
| G8-E-4 | 12 | 8 | 13 | 13 | 0 | 10 | 8 | 8 | 8 | 8 |  |
| G8-E-6 | 3 | 17 | 51 | 51 | 0 | 36 | 29 | 29 | 29 | 29 |  |
| G8-E-8 | 4 | 16 | 48 | 48 | 0 | 47 | 40 | 40 | 40 | 40 |  |
| G8-E-9 | 11 | 9 | 15 | 15 | 0 | 14 | 13 | 13 | 13 | 13 |  |
| G8-F-2 | 14 | 6 | 18 | 18 | 0 | 12 | 9 | 8 | 8 | 8 |  |
| G8-F-7 | 18 | 2 | 4 | 4 | 0 | 3 | 3 | 2 | 2 | 2 |  |
| G8-F-8 | 5 | 15 | 45 | 45 | 3 | 28 | 27 | 27 | 27 | 27 |  |
| G8-L-11 | 3 | 17 | 51 | 51 | 0 | 51 | 46 | 46 | 46 | 46 |  |
| G8-L-2 | 5 | 15 | 45 | 45 | 0 | 33 | 30 | 30 | 30 | 30 |  |
| G8-L-4 | 3 | 17 | 51 | 51 | 0 | 45 | 40 | 39 | 39 | 39 |  |
| G8-L-5 | 7 | 13 | 39 | 39 | 0 | 32 | 29 | 29 | 29 | 29 |  |
| G8-L-6 | 8 | 12 | 36 | 36 | 0 | 35 | 31 | 31 | 31 | 31 |  |
| G8-L-7 | 7 | 13 | 21 | 40 | 40 | 40 | 40 | 40 | 40 | 40 |  |
| G8-L-8 | 5 | 15 | 45 | 45 | 0 | 26 | 23 | 23 | 23 | 23 |  |
| G8-M-1 | 13 | 7 | 21 | 21 | 0 | 13 | 12 | 12 | 12 | 12 |  |
| G8-M-10 | 11 | 9 | 27 | 27 | 0 | 25 | 20 | 20 | 20 | 20 |  |
| G8-M-2 | 12 | 8 | 24 | 24 | 0 | 19 | 17 | 17 | 17 | 17 |  |
| G8-M-5 | 10 | 10 | 30 | 30 | 0 | 25 | 21 | 21 | 21 | 21 |  |
| G8-M-7 | 16 | 4 | 12 | 12 | 0 | 9 | 7 | 7 | 7 | 7 |  |
| G8-M-8 | 7 | 13 | 39 | 39 | 0 | 35 | 29 | 28 | 28 | 28 |  |
| G8-M-9 | 18 | 2 | 6 | 6 | 0 | 3 | 3 | 3 | 3 | 3 |  |
| G9-E-10 | 6 | 14 | 23 | 28 | 28 | 27 | 27 | 19 | 19 | 19 |  |
| G9-E-2 | 4 | 16 | 48 | 48 | 0 | 25 | 22 | 22 | 22 | 22 |  |
| G9-E-4 | 12 | 8 | 13 | 13 | 0 | 11 | 9 | 9 | 9 | 9 |  |
| G9-E-5 | 14 | 6 | 18 | 18 | 0 | 15 | 14 | 14 | 14 | 14 |  |
| G9-E-6 | 6 | 14 | 42 | 42 | 0 | 39 | 37 | 36 | 36 | 36 |  |
| G9-E-7 | 11 | 9 | 27 | 27 | 0 | 19 | 18 | 18 | 18 | 18 |  |
| G9-E-8 | 5 | 15 | 45 | 45 | 0 | 33 | 28 | 28 | 28 | 28 |  |
| G9-E-9 | 15 | 5 | 15 | 15 | 0 | 7 | 6 | 6 | 6 | 6 |  |
| G9-F-10 | 13 | 7 | 21 | 21 | 0 | 9 | 8 | 8 | 8 | 8 |  |
| G9-F-2 | 14 | 6 | 18 | 18 | 0 | 12 | 10 | 10 | 10 | 10 |  |
| G9-F-8 | 3 | 17 | 51 | 51 | 0 | 48 | 46 | 46 | 46 | 46 |  |
| G9-F-9 | 17 | 3 | 9 | 9 | 0 | 7 | 7 | 7 | 7 | 7 |  |
| G9-L-1 | 6 | 14 | 42 | 42 | 0 | 30 | 28 | 28 | 28 | 28 |  |
| G9-L-3 | 17 | 3 | 5 | 5 | 0 | 4 | 4 | 4 | 4 | 4 |  |
| G9-L-4 | 5 | 15 | 24 | 39 | 39 | 38 | 33 | 15 | 15 | 15 |  |
| G9-L-5 | 10 | 10 | 30 | 30 | 0 | 29 | 22 | 22 | 22 | 22 |  |
| G9-L-7 | 10 | 10 | 30 | 30 | 0 | 20 | 18 | 18 | 18 | 18 |  |
| G9-M-1 | 3 | 17 | 51 | 51 | 0 | 47 | 43 | 43 | 43 | 43 |  |
| G9-M-3 | 17 | 3 | 9 | 9 | 0 | 8 | 8 | 8 | 8 | 8 |  |
| G9-M-4 | 4 | 16 | 48 | 90 | 90 | 89 | 86 | 74 | 74 | 74 |  |
| G9-M-5 | 16 | 4 | 7 | 7 | 0 | 5 | 4 | 4 | 4 | 4 |  |
| G9-M-6 | 14 | 6 | 18 | 18 | 0 | 13 | 12 | 12 | 12 | 12 |  |
| G9-M-9 | 6 | 14 | 42 | 42 | 0 | 35 | 29 | 28 | 28 | 28 |  |
| **total** | | **1434** | **3837** | **3956** | **454** | **3178** | **2862** | **2731** | **2731** | **2731** | **46** |

## 8. Spend ledger — models actually used (no gpt-oss anywhere; tokens authoritative, USD estimated)

| stage | model | calls | tokens in | tokens out | est USD | price basis / ledger |
|---|---|---:|---:|---:|---:|---|
| write (3 runs) | `accounts/fireworks/models/deepseek-v4-flash-0731` | 269 | 487,703 | 2,893,413 | 0.878 | $0.14 / $0.28 per M — `out/write-ledger.json` |
| verify + translate (run 1 + resume) | `accounts/fireworks/models/deepseek-v4-pro-0813` | 558 | 443,904 | 1,452,886 | 2.276 | ingest.py default $1.20 / $1.20 per M (no Pro list price in-repo; re-price from the Fireworks invoice) — `out/ingest-summary*.json` |
| factoid voice (smoke + full + regen1) | `accounts/fireworks/models/qwen3p7-plus` | 345 (0 failed) | 606,615 | 2,059,480 | 1.95 | fw-gen-factoids.py's own estimate — `out/append-state.json` `fireworks` |
| **Fireworks total** | | **1,172** | **1,538,222** | **6,405,779** | **≈ 5.10** | |
| images (gpt-image-2 low 1024, OpenAI Batch) | `gpt-image-2` | 0 batches / 0 requests submitted | | | **0.00** (≈ 8.74 pending: 2,731 × $0.0032) | blocked by `billing_hard_limit_reached`, §6 |

## 9. Phase C — what remains, in order (nothing below has been started)

Preconditions: (1) Luis raises the OpenAI hard limit; (2) the PREP carry-over is committed (still uncommitted here and on `unified`: `packages/mobile/src/generated/curriculumTags.generated.json`, `packages/mobile/scripts/gen-curriculum-tags.mjs`, `packages/mobile/src/data/curriculumTagOverrides.json`, `curriculumTagExclusions.json`, `tools/curriculum-tag-audit/`) — Phase C's `gen-curriculum-tags.mjs` and `card-harness.mts` run against the wrong tags without them.

```bash
cd /Users/luis/Code/hiraia-depth-fill
set -a; . /Users/luis/Code/hiraia/.env.local; set +a

# C0  submit (resumable; writes out/image-batches.json with the batch ids) — then wait for the batches to complete
/opt/homebrew/bin/python3 rag/pipeline/depth-fill/append.py --stages images
# C1  fetch every completed batch → rag/pipeline/imagegen/webp/<ffct>.webp (declined ids → out/image-declined.jsonl +
#     out/image-fallback-worklist.jsonl for the qwen-image fallback: WORKLIST=<that file> LIMIT=0 python3 packages/images/qwen-queue/gen-images.py)
/opt/homebrew/bin/python3 rag/pipeline/depth-fill/append.py --stages fetch
# C2  wire (BRIEF §8.1–8.4): copy rag/pipeline/imagegen/webp/ffct-371*..ffct-398*.webp → packages/images/factoid-webp/;
#     to-card-png.mjs / gen-image-map.mjs as the card-ui path does; APPEND the illustrated factoids onto rag/pipeline/cardsPool.app.json
#     (never gen-cards-pool.py; pre-existing card ids byte-identical); node packages/mobile/scripts/gen-curriculum-tags.mjs
# C3  titles + cats (BRIEF §8.5, required): FW_MISSING=1 python3 rag/pipeline/fw-gen-card-titles.py → python3 rag/pipeline/assemble-card-titles.py
#     validate: every new card has non-empty title.tl/en/bis, 1–2 ladder cats, ≤32-char Title Case, title != topic
# C4  python3 rag/pipeline/build-cards-db.py   (cards.db + tokens.bin + cardsIndex.generated.json; re-runs build-facts-db.py)
#     then packages/mobile/scripts/card-harness.mts green; curriculumOutline counts show the deepened codes
# C5  recount every in-scope code ≥ 20 (report-per-code.py + curriculumTags.generated.json); decide on a targeted second write
#     for the 14 short codes (+ the 7 sitting exactly at need if images declined there)
# C6  bash finetuning/eval/harness/run-harness.sh  → must be green. Do not build an APK.
```

### 6.1 Images SUBMITTED (2026-09-07 23:21:48–23:22:26)

Luis added credit to the OpenAI organisation; `append.py --stages images` re-ran and submitted all **24 batches
(23 main ≈ 119 each + 1 body of 2) = 2,731 requests, est. $8.74** (gpt-image-2 low 1024, 24 h window) —
ledger `out/image-batches.json` (batch ids, input file ids, ids per batch). Batch ids: batch_6a9ed68f3d3081908be5aff32ff73ef5, batch_6a9ed6919a8c8190abf23e961a569173, batch_6a9ed692f53c819095619ac161b9c307, batch_6a9ed694108c8190bff8e220c35c3559, batch_6a9ed695a4548190ae96ca8ea1d3e159, batch_6a9ed696fb108190b888e709403788ad, batch_6a9ed697fbd48190b408bcf6ce5d75cd, batch_6a9ed69946d481908ceb1f30043c0dd3, batch_6a9ed69a733c8190aa75a490dad3fb3d, batch_6a9ed69b87a481909137676c773b0f02, batch_6a9ed69d44788190a9c08ebe9d98acb1, batch_6a9ed69e8d008190a8c3db2a0443c725, batch_6a9ed69fecf48190bfb8bc0ed4148a60, batch_6a9ed6a116ec8190b9d20e1d8eab3635, batch_6a9ed6a281dc8190a20da77d4678fc3b, batch_6a9ed6a387cc8190ad01843b195cf01d, batch_6a9ed6a4b0d4819082f9e85aae083052, batch_6a9ed6a5d0dc8190b8393a7fc74e53e1, batch_6a9ed6a743f08190a723c623057827b6, batch_6a9ed6a86bcc8190934ae9612d9bcb02, batch_6a9ed6a9c7c88190bdd8ec9dde2980ba, batch_6a9ed6ab058c8190921b95988cfb0e36, batch_6a9ed6ac4e5c81908973c57fdc898a55, batch_6a9ed6ad37108190a003bd3ae01b6d55.
A placeholder batch created by a diagnostic probe with a nonexistent input file (batch_6a9ed669306881908f0c6b6c2a7da7e0)
was cancelled; it is not in the ledger. `batch-submit-all.py _req` now prints OpenAI's error body on non-retryable HTTP errors.

Phase C starts when every batch reaches `completed`: `append.py --stages fetch` (repeat until all downloaded) → wire webp
into the pool (never gen-cards-pool.py) → gen-curriculum-tags → titles/cats (§8.5) → build-cards-db (§8.6) → card-harness →
run-harness.sh → recount ≥ 20 per code → merge depth-fill-facts into unified.
