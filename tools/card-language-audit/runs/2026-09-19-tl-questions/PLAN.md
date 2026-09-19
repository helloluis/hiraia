# Overnight plan — card-body Tagalog question audit

Run dir: `tools/card-language-audit/runs/2026-09-19-tl-questions/`
Worktree: `/Users/luis/Code/hiraia-card-lang` (branch `card-language-audit`)

Each heartbeat firing does **the first stage below that is not DONE**, marks it, and stops.
Every stage is resumable: `judge.py` appends to a `.jsonl` keyed on `(model, id)` and only
treats a row with a non-null verdict as done, so a half-finished batch resumes cleanly.

## Hard boundaries for the overnight run

- **Do not rebuild `cards.db`.** The pool edit is committed; regeneration + APK is Luis's call.
- **Do not push, deploy, or touch the VPS or R2.** Commit to `card-language-audit` only.
- **Do not auto-apply T1 rewrites to the pool.** They land in `verdicts-t1.jsonl` and
  `REPORT.md` as proposals. T0-A/T0-B are already applied and committed (6354fdd2c).
- Keep total OpenRouter spend under **$5**. It should come in far below that; if a stage
  would exceed it, stop and say so.

## Stages

- [x] **S0** Tier 0 applied (48 fixes), gold set built (59 items), tooling committed — 6354fdd2c
- [x] **S1** Bake-off round 1: `mistralai/mistral-nemo` (acc .695, BROKEN recall **.25** — unusable),
      `qwen/qwen3.7-flash` (acc .949, prec .905, recall .95). Fixed a 2000-token cap that made
      thinking models return empty content.
- [ ] **S2** Bake-off round 2. Add, in one call:
      `google/gemini-3.0-flash-lite`, `openai/gpt-5-nano`, `inclusionai/ling-3.0-flash`,
      `deepseek/deepseek-v4-flash-0731`, `amazon/nova-micro-v1`, plus one frontier baseline
      (`anthropic/claude-haiku-4.5`) so the cheap tier is measured against a known-good ceiling.
      Any model id that 404s: record it and move on, do not retry.
- [ ] **S3** Pick the judge: highest BROKEN **recall** among models with BROKEN precision ≥ 0.85.
      Record the choice and why in `REPORT.md`. Then judge the 32 T1 candidates with it.
- [ ] **S4** Tier-2 draw: `judge.py sample --n 300`, then judge the first half.
- [ ] **S5** Judge the second half of the Tier-2 sample.
- [ ] **S6** Analyse Tier 2: defect rate per interrogative (`bakit`/`ano`/`paano`/`gaano`/…),
      with the caveat that the judge's prompt is tuned for counting questions — if it flags
      `bakit`/`paano` items, hand-check a few before believing the rate.
- [ ] **S7** Write `REPORT.md`: what was fixed, what is proposed, the bake-off table, the
      Tier-2 rate estimate, and a recommendation on whether a full sweep is worth funding.
      Commit. Leave a one-paragraph summary for Luis.

## Known caveats to carry into the report

- Gold labels are mine, **not native-verified**; the 5 `borderline: true` rows especially.
- The regex candidate generator has a known false negative (`ffct-00831`, participle mistaken
  for a predicate), so T1's 32 is a floor, not a census.
- 422 duplicate question leads and 19 Tagalog-in-English-field cards are reported but unfixed.
