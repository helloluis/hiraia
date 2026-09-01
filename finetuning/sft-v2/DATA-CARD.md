# SFT v2 data card — `out/train-v2.jsonl`

**5,893 rows** for SFT v2 of `Cryptopop/hiraia-cpt-flagship-2b` (replacing SFT v1's 6,687-row
chat mix). Every row is a CARD row: `user` = the **imported** runtime `buildCardPrompt`
(packages/shared/src/prompts/cards.ts — byte-identity asserted by `validate.mts` on every
row), `assistant` = one line, ≤30 words (bulk ≤28), no greeting/question/hedge/emoji/
markdown/`[image:]`. Messages normalised to exactly `{role, content}`. **Validation gate:
GREEN, 0 hard violations** (`out/validation.json`).

## Mix as built

| bucket | rows | tl | ceb | en | judge acceptance | target failure classes |
|---|---|---|---|---|---|---|
| card-core (reshaped v1) | 4,605 | 2,604 | 1,999 | 2 | 4,633/5,391 (85.9%) | register ≤30w natively, no `[image:]`, no engagement/hedge, grounded faithfulness |
| ceb-quality | 265 | — | 265 | — | 277/300 (92.3%) | ceb-photosynthesis, ceb-heart, ceb-volcano |
| thin-escape | 231 | 106 | 88 | 37 | 232/241 (96.3%) | thin-nba-finals (+ceb) — all targets are the top retrieved FACT **verbatim** |
| abstain-name (161 abstain / 70 name) | 231 | 111 | 80 | 40 | 257/287 (89.5%) | abstain-biggest-star, without re-breaking over-abstention |
| safety-myth (2×2 grid) | 217 | 105 | 72 | 40 | 218/224 (97.3% at reasoning MEDIUM) | tier2-safety-smoking, tier2-affirm-flat-earth |
| compress (108 multifact / 86 taxonomy) | 194 | 99 | 63 | 32 | 197/220 (89.5%) | grounded-jupiter-moons, shark-grounded |
| en-topup | 150 | — | — | 150 | 167/180 (92.8%) | English cue adherence / purity |
| **TOTAL** | **5,893** | **3,025 (51%)** | **2,567 (44%)** | **301 (5%)** | 5,981/6,843 (87.4%) | |

- **Judging:** 100% of rows (reshaped included — their cards are qwen3p7-plus distillations)
  by the decorrelated `gpt-oss-120b` — safety-myth at `reasoning_effort` **medium** (the low
  pass had accepted a smoking card claiming an outright legal ban where the FACTS state only
  a sale-to-minors ban; medium also caught the Tagalog cue words the old directives planted
  into Cebuano cards). Reject reasons, final pass: grounded_ok 763, factual_ok 392,
  language_ok 57, policy_ok 32, register_ok 17, grade_ok 1 (all logged in
  `out/rejects-judge.jsonl` with per-row reasons).
- **Grades** (sampled into the prompt's literal `Grade N` slot; source row's own grade
  kept where v1 had one): G3 504 / G4 749 / G5 1,079 / G6 1,072 / G7 945 / G8 685 / G9 524 /
  G10 335.
- **Length** (assistant words): median 19 — the deck's own register — p90 24, p99 28,
  max 30, **0 rows over 30**, 25 rows at 29-30 (all escape rows restating a whole fact).
- **Safety polarity, counted both ways AND per language:** affirm-cells 111 (harmful-yes 56 +
  true-yes 55) vs deny-cells 106 (myth-no 55 + safe-no 51); per language tl 55/50,
  **ceb 36/36**, en 20/20 (pre-fix skew: ceb 19 affirm vs 32 deny — the language-conditional
  version of the collapse the 2×2 grid exists to kill, invisible to the aggregate counter).
  Enforced by per-(cell, language) collection caps (tl 28 / ceb 18 / en 10 per cell) + a
  top-up generation pass. Abstain bucket likewise two-sided: 161 abstain-shape vs 70
  name-when-grounded.
- **No identical target over-weighting:** identical (lang, card) capped at 3 (`CARD_TEXT_CAP`;
  pre-cap one Cebuano Mercury sentence appeared ×10 — ~30 effective epochs on one sentence).
- **Token length:** rendered prompt+answer ≈ median 355 / max ~630 tokens — nothing
  approaches the driver's 2,048 `max_length` (v1 lost 186 rows to truncation-delete; v2
  should lose 0).

## Deltas vs v1 (measured on the actual v1 files)

| property | v1 (6,687 rows) | v2 (5,893 rows) |
|---|---|---|
| training surface | 95% persona system prompt + chat turn — a surface that no longer exists | `buildCardPrompt` user turn, byte-identical to the runtime, no system message |
| assistant register | median 188 words, Socratic, 69% end with an engagement question | median 19 words, one line, 0 questions (validation-hard) |
| `[image:]` emission rows | 1,140 (17%) — the sanitizer-residue source | 0 (validation-hard) |
| "answer carefully from general knowledge / say so if unsure" | in 1,466 fact blocks — the trained source of the parametric leak + 64% hedge rate | 0 (merge hard-fails on the strings) |
| grounding | 1,466 rows an old VF block, ~5,100 rows NO facts at all (pure parametric Q→A) | every row carries a FACT block; 3,858 core rows re-grounded by the real runtime retriever (878 kept their VF-block facts) |
| safety/myth polarity | 29:0 deny-openers (cw-myth), ~4 smoking rows total | 2×2 grid, 111 affirm vs 106 deny balanced PER LANGUAGE (ceb 36/36), 56 harmful-affirm rows incl. 17 smoking-cell rows (9 tl / 5 ceb / 3 en) across languages |
| escape behaviour | "say so if you are unsure" hedge | 231 verbatim nearest-fact escapes + 161 state-only-what-facts-support abstains |
| ceb / en share | 39% / 5% | 44% / 5% (en beats v1 in absolute *card* rows; see deviations) |
| judged before admission | no | 100%, decorrelated family, rejects logged |

## Provenance / drops (all logged in `out/rejects-*.jsonl`)

From v1's 6,563 core rows: 290 multi-turn, 246 duplicate queries, 146 lint rejects (now
incl. meta-talk-about-FACTS and persona/hedge-teaching cards), 140 no grounded outcome on
the real retriever, 123 refusal/redirect, 65 chitchat/persona queries (incl. vocative
greetings "hi hiraia" and "sino ka po?" the old $-anchored greeting regex missed),
**53 eval-contamination** (35 exact + 18 fuzzy content-token twins at Jaccard ≥ 0.6 — e.g.
"ano po ginagawa ng puso?" vs gate:homonym-puso, "Ano po ang water cycle?" vs
gate:en-water-cycle), 42 query-too-long, 35 fact-set near-dups, 23 dup-card (identical
(lang, card) past the ×3 cap), 9 VF-parse failures → 5,391 distilled, 4,633
judge-accepted, 4,605 after merge dedup + backstops. Counterweight files: myth/abstain/no-confab intent
folded into the safety/abstain buckets (generated fresh, polarity fixed); imgtag/brevity/
gibberish/exemplar dropped outright (their purpose — image tags, chat brevity, gibberish
replies — has no card surface; gibberish/chitchat routes model-free via `isOffDomain`).

## Review findings applied (2026-09-01 rebuild — all 8 accepted, 0 rejected)

The first build was re-audited; every finding was verified against the data before the fix
(counts below are the measured pre-fix state):

1. **Sirius abstain rows (high).** 3 abstain rows trained star-superlative queries to answer
   "Ang Sirius ang pinakamaliwanag…" — `Sirius` is a literal `mustNotContain` on
   gate:abstain-biggest-star, so the bucket was training its own gate case red. Fix:
   `abstainDenyRes()` (the gate's abstain mustNotContain entities) is now a lint deny-list
   inside the abstain writer's retry loop + a collection re-check + a validate hard rule; the
   directive tells the writer not to restate a WRONG-superlative record-holder. Final file: 0
   deny-entity hits.
2. **Meta-talk about the FACT block (high).** 82 accepted cards said "FACTS"/"the facts do
   not…"/"walang/walay fact/impormasyon" — incl. 4 pure deflections with zero content.
   `META_FACT_RES` is a hard lint (NOT a bare `/facts?/i`: 19 bank facts legitimately carry
   "In fact,"/"Nutrition Facts"), busted entries were REGENERATED (not dropped) via
   `bust-cache.mts`, and merge + validate backstop it. Final file: 0.
3. **Fuzzy eval contamination (medium).** Exact-key contamination let ~21 near-verbatim
   twins of gate/arbitration queries through (homonym-puso, en-water-cycle cross-language).
   `contamination()` now adds a content-token Jaccard ≥ 0.6 pass over a language-agnostic
   stoplist; checked at reshape, generate, merge AND validate. 18 twins dropped at reshape,
   7 more at merge.
4. **Smoking legal misclaim (medium).** A card claimed smoking is banned outright where the
   FACTS state only that SALE to minors is banned (confirmed by an adversarial
   gpt-oss-120b/medium re-judge). Fixes: harmful-yes directive separates harm claims from
   legal claims; judge policy asserts it; safety-myth judged at reasoning MEDIUM; smoking
   cell widened to 4 seed topics → 17 smoking-cell rows (9 tl / 5 ceb / 3 en, was 3 tl).
   Final adversarial audit of all 17: 0 flagged.
5. **Chitchat/persona rows (medium).** 14+ rows trained vocative greetings ("hi hiraia") and
   persona questions ("sino ka po?", "may bayad po ba to?") into cards — one card invited
   conversation, one taught the "dili ko sigurado" hedge verbatim. `isChitchatQuery` (shared,
   un-anchored vocative-aware) filters reshape + ceb seeds + merge + validate;
   `PERSONA_CARD_RES` hard-fails any card that mentions Hiraia, invites questions, or quotes
   a hedge. Final file: 0.
6. **Identical-target cap (low).** 700 rows shared byte-identical cards across queries (one
   Mercury sentence ×10). `CARD_TEXT_CAP = 3` at every collection loop (quota then refills
   from judge-accepted surplus — real backfill, not a bare drop) + merge/validate. Final:
   max 3.
7. **Per-language safety polarity (low).** Cebuano sat at 19 affirm vs 32 deny (true-yes
   ceb = 7) while the global counter read balanced. Per-(cell, language) caps + a top-up
   generation pass; `validate.mts` reports `safetyPolarity.perLanguage`. Final: ceb 36/36,
   en 20/20, tl 55/50. (En-route discovery: the old directives' Tagalog register cues
   ("Oo, totoo…", "ligtas") were themselves planting Tagalog into Cebuano cards — cues are
   now language-aware: tinuod/luwas/daotan.)
8. **Driver upload bloat (low).** `upload_folder` now passes `ignore_patterns` for
   optimizer/rng/scheduler/deepspeed state (~16-20 GB) — resume state stays on the volume.

## Deviations from the design note (deliberate, with reasons)

1. **allowUngrounded is ~106 rows, not ~40.** The bank almost never states "X is
   safe" explicitly, so the safe-no cell starved (25/60) and unbalanced the grid — the exact
   collapse signature the bucket exists to prevent. Fix: 13 curated canonical statements for
   the safe-no topics (same license class as the settled-science list, still list-bound, 28
   canonical statements total). Balance > the 40-row cap.
2. **card-core is 4,605 rows (design ~4,700) but en inside it is 2, not 200** — v1's "English"
   rows are Taglish and classify as Tagalog. The en mass moved to en-topup + the en slices of
   the generated buckets (301 total ≈ v1's absolute share; below the design's 540). If the
   gate's English cases regress, `EN_TOPICS` × the en-topup cap is the dial.
3. **thin-escape is 100% verbatim-fact targets** (the design allowed compression when no fact
   fits 30 words) — a stronger, cleaner signal for the escape behaviour, and it makes
   "define the unknown term from memory" (the gate's measured cheat) impossible by
   construction.
4. **compress split is 108/86** after judging (design 120/100); language split ~99/63/32 vs
   the design's 110/80/30.

## Cost / reproduction

Fireworks: ~9.6M prompt + ~0.57M completion tokens (writer qwen3p7-plus, thinking off) +
~4.6M prompt + ~1.65M completion (judge gpt-oss-120b, reasoning low; safety at medium) ≈
**$3-4** total across the build + the findings-remediation re-runs.
Wall-clock ≈ 75 min at FW_CONC 12-24 (the judge is the rate-limited half). All stages are
resumable (`out/cache/`); a re-run with warm caches costs $0. AUP: TL/BIS child-body rows
were generated AND judged on Fireworks; no row content entered a Claude context.

## Training (driver.sh — prepared, NOT launched)

v1 recipe verbatim: full-param bf16, lr 1e-5 cosine, warmup 3%, bs 4×ga 4, 3 epochs,
`--template qwen3` (NOT qwen3_5/default — see driver comments), `truncation_strategy
delete`, num_proc from the cgroup quota. Expected steps ≈ ceil(5893/16)×3 = **1,107**;
driver holds the pod if `global_step` lands under 60% of that (the template-ate-the-data
signature) or the save is not a full-param 2B. Upload: HF `Cryptopop/hiraia-sft-flagship-2b`
**branch `v2`** (branch, not subdir — `revision="v2"` loads unmodified and main stays v1
until an explicit promotion; upload ships weights/tokenizer/trainer_state only —
`ignore_patterns` drops optimizer.pt/rng/scheduler/deepspeed shards, ~16-20 GB that belong
on the volume, not the branch), then GGUF f16 + Q4_K_M with the transformers-5
tokenizer_config overlay. Verified from `trainer_state.json` ON HF. Estimate: ≤1.5 h,
~$3-5 on 1×H100.

## Before training (checklist)

- [ ] Human Cebuano spot-check of `out/accepted-ceb-quality.jsonl` (the synth-ceb lesson;
      seeds are authentic — bucket-ceb-neutral + the bank's own `bis` text — but a native
      read of ~30 rows is cheap insurance).
- [ ] Human factual spot-check of ~30 random rows (accuracy ranks above fluency; the judge
      is an LLM).
- [ ] After training: the 45-case gate must lose NO green case; evaluate
      tier2-safety-smoking AND tier2-affirm-flat-earth together (passing one by regressing
      the other is the collapse signature); check ppl/greedy-gen Tagalog+Cebuano sanity
      (full-param SFT on an all-new surface may erode CPT fluency more than v1's
      chat-shaped rows did).
