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
- [x] **S2** Bake-off round 2 DONE — 8 models x 59 gold items, 0 request errors, ~$0.02 total.
      `google/gemini-3.0-flash-lite` does not exist on OpenRouter; substituted `gemini-3.5-flash-lite`.

      | model | acc | BROKEN prec | BROKEN recall |
      |---|---|---|---|
      | inclusionai/ling-3.0-flash | **.966** | .95 | .95 |
      | deepseek/deepseek-v4-flash-0731 | .949 | .905 | .95 |
      | google/gemini-3.5-flash-lite | .949 | .905 | .95 |
      | qwen/qwen3.7-flash | .949 | .905 | .95 |
      | openai/gpt-5-nano | .932 | .90 | .90 |
      | anthropic/claude-haiku-4.5 | .932 | **1.00** | .80 |
      | mistralai/mistral-nemo | .695 | .625 | **.25** |
      | amazon/nova-micro-v1 | .458 | .385 | **1.00** |

      Two results worth carrying into the report:

      **nova-micro's recall of 1.00 is degenerate, not good.** It answers BROKEN to almost
      everything — 20/20 on part-possession but 1/16 on governing-verb, with 32 false
      positives. Read alone, that 1.00 would have looked like the best model in the table.
      This is why precision and recall are reported separately and never averaged.

      **The frontier model was not the ceiling.** claude-haiku-4.5 is the most CONSERVATIVE
      judge (precision 1.00, recall .80 — it never wrongly flags, but misses 4 defects),
      and the cheapest model in the table beats it on accuracy. The cheap-vs-good framing
      was wrong; the spread WITHIN the cheap tier (.966 to .458) dwarfs the gap to frontier.

      **A 3-model majority vote beats every single judge: acc .983, precision 1.00, rec .95.**
      Precision 1.00 is the property that matters, since it means no correct Tagalog gets
      rewritten. Achievable entirely on cheap models — `gemini-3.5-flash-lite + gpt-5-nano +
      ling-3.0-flash`. Including a weak member poisons it (combos with nova-micro/mistral-nemo
      drop to ~.88), so the panel must be drawn from the strong tier.

- [x] **S3** DONE — 32 candidates x 3 models = 96 verdicts, 0 unresolved, ~$0.01.
      **16 unanimous BROKEN** (incl. ffct-13212, the card that started this), **9 two-one
      splits**, **7 unanimous CORRECT**. Written to `proposals-t1.md`; NOTHING applied.
      So of the 32 regex candidates, half are confirmed defects — the filter's precision is
      ~50-78% depending on how the splits resolve, which is why this class was never automated.

      **Reliability caveat found here:** three T1 texts appear on more than one card (the
      duplicate-lead class), which accidentally probes self-consistency. The panel failed it
      once — "Ilang dulo ang may baterya?" scored 0/3 BROKEN on ffct-22124 and 2/3 on
      ffct-23523, with gemini-3.5-flash-lite and ling-3.0-flash each flipping on
      byte-identical input at temperature 0. So some 2-1 splits are sampling noise, not
      difficulty, and the gold scores have a noise floor a single 59-item run cannot see.
      Worth re-running the 9 splits at n=3 for a stable majority before a human reads them.

- [x] **S4/S5/S6 SUPERSEDED and DONE** — the planned work (judge 300 items with the existing
      prompt, then compute a rate) was ill-posed: that prompt only adjudicates ang/ng licensing
      in COUNTING questions, and the sample is 73 bakit / 58 ano / 57 paano. It would have
      returned confident, meaningless verdicts. Also fixed two sampler bugs (stratified on the
      first token, inventing 40 "interrogatives"; a per-class floor that turned n=300 into 500).

      Replaced with a rubric-design workflow: 4 lenses over the real sample -> a skeptic per
      claimed class -> synthesis. **46 defect classes proposed, 42 REFUTED** — mostly
      prescriptivism a Filipino teacher would reject. Output in `TIER2-RUBRIC.md`.

      **Measured rate** (Wilson CI): hard defects **3.7%** (2.1-6.5%) ≈ 710 cards; including
      arbitrable cases **11.7%** (8.5-15.8%) ≈ 2,250. 88% of the sample ships unchanged.

      **The budget is teacher-hours, not tokens.** A full 19,279 x 3-model pass is $4-8. The
      same pass queues ~1,100 cards for a Filipino teacher at unanimity ≈ 14 h of arbitration
      before any editing. Optimising the model price was the wrong axis all along.

      **Operational landmine found:** 17.3% of question leads (3,326 of 19,279) carry an
      `emphasis.tl` span inside the lead. Editing a lead without updating `emphasis.tl` in the
      same change silently drops the card's bolding. Any fix pass must handle this.

      **3 of the 4 surviving classes need no model at all** — `gawa ng` misuse (32 leads,
      verified), singleton non-words (~1,900 candidates), and within-card English
      self-contradiction (1,490 leads carry an English token their own title/terms translate).
      Enumerate these for free before spending anything.

      **Biggest finding is out of scope:** the highest-value defects are in ANSWERS, not leads —
      ffct-36052 calls potters *alahero* (jewellers); ffct-21283 inverts batter->cake; ffct-09227
      restates its premise instead of explaining; dcard-04970 asks which is the better buy and
      never mentions price. Under the project's accuracy-over-fluency rule these outrank every
      language defect here. Recommendation: fund the free enumerations + one ~$5 LLM pass for
      language, and put the teacher-hours into an ANSWER-quality sweep instead.

      One skeptic agent died on an AUP false positive (known issue — see the judging-classifier
      memory); 51 of 52 agents completed.

- [ ] **S7** Write `REPORT.md`: what was fixed, what is proposed, the bake-off table, the
      Tier-2 rate estimate, and a recommendation on whether a full sweep is worth funding.
      Commit. Leave a one-paragraph summary for Luis.

## Known caveats to carry into the report

- Gold labels are mine, **not native-verified**; the 5 `borderline: true` rows especially.
- The regex candidate generator has a known false negative (`ffct-00831`, participle mistaken
  for a predicate), so T1's 32 is a floor, not a census.
- 422 duplicate question leads and 19 Tagalog-in-English-field cards are reported but unfixed.
