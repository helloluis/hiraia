# Cebuano (Bisaya) card-language audit

Worktree `/Users/luis/Code/hiraia-card-lang`, branch `cebuano-language-audit`, off `main`
at bd2ff5ea6 (v0.4.19 shipped).

Sibling of `tools/card-language-audit`, which did this for Tagalog. That pass repaired 1,886
cards and shipped in 0.4.18/0.4.19. **Read its REPORT.md before changing anything here** — the
method below is not arbitrary, every rule is a scar.

## The governing constraint

**Claude's Cebuano is weaker than its Tagalog, so this audit does NOT rest on Claude's
judgement of Cebuano style.** In the Tagalog pass the hand-built control set was wrong on 3 of
9 words, and the judge was right each time — because it read the card and Claude read a word
list. Repeating that mistake in a language Claude knows less well would produce confident,
wrong numbers.

So: **every defect must be provable against the card's own English or its own answer.**
Register, idiom, dialect and word-preference are OUT OF SCOPE. Cebuano has wide regional
variation (Cebu / Davao / Mindanao) and a prescriptivist pass would churn good cards — the
Tagalog design workflow refuted 42 of 46 proposed defect classes for exactly that reason.

## Scope, measured 2026-09-20

49,156 cards all carry a Cebuano body; 19,285 open with a Cebuano question.
Structural checks are already CLEAN — the Tagalog pass fixed them across all three languages:
  literal backslash-n in bis .... 0
  bis identical to tl/en ........ 0 / 1
  orphaned bis emphasis spans ... 0 of 27,263
Tagalog bleed into Cebuano is NOT a problem: 5 marker occurrences plus 6 standalone "ay"
across 49,156 cards. (A first probe claimed 1,582 — it was wrong: nila/kanila/niya/ako/kami
are valid Cebuano, and "ay" was matching inside hyphenated words like taghan-ay.)
So the cheap deterministic wins are already banked; what remains is semantic.

## Hard boundaries

- **No cards.db rebuild, no APK, no deploy, no push.** Commit to this branch only.
- **Write a card only when the defect is provable from its own English or answer.**
- **Every edit goes through an emphasis guard**, checked per language against its own text.
  A span not present verbatim stops rendering silently; 27,263 bis spans are in scope.
- **Never apply a grep without triage.** In the Tagalog pass 952 of 1,017 grep candidates were
  FINE; blind application would have corrupted 952 good cards to fix 61.
- **No OpenRouter spend.** In-session on the subscription.

## Stages

- [x] **C0** DONE — 50-item gold set (17 FLAG / 33 PASS), 15 rows marked `native: true`.
      Confidence on the FLAG side is honest: 2 high, 9 medium, 6 low.

      **Negative result first, because it cost three attempts.** I tried to build the gold set
      from "objective" en-vs-bis NUMBER mismatches, needing no Cebuano judgement at all.
      It does not work:
        attempt 1 (78 hits)    \b missed digits glued to letters — 10x, 23rd, COVID-19
        attempt 2 (8,843 hits) mapping number-WORDS was catastrophic: Cebuano `usa` is both
                               "one" AND the indefinite article, so `usa ka insekto` ("an
                               insect") registered as the number 1 across thousands of cards
        attempt 3 (21 hits)    digits only, both sides required — plausible, but most are
                               still fine: `napulo ka beses` IS "10 times", `dekada '90` IS
                               the 1990s, `ika-14 siglo` IS the 1300s, `liboan` IS "thousands"
      Cebuano routinely spells numbers out and uses idiomatic date forms, so number mismatch is
      NOT an objective signal here. That closes off the approach proposed to Luis as the way to
      avoid relying on Claude's Cebuano.

      **What worked instead: corpus-internal frequency.** The proposer had to quote both sides,
      and each disputed word was then checked against how the CORPUS uses it — no appeal to
      Claude's Cebuano intuition:
        `panghupaw` (sighing) used for "sweat" on 4 cards, while `singot` (correct) appears on 152
        `tabanog` appears with English "kite" on 7 cards and "dragonfly" on 2 — the 2 are outliers
        `asin` appears on 551 cards, every one meaning SALT — so a title rendering "smoke" as
        `asin` ("Toxic Asin Plastik") is wrong; smoke is `aso`
      Verification also corrected the proposer once: it called `tabanog` unambiguously "kite",
      but the corpus uses it both ways, so that row dropped from high to needing native review.

      Sample drawn RANDOM and unfiltered on purpose — a filtered pool would bake the filter's
      blind spots into the gold set, and this stage demonstrated three such blind spots.
      Rate: 17 findings in 600 cards (2.8%), against 0.78% for Tagalog.
- [x] **C0-note** Original wording of this stage kept below for provenance:
      Build the Cebuano gold set the EVIDENCE way: do not hand-label from a word list.
      Draw candidates where the Cebuano contradicts its own English, label each WITH the card
      open, and mark every uncertain row `native: true`. Target 40-60 items, FLAG/PASS balanced.
      Record honestly that these labels are Claude's and are not native-verified.
- [x] **C1** PASSED, with the scope narrowed by what it revealed. 3 independent runs over a
      125-card production-shaped batch (50 gold + 75 unseen filler, judge blind to which):

      | run | FLAG precision | recall | flags on unseen filler |
      |---|---|---|---|
      | 1 | 1.00 | .18 | 0 |
      | 2 | 1.00 | .24 | 2 |
      | 3 | 1.00 | .41 | 0 |

      **Precision 1.00 across 375 judgements, zero false positives.** Gate cleared.

      The low recall is NOT blindness — it is a THRESHOLD DIFFERENCE, visible in the notes.
      The judge only flags when the fact is UNRECOVERABLE; the C0 proposer flagged wrong
      wording even when the surrounding text rescued the fact. On ffct-15087 it wrote: title
      'Asin' looks like a typo for 'aso', but "the body correctly says toxic smoke" -> PASS.
      Both standards are defensible; they answer different questions. So the C0 gold labels
      are too aggressive, not the judge too blind.

      Recall against the gold's OWN confidence tiers makes it clean:
        high-confidence FLAGs (unambiguous) .... 2/2  = 100%
        medium ................................ 4/9
        low ................................... 1/6
        false positives on gold PASS rows ..... 0
      The judge is reliable exactly where the gold is reliable, and misses exactly the rows
      marked `native: true` where Claude's Cebuano was already the weak link.

      **Consequence for scope:** this judge is fit for "cards that teach a child something
      FALSE" — the project's accuracy-above-fluency rule — and is not fit for a wording or
      style audit, which was already out of scope. C2 onward therefore targets unrecoverable
      factual defects only, and runs as a 3-run union (41% overall recall, 100% on the
      unambiguous tier, 0 false positives).

      Also measured: 7 of 125 cards got different verdicts across the three runs, which is why
      the union rather than a single run is the production configuration.
- [x] **C1-note** original stage text: Score the judge on C0's gold at PRODUCTION batch size. Report accuracy plus
      precision and recall on FLAG **separately** — never averaged. Gate: FLAG precision >= 0.9.
      If it fails, stop and say so rather than sweeping 19,285 cards with an unmeasured judge.
- [x] **C2** DONE — 1,500 unseen cards, 3-run union, full card record, no truncation.
      **14 flags = 0.93%** (per-run 9 / 10 / 12; 6 unanimous). Tagalog was 0.78%.
      Projected over 19,285 cards: ~180 findable at this recall; at the measured recall of
      ~.41 the true population is plausibly ~440.

      The defects are severe and several are provable against the corpus's own usage:
        cat -> iro          title says Toxoplasma comes from DOG droppings; EN and body say
                            CAT. A false health claim, and cat-specificity is the card's point.
        fever -> tugnaw     "why are we weak when COLD" instead of "with a fever"
        sweating -> pagpanghupaw   the brain triggers SIGHING to cool the body (the same batch
                            uses `mopawis` correctly, so the right word exists in the corpus)
        absorb -> mopasok   carrots PUT minerals INTO the soil — uptake direction reversed
        left -> miadto      sunlight WENT TO the sun eight minutes ago — direction reversed
        thunderstorm -> bagyo   a hot Manila afternoon signals an incoming TYPHOON
        beak -> sungkad     Darwin's finch BEAKS become fruit-knocking poles (corpus uses
                            `tuka` for the same Darwin fact elsewhere)
        whisper -> bulong   "a shout reaches farther than MEDICINE"
        cools -> moluoy     "when the magma TAKES PITY"
        roast -> gilanggaw  coffee beans VINEGARED, not roasted (corpus uses `gisanlag`)

      **blindness -> pagkabulag is explicitly a TAGALOG FALSE FRIEND**: in Cebuano `bulag`
      means to separate, blind is `buta`, and the corpus uses `makabuta` correctly elsewhere.
      That is the same cross-language interference class as `cud -> pag-usap` (Cebuano into
      Tagalog) and `Haiwan` (Malay) — now observed in the third direction, Tagalog into
      Cebuano. Three directions of bleed from one generator is a pipeline finding, not a card
      finding.

      13 reusable word-pair patterns captured for the C4 grep stage.
- [x] **C2-note** original stage text: Measured probe: 2,000 cards, gold spiked in, full card record, NO field truncation.
      Report the flag rate and the projected corpus total before spending on the rest.
- [~] **C3 CHUNK A DONE, REST HELD pending Luis.** 14,000 cards swept (single run, not 3 --
      per-run flags were 9/10/12 vs a union of 14, so one run buys ~70% of the findings for a
      third of the cost). **268 flags = 1.91%**, against the probe's 0.93%. Treat 0.93% as the
      corpus estimate until chunk B: the probe sampled randomly while this chunk took cards in
      id order, which clusters by card family.

      **URGENT, surfaced to Luis out of band:** three SHIPPED card titles contain `titi`, the
      vulgar Cebuano/Tagalog word for penis, rendering "tasting" and "toes" --
      ffct-00131 "Titi sa Tiil sa Alibangbang", ffct-00424 "Prints sa Titi ug Palad",
      ffct-02351 "Laing Prints Titi". Bodies are correct; the defect is title-only, and
      title_bis is what a child sees. Live in 0.4.19. NOT fixed unilaterally — awaiting his call.

      **193 of 268 findings (72%) are in `title_bis`, not the body.** So the earlier title
      hypothesis was right and my TEST of it was wrong: I measured whether titles lack Cebuano
      linkers (a style proxy, 19.2% vs Tagalog 18.7% — no signal) when the real skew is that
      titles carry the SEMANTIC errors. Wrong proxy, not wrong hypothesis.

      **Dominant pattern is another Tagalog false friend, and it is large.** `langgam` means
      BIRD in Cebuano and ANT in Tagalog. Corpus-wide, 47 cards use `langgam` on a card whose
      English says ANT, against 657 that correctly use it for BIRD. "Ants Per Person" is titled
      "Langgam sa Matag Tawo"; the pangolin eats millions of birds.

      Other confirmed swaps: tears(rips) -> luha (teardrops), cricket -> kagang (crab, 9 cards),
      wasp -> putyokan (honeybee), pufferfish -> baboy-dagat (dugong, which is a mammal and
      lays no eggs), wears-down -> maghait (sharpens — the opposite), sweat -> bahu (odour),
      monkey -> ungo (witch), feathers -> buhok (hair), light -> sugnod (firewood),
      balance -> bali (broken), toad -> bakulaw (gorilla — the SAME defect found in Tagalog).

      159 distinct word-pair patterns captured.

- [!] **C3 CHUNK B — BLOCKED BY SESSION LIMIT.** 70 of 100 batches completed (9,800 cards,
      164 flags = 1.67%, consistent with chunk A's 1.91%). Batches **170-199 did NOT run** —
      all 30 failed with "You've hit your session limit, resets 10:30pm Asia/Manila".
      Those 4,200 cards are UNSWEPT and must be re-run after the reset.

      Do not treat the sweep as complete. Remaining: batches 170-336 = 167 batches = ~23,400
      cards, roughly half the corpus.

      Chunk B's richest new seam is more Tagalog false friends, several severe:
        bulok   Tagalog 'rotten', but Cebuano COLOUR — ~35 cards; "Gatos Tuig Bulok"
        hilo    Cebuano POISON, used for 'thread' — "cotton is twisted to become poison"
        bihag   Cebuano CAPTIVE, used for 'rare' — "captive expensive metal"
        libog   Cebuano confusion (and crude in Tagalog), used for 'round'
        lumot   Cebuano MOSS, used for 'soft' — "Moss Rubber Bendable"
        bakal   Tagalog 'iron'; in Cebuano it is the verb TO BUY (iron is puthaw)
        mabuak  'break', used for 'spoil' and 'rot' — 132 corpus uses all mean breaking
        gamot   Cebuano ROOT, used for 'medicine' (4 more)
      Plus a reversal, ffct-15480 "Tanso Mamatay sa Mikrobyo" = copper DIES FROM germs, the
      opposite of "Copper Kills Germs"; and ffct-15401 carries a garbled non-word,
      "Asalinhagikan", where "Asa gikan" belongs. Judge returns a reusable
      `pattern` per flag. Stop early if pattern discovery saturates.
- [ ] **C4** Grep each discovered pattern corpus-wide, then TRIAGE every hit with its card in
      view. Expect most to be FINE. Report confirmed vs candidates separately.
- [ ] **C5** Rewrite confirmed defects, each independently verified before applying, with the
      emphasis guard. HOLD anything needing facts not on the card.
- [ ] **C6** REPORT.md: what changed, what is queued for a Cebuano speaker, and an explicit
      ship-or-not recommendation. Do not ship.

## Carried lessons (do not relearn these)

- Supply the WHOLE card record. F1 scored recall .33 partly because the batches omitted
  title/terms/bis, making 5 of 15 gold items unjudgeable by construction.
- Do not truncate fields. Capping `ans` at 200 chars produced 3 false flags.
- Return flags only from a workflow, never every row — 5,030 rows blew the 4,096 array cap.
- Batch size is a tracked variable, not an incidental choice. It silently moved a score .948
  vs .983 once already.
- A verifier that accepts 100% is not verifying. Check mechanically as well.
- Deterministic enumeration wins on CLOSED classes, loses on OPEN ones. `gawa ng` was 23/23 by
  grep and 0/2 by model; nonword detection was the reverse.
