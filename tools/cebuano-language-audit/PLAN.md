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
- [ ] **C1** Score the judge on C0's gold at PRODUCTION batch size. Report accuracy plus
      precision and recall on FLAG **separately** — never averaged. Gate: FLAG precision >= 0.9.
      If it fails, stop and say so rather than sweeping 19,285 cards with an unmeasured judge.
- [ ] **C2** Measured probe: 2,000 cards, gold spiked in, full card record, NO field truncation.
      Report the flag rate and the projected corpus total before spending on the rest.
- [ ] **C3** Discovery sweep over the remaining ~17,300 in chunks. Judge returns a reusable
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
