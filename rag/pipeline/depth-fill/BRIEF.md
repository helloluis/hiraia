# Depth-fill — bring every honest MATATAG topic to ~20 illustrated trilingual cards

Handoff for another agent. Read this whole file before touching the bank.

**What this is.** Hiraia is an offline science tutor for Filipino grade-school kids (DepEd MATATAG, Grades 3–10). The home screen is a feed of one-fact cards. A curriculum-tag audit + integrator pass just made the tags honest; a recovery pass then tagged existing DepEd-module cards onto the 35 topics that had fallen below 3 cards (the app hides those). **Every catalogue topic now has ≥3 cards.** Median is 25. **143 of 324 topics still have fewer than 20.** This job writes **new** facts to take the honest ones to about 20, in English + Tagalog + Bisaya, illustrated, born-tagged to the competency.

You are doing the full path: write candidates → dedup → verify → translate → mint → factoid voice → illustrate → wire into the pool. Lane A/B already proved this path. Copy their scripts; do not invent a second pipeline.

Snapshot of live counts (worktree `/Users/luis/Code/hiraia-unified`, 2026-09-07, after recovery): **131 topics in scope, 1,434 cards to land, ~3,837 English candidates to write** (oversample). Recompute before writing — see §4.

---

## 0. Merge-safety (the ones that corrupt ids)

1. **Work from `/Users/luis/Code/hiraia-unified` (branch `unified`), or a worktree off it.** Do **not** work in `/Users/luis/Code/hiraia` (`question-cards`) — that tree does not have the audit overrides, exclusions, or recovered tags. Do not rebase/merge other branches onto this work.
2. **Create a worktree for the write+ingest if anything else is live on `unified`:**
   `git worktree add ../hiraia-depth-fill -b depth-fill-facts unified`
3. **Append-only on the bank.** Never rewrite `rag/bank/science-facts.jsonl`, `rag/bank/factoids.jsonl`, or `rag/bank/curriculum-tags.json` wholesale. Lane A's `append-lane-a.py` is the pattern: backup first, append new rows, refuse if any new id already exists, leave every pre-existing factoid byte-identical.
4. **Never run `gen-cards-pool.py`.** It remints ordinal card ids. Images, tags, and the on-device seen-store are keyed by those ids. Wiring new illustrated factoids is copy-into-pool, not a pool rebuild. See §8.
5. **Do not mint final ids by hand.** Candidates use `depth-<CODE>-<nnn>` (e.g. `depth-G9-M-4-001`). Ingest mints `kebab-slug-gN` fact ids; `assemble-factoids.py --check` mints the next free `ffct-NNNNN`.
6. **Do not reverse the audit.** Do not delete `packages/mobile/src/data/curriculumTagOverrides.json` or `curriculumTagExclusions.json`. Do not re-include excluded factIds except the ones `tools/curriculum-tag-audit/recover_thin.py` already lifted. Hand exclusion `sleep-tiredness-builds-while-awake-g5` stays excluded.
7. **Do not APK, deploy, or run `run-harness.sh` as a substitute for finishing ingest.** Gate is the last append stage, after images are wired. Luis will ask for APK separately. Gate must be green before anyone builds an APK (`Claude.md`).
8. **`FIREWORKS_API_KEY` and `OPENAI_API_KEY` live in `.env.local` (gitignored).** Never commit them. `set -a; . ./.env.local; set +a`. Homebrew Python: `/opt/homebrew/bin/python3`. LaBSE dedup uses `finetuning/.convert-venv/bin/python`.
9. If a step seems to require breaking 1–8, stop and write the question into `rag/pipeline/depth-fill/out/REPORT.md`.

---

## 1. What is already done (do not redo)

| Step | Where | Result |
|---|---|---|
| MATATAG first-pass tag audit | `tools/curriculum-tag-audit/` (Flash + Grok) | keep / correct / exclude per fact |
| Integrator | `tools/curriculum-tag-audit/integrate.py --apply` | overrides + exclusions; runtime tags 44,503 → ~22k honest MATATAG |
| Thin-topic recovery | `tools/curriculum-tag-audit/recover_thin.py --apply` then `node packages/mobile/scripts/gen-curriculum-tags.mjs` | 133 existing pool cards tagged onto the 35 n&lt;3 topics; **0 catalogue topics now n&lt;3** |
| Lane A | ingested 2026-08-27 | 723 trilingual illustrated facts already in the bank |
| Lane B candidates | `/Users/luis/Code/hiraia-lane-b/rag/pipeline/lane-b/out/` | **461 English-only** candidates for 16 JHS codes — **not ingested**. Reuse them (see §6). |

The recovery tagged cards that already existed. This job **writes new facts**. Do not spend the run re-tagging the pool.

---

## 2. Scope

**Floor = 20 illustrated pool cards per MATATAG code**, counted from `packages/mobile/src/generated/curriculumTags.generated.json` after recovery (every code in `codes[]`).

**In scope:** every MATATAG competency with `have < 20` and `fact_able ≥ 2` in `rag/bank/competency-kinds.json`. That is content, mixed, and method (`did-you-know about a method`) cells. 131 codes, ~1,434 to land.

**Out of scope — do not pad to 20:** `fact_able ≤ 1` (pure activity / survey / “go do it”). They are visible at n=3–12; twenty paraphrases of “conduct a survey” are fake depth.

Skip these 12:

| code | have | form | competency |
|---|---:|---|---|
| `G3-M-2` | 3 | activity prompt | participate in guided science activities by asking questions and tinkering |
| `G3-L-1` | 6 | activity prompt | observing, predicting, measuring in guided activities |
| `G3-F-3` | 5 | activity prompt | measure/describe position change (closer, farther, left, right) |
| `G4-M-7` | 3 | activity prompt | guided survey about environmental issues |
| `G4-F-2` | 4 | method | measure distance and time with simple equipment |
| `G4-F-4` | 3 | method | construct and label simple graphs of speeds |
| `G5-M-5` | 12 | method | measure volume with cylinders/beakers |
| `G6-M-8` | 7 | method | apply fair-test features |
| `G6-L-3` | 3 | activity prompt | plan a fair test of cutting/budding/layering/grafting |
| `G7-M-7` | 3 | method | accurate measurements + organise data |
| `G8-F-3` | 3 | method | construct distance-time and velocity-time graphs |
| `G9-L-11` | 5 | activity prompt | plan a survey to minimise human impacts on an ecosystem |

**How to write the in-scope process/mixed cells (`fact_able` 2–3):** not “go do the activity.” Write **method facts** — how scientists or a class actually do the thing. Example for `G5-F-2` (friction vs surfaces): “A fair test of friction keeps the same toy car and the same ramp, and only changes the surface under the wheels.” Example for `G10-L-9` (biotech debate): GMO / Golden Rice / environmental-biotech facts that are the *content* of the debate, not “hold a debate.”

**`competency-kinds.json` on diagrams:** “use a labelled diagram / flow chart / model” is **presentation**. The science content is card-able; the engraving is the diagram. Write the content (digestive path, double helix, habitat classes, C/O/H₂O cycle steps, cells→biosphere). Do not refuse these LCs as “format-required empty.”

---

## 3. Models — do not use GPT-OSS

Lane A verified and translated with `accounts/fireworks/models/gpt-oss-120b`. **Do not use that model for anything in this run.** Luis wants a better judge and a better translator.

| Role | Model | Why |
|---|---|---|
| **Writer** | `accounts/fireworks/models/deepseek-v4-flash-0731` | Volume. Same model as the tag audit. Fast, cheap, good enough for 15–35 word encyclopedia facts if a stronger model verifies. |
| **Judge** | `accounts/fireworks/models/deepseek-v4-pro-0813` | Stronger than gpt-oss. Already used in-repo for language polish, module profiling, editorial (`fw-polish-language.py`, `fw-profile-modules.py`). Drops `wrong` / `suspect`. |
| **Translator** | `accounts/fireworks/models/deepseek-v4-pro-0813` | Same: Filipino kid-register is the Pro job, not oss. Must emit `tl`, `bis`, and mixed `terms`. |
| Factoid voice (feed rewrite) | keep `fw-gen-factoids.py` default `qwen3p7-plus` | Different stage; not the science judge. Do not switch this to oss either. |
| Images | OpenAI `gpt-image-2` low 1024, engraving style | Exact body from `packages/images/qwen-queue/batch-submit-all.py`. ~$0.0032/image. |

**Decorrelation.** Writer is Flash, judge is Pro — both DeepSeek, different sizes. Pass ingest `--writer deepseek-v4-flash` (not `--writer deepseek`) so Lane A's naive family check (`fam in verify_model`) does not refuse Pro. If that check still fires, `--allow-same-family` is acceptable here because Flash≠Pro and the point of the rule was “don’t let gpt-oss grade gpt-oss.”

**Do not** set `FW_MODEL=...gpt-oss-120b`. **Do not** leave `LANE_A_VERIFY_MODEL` / `FW_TRANSLATE_MODEL` at their gpt-oss defaults. Override both:

```bash
export LANE_A_VERIFY_MODEL=accounts/fireworks/models/deepseek-v4-pro-0813
export FW_TRANSLATE_MODEL=accounts/fireworks/models/deepseek-v4-pro-0813
export FW_MODEL=accounts/fireworks/models/deepseek-v4-flash-0731   # writer only
```

Verify prompt stays the one in `rag/pipeline/fw-verify-facts.py` / ingest `VERIFY_HEAD` (correct + grade-appropriate, verdict `ok|suspect|wrong`). Translate prompt stays ingest `TRANSLATE_HEAD` (kid Tagalog + Cebuano, English science terms Filipinos actually use, trilingual `terms`). Keep `verdict == ok` only; emit refuses empty `tl`/`bis`.

If Pro rate-limits, lower concurrency; do not fall back to gpt-oss.

---

## 4. Build live briefs before writing

Counts must come from **runtime tags after recovery**, not `rag/bank/competency-gaps.json` (that file is pre-audit).

```bash
cd /Users/luis/Code/hiraia-unified   # or the depth-fill worktree
/opt/homebrew/bin/python3 rag/pipeline/depth-fill/build-briefs.py
# writes rag/pipeline/depth-fill/briefs.json
```

If `build-briefs.py` is missing, write it. Spec:

- Read `packages/mobile/src/generated/curriculumTags.generated.json` + `rag/pipeline/cardsPool.app.json` + both `matatag-*-competencies.json` + `rag/bank/competency-kinds.json`.
- `have` = pool cards whose runtime `codes[]` contain the competency (ignore `deped:`).
- Include a code iff `have < 20` and `fact_able >= 2`.
- `need = 20 - have`. `target = ceil(need * (1.6 if fact_able >= 5 else 3.0))`.
- `existing_facts_en` = English body of every pool card already carrying that code (cap 80). **Do not restate any of them.** Dedup at cosine 0.86 vs the whole bank will drop paraphrases anyway.
- `card_form` from kinds: treat `activity prompt` on an in-scope (`fact_able>=2`) code as `method`. `quiz` still writes facts (drill-shaped is fine).
- Snapshot 2026-09-07: 131 briefs, need 1,434, target ~3,837. If your live totals differ by more than ~10%, stop and record why in `out/REPORT.md`.

Oversample is historical (Lane A/B: ~34% novel vs the whole bank, ~77% of those verify). Thin topics should survive better; still write `target`, not `need`.

---

## 5. What a good fact is

Same bar as `rag/pipeline/GENERATION-BRIEF.md` and Lane A §3:

- **One idea, one English sentence, 15–35 words.** Grade-appropriate (aim a year younger than the label). Concrete, Philippine-flavoured where natural (PAGASA, PHIVOLCS, Mayon, palay, bakawan) but facts about the world, not only the Philippines.
- **Consensus science only.** No invented numbers, names, dates, or mechanisms. Rounded published values with “about.” If unsure, omit.
- **Serves that competency**, not merely its nouns. `G9-M-4` is oxygen’s **six** valence electrons **from its group on the periodic table**, not “oxygen is element 8.” `G8-L-7` is *why* Mammalia and *why* Primates, not a full taxonomy dump.
- **Trilingual at emit, not at write.** Candidates may leave `tl`/`bis` empty. Ingest’s Pro translator fills them. Do not ship English-only.
- **Terms at emit:** ≥6 distinct, mix of TL/BIS/EN content words a kid would type, inflections (`gumagalaw`/`naglihok`). Translator prompt already asks for 10–16.
- **Safe.** No frightening framing, no dangerous experiments, no medical advice. Human reproduction / genitalia → body stream only (§7).

Three register examples (yours omit final `id`, add `brief_code` / `tmp_id`):

```json
{"tmp_id":"depth-G9-M-4-001","brief_code":"G9-M-4","domain":"MATTER","topic":"oxygen valence electrons","grades":[9],"en":"Oxygen sits in group 16 of the periodic table, so an oxygen atom has six valence electrons in its outer shell.","tl":"","bis":"","terms":["oxygen","valence","group 16","periodic table","electron","okihieno","elektron"],"source":"periodic table group number = valence electrons for main-group elements","card_form":"fact","confidence":3}
```

---

## 6. Reuse Lane B first

`/Users/luis/Code/hiraia-lane-b/rag/pipeline/lane-b/out/lane-b-candidates.jsonl` (454) and `lane-b-body.jsonl` (7, `G10-L-8` only — that code is already at 20, **skip the body file**).

Lane B codes still below 20 (live n as of 2026-09-07): `G7-E-1` 7, `G8-L-7` 7, `G8-E-1` 12, `G8-E-10` 3, `G8-E-12` 4, `G8-F-8` 5, `G9-E-10` 6, `G9-L-4` 5, `G9-M-4` 4, `G10-E-1` 4, `G10-E-4` 3, `G10-F-3` 5, `G10-F-6` 15, `G10-F-7` 12, `G10-M-5` 4. `G10-L-8` is done.

Copy those English rows into `rag/pipeline/depth-fill/out/depth-candidates.jsonl`, rewrite `tmp_id` to `depth-<CODE>-<nnn>`, keep `brief_code`. They still go through **Pro verify + Pro translate** (they were never judged by Pro, and `tl`/`bis` are empty). Then Flash-write only the remaining `target − surviving_lane_b` per code.

---

## 7. Outputs (candidates)

All new files under `rag/pipeline/depth-fill/` (scripts + `out/`). Nothing else until ingest.

| file | what |
|---|---|
| `out/depth-candidates.jsonl` | main stream, one JSON object per line |
| `out/depth-body.jsonl` | **only** human-reproduction / genitalia / G5-L-3-class content. Same schema. Do not print this file’s sentences in logs or `REPORT.md` (ids + counts only). Digestive path, DNA helix, classification, biotech-as-GMO-crops can stay in main. |
| `out/REPORT.md` | candidates vs target per code; anything you could not write and why; model ids actually used |

Candidate fields (same as Lane A): `tmp_id`, `brief_code`, `domain` (`MATTER` \| `LIVING_THINGS` \| `FORCE_MOTION_ENERGY` \| `EARTH_SPACE`), `topic`, `grades`, `en`, `tl`, `bis`, `terms` (≥6), `source`, `card_form` (`fact` \| `method`), `confidence` (3 or 2; never write 1).

Write **exactly `target` candidates per code**. Do not pad other codes. Do not restated `existing_facts_en`.

---

## 8. Ingest + ship (after candidates exist)

Copy `rag/pipeline/lane-a/ingest-lane-a.py` and `append-lane-a.py` into `rag/pipeline/depth-fill/`, then retarget:

- `HERE` / `BRIEFS` → `depth-fill/briefs.json`
- `STREAMS` → `('main', 'depth-candidates.jsonl'), ('body', 'depth-body.jsonl')`
- `AUP_STREAMS` / `AUP` → `{'body'}`
- Default `--verify-model` and `--translate-model` → **DeepSeek v4 Pro** (not gpt-oss)
- `TAG = 'depth-fill'` so `fw-gen-factoids.py` writes `rag/pipeline/factoids-gen-depth-fill/`
- assemble-factoids pair: `rag/pipeline/factoids-gen-depth-fill:rag/pipeline/factoids-depth-fill-src.jsonl`
- `generator` field on bank rows: `depth-fill`

Do **not** run the copies against Lane A’s `out/` — that would skip or collide with the 723 already banked.

Sequence (mirrors Lane A; every stage resumable):

```bash
set -a; . ./.env.local; set +a
export LANE_A_VERIFY_MODEL=accounts/fireworks/models/deepseek-v4-pro-0813
export FW_TRANSLATE_MODEL=accounts/fireworks/models/deepseek-v4-pro-0813

# 1–3 validate / LaBSE dedup 0.86 vs bank+factoids+dcards / mint
finetuning/.convert-venv/bin/python rag/pipeline/depth-fill/ingest.py --writer deepseek-v4-flash --dry-run

# 4–6 Pro verify, Pro translate, emit (raise conc if Pro allows; never gpt-oss)
finetuning/.convert-venv/bin/python rag/pipeline/depth-fill/ingest.py \
  --writer deepseek-v4-flash --stages verify,translate,emit --conc 8 --batch 12

# append-only bank → factoid src → qwen voice → assemble-factoids --check \
# → tags fragment re-keyed to new ffct ids → vectors + export-facts-ts
python3 rag/pipeline/depth-fill/append.py --stages bank,src,gen,assemble,tags,vectors

# images: SUBMIT only, then FETCH when batches complete (~1.5 h for ~700 historically)
python3 rag/pipeline/depth-fill/append.py --stages images
python3 rag/pipeline/depth-fill/append.py --stages fetch
```

**Wire into the pool (only after webp exist).** Do not run `gen-cards-pool.py`. Pattern from Lane A comments and `FACT-SWARM-SPEC.md` 0c:

1. Copy `rag/pipeline/imagegen/webp/<ffct>.webp` → `packages/images/factoid-webp/`
2. `to-card-png.mjs` / `gen-image-map.mjs` as the card-ui path already does
3. **Append** the new illustrated factoid cards onto `rag/pipeline/cardsPool.app.json` (and the merged pool if that is still the source of truth in this tree). Pre-existing card ids must remain byte-identical.
4. `node packages/mobile/scripts/gen-curriculum-tags.mjs` — new rows should carry `brief_code` as a v2 tag (`confidence` 1.0, `codes: [brief_code]`). Overrides/exclusions stay in place.
5. **Titles + categories for the NEW cards (required — added 2026-09-07).** Lane A's cards have `title` and `cats` only because the later title/taxonomy sweeps covered the whole pool; a card appended here has neither, so its index band prints the raw `topic` (the mid-word truncation the titles job fixed) and the Calendar's sub-topic pills cannot place it ("Other" is forbidden). Run the existing title job in gap-fill mode over the new ids — `FW_MISSING=1 python3 rag/pipeline/fw-gen-card-titles.py` emits `title_{en,tl,bis}` AND `cats` (108-leaf ladder, `rag/pipeline/card-taxonomy.json`) per card — then `python3 rag/pipeline/assemble-card-titles.py` (idempotent). Validate: every new pool card has non-empty `title.tl/en/bis` and 1–2 ladder `cats`; ≤32-char Title Case titles, none equal to `topic`.
6. **Rebuild the shipped database:** `python3 rag/pipeline/build-cards-db.py` (cards.db + tokens.bin + `cardsIndex.generated.json`, which is what the app reads — the pool JSON alone ships nothing). Then `packages/mobile/scripts/card-harness.mts` must stay green (magnet + curriculum walks), and `curriculumOutline` topic counts should show the deepened codes.
7. Optional, not blocking: the editorial passes (`fw-editorial-pass.py`, `fw-fix-echo-answers.py`) that set `emphasis`/`poster`; a card without them renders plain (no lifted term). Quiz lane later; not required to unhide/deepen the topic.

**Gate last:** `bash finetuning/eval/harness/run-harness.sh` → must be green. Do not build an APK.

Expect wall clock **~6–10 hours** for the full 131 (images dominate; OpenAI batch SLA is 24 h if queued). Fireworks a few dollars; images ~$0.0032 × landed count (~$5 if ~1,400 land). Write+verify+translate is the same afternoon if Pro conc holds.

---

## 9. Acceptance

- Every in-scope code has **≥20** runtime-tagged pool cards, or `out/REPORT.md` names the code, how many landed, and why it missed (dedup, verify drops, image declines).
- Every shipped fact has non-empty `fact.tl`, `fact.en`, `fact.bis` and trilingual `terms`.
- Every NEW pool card has a trilingual `title` and 1–2 ladder `cats` (§8.5); `build-cards-db.py` has run (§8.6) and `card-harness.mts` is green.
- No gpt-oss in `ingest-summary.json` / ledgers / `append-state.json`.
- Pre-existing `ffct-*` / `dcard-*` ids unchanged. `assemble-factoids.py --check` prefix-identical to the backup.
- Audit overrides/exclusions intact aside from new born-tags on *new* factIds.
- `run-harness.sh` green.
- `out/REPORT.md` lists models, candidates vs landed per code, Fireworks + image spend, anything skipped.

---

## 10. Inputs (read-only except §8 outputs)

| path | use |
|---|---|
| `rag/sources/curriculum-guides/matatag-elementary-competencies.json` | LC text, grade, quarter, domain |
| `rag/sources/curriculum-guides/matatag-jhs-competencies.json` | same, G7–10 |
| `rag/sources/curriculum-guides/competency-content-map.json` | quarter content title per code |
| `rag/sources/curriculum-guides/FINAL-MATATAG-Science-CG-2023-Grades-3-10.pdf` | surrounding CG context |
| `rag/bank/competency-kinds.json` | kind / fact_able / card_form |
| `packages/mobile/src/generated/curriculumTags.generated.json` | live `have` |
| `rag/pipeline/cardsPool.app.json` | card text for `existing_facts_en` |
| `rag/pipeline/GENERATION-BRIEF.md` | authoring rules |
| `rag/pipeline/lane-a/ingest-lane-a.py` + `append-lane-a.py` | copy and retarget |
| `rag/pipeline/FACT-SWARM-SPEC.md` | append-only, illustrate, gate |
| `tools/curriculum-tag-audit/recover_thin.py` | what was already recovered (do not duplicate) |
| `/Users/luis/Code/hiraia-lane-b/rag/pipeline/lane-b/out/*.jsonl` | English candidates to reuse |

---

## 11. Snapshot target list (recompute; this is 2026-09-07)

`have` = runtime cards. `need` = 20 − have. `write` = oversampled target.

Too long to paste twice: **generate `briefs.json` and print the table from it.** The 131 codes in scope on this snapshot:

`G3-E-1 G3-E-4 G3-E-7 G3-L-2 G3-M-4 G4-E-1 G4-E-3 G4-E-8 G4-F-1 G4-L-3 G4-L-4 G4-L-5 G4-L-7 G5-E-12 G5-E-2 G5-E-3 G5-E-7 G5-F-1 G5-F-10 G5-F-2 G5-F-8 G5-F-9 G5-L-4 G5-L-6 G5-M-9 G6-E-2 G6-E-3 G6-F-3 G6-F-8 G7-E-1 G7-E-10 G7-E-11 G7-E-2 G7-E-4 G7-E-5 G7-E-6 G7-E-8 G7-F-11 G7-F-3 G7-F-5 G7-F-6 G7-F-7 G7-F-8 G7-L-10 G7-L-2 G7-L-4 G7-L-6 G7-L-8 G7-L-9 G7-M-1 G7-M-12 G7-M-4 G7-M-6 G8-E-1 G8-E-10 G8-E-12 G8-E-2 G8-E-3 G8-E-4 G8-E-5 G8-E-6 G8-E-8 G8-E-9 G8-F-2 G8-F-7 G8-F-8 G8-L-1 G8-L-10 G8-L-11 G8-L-2 G8-L-4 G8-L-5 G8-L-6 G8-L-7 G8-L-8 G8-M-1 G8-M-10 G8-M-2 G8-M-3 G8-M-5 G8-M-7 G8-M-8 G8-M-9 G9-E-1 G9-E-10 G9-E-2 G9-E-3 G9-E-4 G9-E-5 G9-E-6 G9-E-7 G9-E-8 G9-E-9 G9-F-10 G9-F-2 G9-F-8 G9-F-9 G9-L-1 G9-L-3 G9-L-4 G9-L-5 G9-L-7 G9-L-9 G9-M-1 G9-M-3 G9-M-4 G9-M-5 G9-M-6 G9-M-7 G9-M-9 G10-E-1 G10-E-12 G10-E-3 G10-E-4 G10-E-6 G10-E-7 G10-F-1 G10-F-11 G10-F-2 G10-F-3 G10-F-5 G10-F-6 G10-F-7 G10-F-8 G10-F-9 G10-L-10 G10-L-11 G10-L-9 G10-M-3 G10-M-5 G10-M-7`

Full LC text is in the two `matatag-*-competencies.json` files. Kinds/form in `competency-kinds.json`.

---

## 12. Suggested order of work

1. Confirm you are on `unified` (or a worktree of it) and that `curriculumTags.generated.json` has 0 topics with n&lt;3.
2. Write `build-briefs.py` → `briefs.json`. Paste totals into `out/REPORT.md`.
3. Ingest-prep: copy Lane A ingest/append, retarget, **Pro defaults**, no gpt-oss.
4. Import Lane B English rows for the 15 JHS codes still below 20.
5. Flash-write the remaining targets into `out/depth-candidates.jsonl` (body stream if needed).
6. Dry-run ingest (validate+dedup+mint). Then Pro verify + Pro translate + emit.
7. `append.py` bank → src → gen → assemble → tags → vectors.
8. Image submit → fetch → wire webp into pool → `gen-curriculum-tags.mjs`.
9. Titles + cats for the new cards (`FW_MISSING=1 fw-gen-card-titles.py` → `assemble-card-titles.py`), then `build-cards-db.py`, then `card-harness.mts` green.
10. Recount: every in-scope code ≥20, or explain.
11. `run-harness.sh`. Stop. Do not APK.
