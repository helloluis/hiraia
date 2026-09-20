# Full pass — 19,279 Tagalog question leads

Worktree `/Users/luis/Code/hiraia-card-lang`, branch `card-language-audit`.
Run dir: `tools/card-language-audit/runs/2026-09-20-full-pass/`
Prior run (Tier 0/1, gold set, bake-off, 43 cards fixed): `../2026-09-19-tl-questions/`

**In-session on the Claude subscription, not OpenRouter.** The $5 OpenRouter figure in the
earlier report was an artifact of the bake-off harness; CLAUDE.md says use the subscription for
assisted work including the judge. Corpus is 1.22M tokens of content — well within reach.

## Hard boundaries

- **Do NOT rebuild `cards.db` and do NOT build an APK.** 43 cards have already changed since
  v0.4.16 shipped; a rebuild is a release decision for Luis, not a side effect of this sweep.
- **Do NOT push, deploy, or touch the VPS or R2.** Commit to `card-language-audit` only.
- **Write a card only when the defect is provable from that card's OWN English or answer.**
  Anything resting on a judgment call goes to the native-review queue instead.
- **Every lead edit goes through the emphasis guard** in `apply_fixes.py`. A moved span does
  not error, it silently drops the card's bolding, and 17.3% of leads carry one.
- No OpenRouter spend in this run.

## Stages

- [x] **F0** DONE — in-session Claude, batched ~20/agent (mirroring production batching, not
      one-call-per-item). **acc .948, BROKEN precision .947, recall .90** (tp18 fp1 fn2 tn37).
      Passes the precision gate (>= .9), so the sweep proceeds.

      **But it is NOT better than the cheap models**, which is worth stating plainly since the
      argument for going in-session was cost and convention, not quality:

      | judge | acc | BROKEN prec | BROKEN rec |
      |---|---|---|---|
      | 3-model OpenRouter panel | .983 | 1.00 | .95 |
      | ling-3.0-flash (single, cheapest tier) | .966 | .95 | .95 |
      | **in-session Claude (single)** | **.948** | **.947** | **.90** |

      It missed 2 genuine part-possession defects the cheap panel caught (`ffct-08651`,
      `ffct-13422`). One point in its favour: it was CONSISTENT on the byte-identical duplicate
      probe (ffct-07127 / ffct-07609 both BROKEN), where the OpenRouter panel flipped.

      **Decision: run the sweep as a 3-agent in-session PANEL with majority vote**, not a single
      judge. The bake-off already showed a panel beats every single member (precision 1.00 vs
      .95); tokens are free on the subscription, so there is no reason to take the weaker option.

      Caveat: a batch-construction slip judged `ffct-07609` in place of `dcard-08636`, so 58 of
      59 gold items were scored. `ffct-07609` is the byte-identical twin of `ffct-07127`, which
      is why it doubled as the consistency probe.

- [ ] **F1** en-mismatch sweep, cards 1-5,000.
- [ ] **F2** en-mismatch sweep, cards 5,001-10,000.
- [ ] **F3** en-mismatch sweep, cards 10,001-15,000.
- [ ] **F4** en-mismatch sweep, cards 15,001-19,279. Then dedupe + summarise findings.
- [ ] **G0** Score the in-session judge on the 30-item answer-quality gold in
      `../2026-09-19-tl-questions/TIER2-RUBRIC.md` before sweeping.
- [ ] **G1** answer-quality sweep, cards 1-6,500.
- [ ] **G2** answer-quality sweep, cards 6,501-13,000.
- [ ] **G3** answer-quality sweep, cards 13,001-19,279.
- [ ] **A1** Apply only what is provable from each card's own English/answer, via
      `apply_fixes.py` with the emphasis guard. Everything else -> `review-queue.json`.
- [ ] **R1** Final `REPORT.md`: what changed, what is queued, and an explicit
      rebuild-and-ship recommendation for Luis to accept or decline.

## Sweep state

Batches write `en-mismatch.jsonl` / `answer-quality.jsonl`, one row per card, keyed on card id.
A stage re-run skips ids already present, so a firing that dies mid-batch resumes cleanly.

## Carried caveats

- Gold labels are Claude's, **not native-verified**; the `borderline` rows especially.
- The panel gave different verdicts to byte-identical text at temperature 0, so all scores
  carry a noise floor a single 59-item run cannot measure.
- 5 split cards, 19 Tagalog-in-English-field cards and 422 duplicate leads remain unfixed.
