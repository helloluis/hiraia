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

- [x] **F0b** Same-model panel test — **panel design REJECTED, and F0's number was wrong.**
      Three independent in-session passes over the same 58 gold items (different orderings):

      | | acc | BROKEN prec | BROKEN rec |
      |---|---|---|---|
      | member 1 / 2 / 3 | .983 / .983 / .983 | .952 / .952 / 1.00 | 1.00 / 1.00 / .95 |
      | majority vote | .983 | .952 | 1.00 |

      Members disagreed on **2 of 58 (3.4%)** and the majority equals any single member, so a
      same-model panel adds nothing — correlated errors, as expected once the members are one
      model rather than three.

      **More important: the single-judge score moved .948 -> .983 purely from BATCH SIZE.**
      F0 split 59 items into three ~20-item batches; this run gave each agent all 58. The
      larger mixed batch lets the judge calibrate against contrastive cases in view. So F0's
      .948 measured my chunking, not the judge. At .983 a single in-session judge matches the
      diverse OpenRouter panel and beats ling-3.0-flash (.966).

      **Design: SINGLE in-session judge, large batches.** One third the agents of the panel
      plan and better measured accuracy. F1 must re-confirm the effect holds at the production
      batch size of 200 — having been caught once assuming batch size is neutral, do not
      assume it scales.

      Both disagreements were on rows already marked `borderline` (ffct-22124, ffct-37748).

- [!] **F1 FAILED ITS GATE — verdicts NOT banked.** 25 agents completed (2.17M tokens, 0 agent
      errors) and the workflow then died returning 5,030 rows past the 4,096 VM-boundary cap;
      all rows were recovered from journal.jsonl, so no work was lost. The spiked control is
      what killed the stage:

      **FLAG precision 1.00, FLAG recall 0.33** (tp5 fp0 fn10 tn15) at ~230 cards/agent.
      It caught 5 of 15 known defects. Sweep flag rate was 0.8% (40/5,024) against a measured
      Tier-A rate of ~3.7% — about a fifth of what is there, consistent with recall .33.

      Without the spiked control this would have been reported as "40 findings, corpus is
      clean". That is the SECOND time batch size silently changed the answer (F0's .948 was
      the first). Batch size is now a first-class variable in this pipeline, never an
      incidental choice.

      Precision staying at 1.00 while recall collapses points at the rubric's heavy
      "NEVER flag these" section dominating under volume: the judge defaults to PASS.
      NEXT: measure recall vs batch size (30 / 60 / 120) before re-running anything.
- [x] **F1-diag** Sensitivity probe — **my batch-size diagnosis was WRONG, and the real cause
      was my own data preparation.** Recall by condition, precision 1.00 throughout:

      | probe | batch | density | recall |
      |---|---:|---:|---:|
      | A-30 | 30 | 100% | .27 |
      | A-60 | 60 | 50% | .20 |
      | A-120 | 120 | 25% | .20 |
      | A-240 | 240 | 12% | .13 |
      | B-240 (rebalanced prompt) | 240 | 12% | .27 |
      | B-120 | 120 | 25% | .20 |

      Batch size moves recall only .27 -> .13; the floor is ~.2 in EVERY condition, including
      30 cards at 100% density. So "batch size killed recall" was wrong — F1's own control
      (.33) was in fact the best score of any run.

      The judge caught the same 3-4 items every time and never the other 11. Cross-referencing
      those against the rubric's own gold table: **5 of the 11 are `own-tagalog`, a class the
      rubric defines as "tl uses an English word while THIS CARD's own TITLE_TL, TERMS or BIS
      carries the Tagalog form" — and the batch records I built contained only
      {id, tl, en, ans}.** No title, no terms, no bis. Those 5 were unjudgeable by
      construction, capping recall at .67 before the model started.

      The Tier-2 rubric's first design note says "the judge never sees the lead alone... almost
      every genuine defect is provable as a within-card contradiction". I built the batches
      without it. Re-probing with the full card record supplied.
- [x] **F1-fullctx** Supplying title/terms/bis raised recall .20 -> **.33**, identical at
      batch 120 and 240 — which finally settles that batch size was never the driver.
      Precision stayed 1.00 with zero false positives in every run. It plateaus at .33.

      Breakdown of what it catches vs misses is the actionable part:

      | class | caught | missed |
      |---|---:|---:|
      | nonword | 2 | 0 |
      | en-mismatch | 2 | 1 |
      | own-tagalog | 1 | 4 |
      | gawa-ng | 0 | 2 |
      | no-predicate | 0 | 3 |

      **The classes it misses are the enumerable ones.** The judge found 0 of 2 gawa-ng
      defects; the deterministic enumeration found 23 of 23 and all are already fixed. It is
      genuinely good at the semantic classes it was needed for.

      **PLAN CHANGED — deterministic first, narrow LLM second.** This is what TIER2-RUBRIC §1
      recommended ("Step 0: three deterministic enumerations, free, do them before spending
      anything") and which I skipped in favour of a monolithic six-class sweep. A 19,279-card
      sweep at recall .33 would burn ~8M tokens to find a third of what a free grep finds.

- [x] **E1** DONE, and the naive version over-flags badly — a useful negative result.

      The broad rule (token untranslated in the lead but translated in the card's own title)
      yields **2,138 candidates, ~11% of all leads**, with `energy` (78), `water` (41) and
      `table` (17) as the top tokens and "Philippine eagle" among the hits. Those are DepEd
      science vocabulary and proper names — exactly the two things the rubric's never-flag list
      names. Acting on that set would churn good cards. **Not actionable; kept as a queue only.**

      The defensible subset is cards that contradict THEMSELVES: the same card spelling one
      word two ways. **75 cards, 28 pairs.** Corpus-wide counts then decide the winner by
      evidence rather than taste, and they split cleanly in two:

      - **CLEAR-CUT — 40 cards, 15 pairs**, minority form <=10% of usage and usually a one-off
        typo: asteroyd(0) vs asteroid(125), statik(0) vs static(154), kobra(0) vs cobra(21),
        eklipse(13) vs eclipse(124), koral(12) vs coral(331), grap(2) vs graph(143).
        Mechanical, provable from the card, safe to normalise.
      - **HOUSE-STYLE SPLIT — 35 cards, 13 pairs**, where BOTH forms are in genuine corpus-wide
        use: bacteria(379)/bakterya(352), plastic(190)/plastik(330), camera(23)/kamera(22),
        crystal(73)/kristal(170). These are not defects, they are an unmade editorial decision.
        **Luis or a Filipino teacher picks the house form; I should not.**

      Files: `enum-own-tagalog.json` (2,138 queue), `enum-own-tagalog-strong.json` (75),
      `enum-spelling-clearcut.json` (15 pairs), `enum-spelling-housestyle.json` (13 pairs).

- [x] **E1b** Spelling normalised to English, corpus-wide — **1,359 cards**, Luis's call:
      "just spell it in English; the PH curriculum is dominated with English words in science".
      Applied to 26 of the 28 pairs. HELD by policy: `kalamansi` and `abaka` (78 cards) —
      Filipino words with anglicised export spellings, not English science terms respelled
      into Filipino; that is a different decision and is left for a human.
      Emphasis spans co-renamed with the text; **0 orphaned spans of 81,757, before and after.**

- [x] **E2 — the deterministic rule FAILED. Zero reliable findings; useful as a funnel only.**

      Raw rarity is meaningless here: 18,584 of 33,733 distinct Tagalog tokens appear <=2
      times, because Tagalog is agglutinative and rare inflected forms are normal
      (`nasasakal`, `iminumungkahi`, `nagbibigay-init` are all perfectly good words).

      The near-neighbour test (rare token within 1 edit of a >=20x more common one) gives
      1,345 hits, but precision is poor for a linguistic reason: Tagalog phonology puts many
      REAL words one edit apart. `hapag` (table) is not a typo of `kapag`; `galos` (scratch)
      is not `halos`; `gumagaya` (imitates) is not `gumagawa`; `hingin` is not `hangin`.

      The 94 "punctuation artifacts" I isolated as a high-confidence subset turned out to be
      false positives too — legitimate single-quoted phrases (`'kaunti lang'`,
      `'malamig na liwanag'`) whose closing quote my tokeniser swallowed.

      **Generalisation worth carrying:** deterministic enumeration works on CLOSED classes with
      external evidence — `gawa ng` (confirmed by the card's own English, 23/23) and spelling
      pairs (settled by corpus counts, 1,359 cards). It fails on OPEN classes in an
      agglutinative language, where "is this a word?" needs a lexicon nobody has.

      **Value delivered: a funnel.** 1,251 candidates is small enough for a cheap LLM pass,
      versus 19,279 cards blind — the same 274 -> 32 -> 16 funnel that worked for Tier 1.
      Folded into F1b's scope rather than run as its own sweep.

- [x] **F1b-nonword** DONE — the funnel works. 19,279 cards -> 1,248 candidates -> 158 live
      typos -> **129 applied across 105 cards**, 29 held for a Filipino speaker.
      Control: 6/9 nominal, but on review the judge was right on all three and my hand labels
      were wrong (`unatin`/`magbilis` are real words; `hingin` is a real word used incorrectly).
      Biggest find was indirect: **51 cards rendering a literal backslash-n on screen**, which
      also meant they never split into question and answer. Fixed separately.
- [x] **F1b-probe** DONE — measured 2,000-card probe. **13 flags (0.65%)**, and they are the
      highest-value findings of the whole audit: cards that teach a child something false.
        ffct-10617  "bulb" -> "bombilya" (electric light bulb) — the card states that the food
                    stored inside a LIGHT BULB is sugar and starch made by leaves
        ffct-16229  "get hotter" -> "nangangain" — "does water EAT more than 100 degrees"
        ffct-02738  "starfish" -> "bituin" (a star in the sky)
        ffct-34824  "puddles" -> "latian" (marsh) — "marshes disappear on cool days" is untrue
        ffct-35343  question presupposes the Sun burns; its own answer opens "Hindi!"
      Deterministic pre-filtering was tried first and does NOT work here: numbers/proper nouns
      absent from the Tagalog gave 864 candidates that are overwhelmingly CORRECT translations
      (Philippines->Pilipinas, Earth->mundo). Telling "dropped" from "translated" IS the
      semantic judgement.
      **Prompt flaw found by the judge itself:** I used ffct-21503 as the in-prompt example and
      it is also a gold item, so catching it was not independent — the model said so unprompted.
      Genuine recall on the uncontaminated gold is ~1/3, consistent with every earlier
      measurement, so the true defect count is likely ~3x what a single pass finds.
- [x] **F1b-models** Opus vs Sonnet on the identical 2,004 cards: **Opus 13 flags, Sonnet 6**
      — but 3 of Sonnet's 6 were an artifact of MY batch prep (I truncated `ans` to 200 chars
      and Sonnet correctly reported the answer was cut off). Real: Opus 13, Sonnet 3, overlap 2.
      None of Opus's 13 were affected by the truncation. **Opus is ~4x the real yield.**

- [x] **KEY ARCHITECTURAL FINDING — models discover patterns, greps enumerate them.**
      Opus found `puddle->latian` on ffct-34824; Sonnet found the SAME defect on ffct-20721.
      Different cards, identical error, neither found both. Grepping the corpus for the six
      patterns the two runs discovered:

      | pattern | grep finds | models found |
      |---|---:|---:|
      | plant bulb -> bombilya | 5 real (of 141 matches) | 1 |
      | puddle -> latian | 12 real | 2 |
      | starfish -> bituin | 1 real (of 5 matches) | 1 |
      | vocal cord / muggy / rub | 3 | 3 |

      ~21 real defects against the 6 the models surfaced — a **~3.5x multiplier, free.**
      Both directions of verification mattered: 126 of the 141 `bulb` matches are genuinely
      about LIGHT bulbs and correctly translated, and 4 of the 5 `starfish` matches are correct
      usage. Grep proposes, triage disposes.

- [x] **F1b-full (8,000 of 17,284)** DONE — 50 flags (0.62%, matching the probe's 0.65%),
      **45 distinct wrong-sense translation patterns**, several severe:

        unbalanced force -> "puwersa na balanse"   (says BALANCED force, the opposite)
        high tide        -> "mataas ang kati"      (kati is LOW tide)
        hump (camel)     -> "utong"                (nipple)
        toads            -> "bakulaw"              (gorilla)
        doves            -> "kalyos"               (a callus on the skin)
        warts            -> "tinga"                (food stuck in teeth)
        breathe          -> "hinihimod"            (licking)
        acre             -> "ektarya"              (1 ha = 2.47 acres; the number is 2.5x off)
        densest          -> "pinakamabigat"        (heaviest != densest; teaches a false fact)

      **Grep multiplier, then triage.** The 50 flags grep to 687 corpus instances (13.7x) --
      but the `bulb` lesson applies and the headline number is wrong before triage:

        59  pattern is ALWAYS a mistranslation        -> real defects
       163  pattern is ALWAYS correct (tears->luha,
            cars->kotse -- luha IS tears)             -> bogus, model flagged a context
       465  context-dependent (glass->salamin/baso,
            rice->kanin, pond->lawa)                  -> needs per-card triage

      So: 50 model findings -> **59 confirmed defects** by grep, plus 465 candidates. The real
      multiplier on confirmed defects is ~1.2x, not 13.7x. Greping a pattern the model found in
      ONE context and assuming it holds everywhere is the same error as the 141 bulb matches of
      which 126 were fine.

- [ ] **F1b-rest** Remaining 9,284 cards, same config. Pattern discovery has NOT saturated --
      this chunk found 45 new patterns against the probe's 6 -- so the remainder is worth it.
- [ ] **T1** Triage the 465 context-dependent candidates (cheap: one model pass over a bounded
      list, same funnel shape that worked for nonwords). run the narrow two-class sweep over all 19,279 (~9.4M tokens,
      run OPUS over the full 19,279 (~9.4M tokens) to DISCOVER defect patterns, then grep the
      corpus for every pattern found and triage. Do NOT truncate `ans` -- send the full answer.
      Expect the grep stage to multiply the model's findings ~3.5x at no cost.
      Queue built: `known-pattern-queue.json` (21 defects from the 6 patterns already known).
      NOT applied: choosing the right Tagalog for 'puddle' is a lexical call for a Filipino
      speaker, like the other 29 lexical rewrites. — `en-mismatch`, `answer-clash`, plus adjudication of E2's
      1,251 nonword candidates, the two genuinely
      semantic classes, full card record supplied, control spiked into EVERY batch. Re-measure
      recall on just those classes before committing to the full 19,279.
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
