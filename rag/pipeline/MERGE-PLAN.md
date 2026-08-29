# Unifying question-cards into card-ui

**Direction:** card-ui is the base (it is the shipping UI and holds the SQLite card architecture,
which exists for a measured reason: the JSON pool cost ~100 MB of Hermes bytecode). question-cards
brings the curriculum weighting, the grade setting, the data and the tooling.

## Conflict resolution
| path | resolution |
|---|---|
| `data/cards.ts` | HAND-MERGE. card-ui owns the inventory (SQLite `textOf`, `questionOf`, token index, `cardTitle`); question-cards owns the weighting (`TAGS`, `CurriculumTag` cells/norm, `weigher`, `drawFrom`, weighted `startCard`/`jumpCard`/`nextChoices`). Both edit the same draw functions. |
| `store/cardStore.ts` | HAND-MERGE. card-ui owns the thread/swipe state and the reward recap; question-cards owns `feedContext()`, the seen-store wiring and `markSeen` over every code. |
| `components/cards/CardFeedScreen.tsx` | card-ui wins wholesale (it is the new deck UI). Re-apply only the entry to settings, which is now the footer control from the grade port. |
| `store/engineStore.ts` | card-ui wins (its grade port is the adapted one); confirm the settings key, validation and prompt de-hardcoding match. |
| `scripts/gen-image-map.mjs` | Either — they are the same change (question-cards ported card-ui's cards-png walk). Take card-ui's. |
| `.gitignore`, `config/strings.ts`, `engine/LocalEngine.ts`, `scripts/card-harness.mts` | auto-merged; read the result rather than trusting it. |
| `packages/web/src/app/{icon,apple-icon}.png` | card-ui (new brand mark). |
| `packages/images/cards-png/ffct-{19779,25671}.png` | regenerate from the canonical WebP. |
| `generated/*`, `data/cards-questions.json`, `shared/src/rag/facts.generated.ts` | DO NOT merge — delete the conflict and regenerate. |

## Regenerate, in order (sources are the merged bank)
1. `merge-card-banks.py` → `cardsPool.merged.json` (must now include the 723 Lane A factoids and every engraving-backed card)
2. `wire-app-pool.py` → `cardsPool.generated.json` (the resident index)
3. `build-cards-db.py` → `assets/data/cards.db` + `tokens.bin` (card text, questions, titles)
4. `gen-image-map.mjs` (walks assets-png + cards-png, minus card art for ids that are not in
   the wired pool). It reads the pool that step 2 wrote, and step 2 reads the map this writes —
   that loop is a fixpoint after one pass (the ids it drops have no card, so no card can lose an
   illustration to it); re-run step 2 once after this to confirm the counts are unchanged.
5. `gen-curriculum-tags.mjs` → `curriculumTags.generated.json` (weighting input)
6. `gen-cards-questions.py` (three-option interject set)
7. `build-vectors.py` + `export-facts-ts.py` (retrieval blob and export must agree with the bank)

## Verify
`tsc` (mobile + shared) · `card-harness.mts` · `feed-weights-check.mts` (exact equivalence, rebuild-on-key-change, sibling decay) · `feed-calibration.mts` · `coverage-roundup.py` · `run-harness.sh` (regression gate must be green) · then an APK on the emulator: onboarding → grade → deck → quiz → recap → search, and the footer reading "Grade N · Pahina M".

## Still open before this ships (measured on the resolved merge)
- **APK/AAB size.** `imageMap.ts` bundles 30,062 PNGs = 462 MB (440 MiB) after the orphan prune,
  on top of 214 MB models + 119 MB rag + 90 MB data. Nothing in the verification list can see
  this; build the AAB and measure against Play's base-module limit. If it does not fit, the lever
  is `gen-cards-pool.py`'s engraving fallback (it is what grew the ffct bank 16,989 -> 36,532) or
  moving `cards-png` into an on-demand asset pack.
- **Title/taxonomy coverage.** 19,564 pool cards (42%) have neither a `title` nor `cats`, all of
  them ffct cards admitted by that same engraving fallback. Their index band falls back to
  `fact.topic` (median 32 chars) and they never enter `BY_CAT`, so the category lateral cannot
  reach them. Needs a `fw-gen-card-titles.py` run over the new ids, or the fallback gated on a
  title existing.
- **`nextChoices` cost.** ~31 ms per call on this laptop against the 46,421-card pool
  (`feed-weights-check` step 4; ~27 ms before the DepEd provenance tags, ~2 ms on the old
  full-pool draw). Measure on the Redmi before calling the deck done.
