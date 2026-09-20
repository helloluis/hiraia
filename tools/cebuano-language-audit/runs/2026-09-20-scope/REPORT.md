# Cebuano card-language audit — report

**Branch:** `cebuano-language-audit` (worktree `/Users/luis/Code/hiraia-card-lang`).
**Not merged, not pushed. `cards.db` was NOT rebuilt. No APK carries any of this.**

Scope: all 47,056 Cebuano cards in `rag/pipeline/cardsPool.app.json`.

---

## 1. What changed

**421 cards repaired** — 151 Cebuano titles and 270 Cebuano bodies. The pool is re-serialised
byte-identically to how it is stored, so the diff is **one line**; review through
`c5a-applied.json` and `c5b-applied.json`, which record old and new text per card.

Every edit passed mechanical gates that were recomputed from the data rather than taken on
trust from the agent that proposed it:

| gate | what it enforces |
|---|---|
| emphasis | every span verbatim in a language's old text is still verbatim in its new text, checked per language against its own text |
| attestation | every word an edit INTRODUCES already appears in ≥3 other Cebuano bodies, or on this card |
| minimality | >30% word churn is held — a repair fixes words, it does not retranslate |
| scope | exactly one field changes |

Measured after writing: **0 cards where any other field changed; orphaned emphasis spans 0
before and 0 after.** Median word churn among applied body repairs: **4.2%**.

## 2. The three biggest findings

**`langgam` means BIRD.** Uniformly, in 680 Cebuano bodies. It was used for ANT across a run of
cards: "worker birds", "how do birds share food", "adult birds cannot spin silk". The corpus's
own word is `hulmigas` (115 bodies). This is the largest confirmed class in the audit.

**A 20-character title truncation bug — and it is not a Cebuano problem.** A length control
isolates it: 128 titles cut mid-word at exactly 20 characters against 2–6 at every neighbouring
length, and the histogram over all 147,468 titles drops from 12,053 at 20 chars to 6,808 at 21
while staying smooth everywhere else. It hits **English 31, Tagalog 48, Cebuano 49**. English
cards ship today as "Energy Without Oxyge", "Glowing Eyes at Nigh", "Geckos Eat Mosquitoe".

Source: `rag/pipeline/fw-gen-card-titles.py:197` and the identical block in `fw-gen-new-titles`
and `fw-gen-topup-titles`. An over-length title is counted (`long_ += 1`) and shipped anyway,
and the trim is a raw `[:TITLE_MAX]` character slice; only `title_en` is measured at all.
**FIXED** in all three generators (commit `5808a1136`) with a `_fit()` that trims whole words
and leaves a title intact rather than severing a word. That stops recurrence. **It does not
repair the already-generated pool, and 128 is a floor** — cuts landing on a word boundary are
indistinguishable from compact titles, and the 20-vs-21 cliff implies thousands.

**`kulob` heads the entire boiling curriculum and means "wrinkled".** 27 Cebuano titles, 25 of
them boiling-point cards — "100 Degrees Kulob Tubig", "373 Kelvin Kulob", "Asin Kulob Taas" —
and **zero** Cebuano bodies, while those same cards' bodies say `mobukal`. The two non-boiling
uses give it away: "Kulob nga Tudlo sa Tubig" = why fingers WRINKLE in water.

## 3. The methodology finding: my own Cebuano was the weakest link

**Three separate rounds refuted entries in the false-friend table I was building.** Each would
have rewritten correct Cebuano:

| round | refuted | corpus evidence |
|---|---|---|
| C4 | `bakal` | 39/39 Cebuano bodies mean iron/steel, zero mean "to buy" |
| C4 | `lana` | Spanish *lana* = wool; ffct-04698 glosses it "**lana o wool**" |
| C4 | `bulok` | the rotten sense is attested; the colour sense takes `bulokon` |
| C4 | `bukal`, `dayami` | half wrong — a hot spring really is `bukal`, rice straw really is `dayami` |
| quarantine | `pako` | 16 bodies pair it with English "nail" against 314 wing uses |
| C5b | `kagang`, `mopalta`, `gasolina`, `sanga` | all four are the corpus's own rendering |

The fix was structural, not a matter of trying harder: **`ceb_usage.py` makes the corpus the
authority** — `--bis <word>` reports what 47,056 cards actually use a word FOR, counting bodies
only so a defective title cannot vouch for itself. Once repair agents were required to run it,
the proposer's HOLD rate went from **0% to 55%**, and the holds read "finding refuted, the
corpus attests the old word".

**A related caution for whoever continues this.** C5a's proposer returned 141 rewrites and
**zero** holds. That is a warning sign, not a success: it means the sourcing constraint was not
actually being applied. Enforce constraints in code, not only in prompts.

## 4. Two negative results, recorded so they are not retried

**Singleton title words.** 1,095 title words appearing in no Cebuano body and no other title.
Recall against the 740 known sweep flags: **50 (6.8%)**, and the list is ordinary title-only
Cebuano. Rarity is meaningless on an OPEN class — the same lesson the Tagalog audit learned.

**Edit-distance variant detection.** An attempt to pre-sort the 138 unattested title words into
"spelling variant" vs "real substitution" by string similarity. It fails both ways: `balhas`
(Tagalog *sweat*) matched `balas` (*sand*, 478 bodies), while `daku`/`itum` — which genuinely
ARE variants of `dako`/`itom` — score 0.75 at four letters and fall below any usable threshold.
String distance is not sense distance.

## 5. What is queued for a Cebuano speaker

Nothing below was written. All of it is a judgement call this audit deliberately refused to make.

| queue | n | why it was held |
|---|---:|---|
| proposer holds (C5b) | 379 | the agent could not prove the defect from the card's own English |
| adversarial rejects | 24 | a second agent judged the old text already correct |
| attestation gate | 20 | the repair needed a word with only 1–2 corpus attestations |
| C5a holds | 16 | including `Igneo` ×6 (legitimate Spanish-derived Cebuano, not a truncation) |
| quarantine survivors | 16 | real defects found under a refuted flag — see below |
| 20-char truncations | 128 | a data repair, separate from the generator fix |
| unattested title words | 138 words / 720 cards | triage 70/138 done, **unverified** |

The most severe quarantine survivors, each provable from the card's own English:

- `ffct-21835` — the NEGATION is dropped: *"Aslom kaayo ang suka aron **mabuhi** ang bakterya"*
  says vinegar is sour SO THAT bacteria CAN live. English: "too acidic … to survive."
- `ffct-20134` — oil **dissolves** in water where the English says it **floats**, on a card about
  why water must not be used on a grease fire.
- `dcard-09616` — *"Sa Dili Pa Mout-og"*. `ut-og` appears in zero bodies and one title; the card's
  own body says `molinog`. A judge read it as obscene; **I could not confirm that** (no standalone
  `utog` anywhere in the corpus), so it is queued as garbled-certain, obscenity-unverified.

## 6. Recommendation

1. **Do not ship the Cebuano repairs on their own timeline.** They are safe — gated, verified,
   measured — but they are 395 cards out of 47,056 and nothing in the app is worse without them.
2. **The truncation bug is the one worth acting on, and the repair is ready.** It is
   English-facing, in a shipped build, the generator fix is landed, and the pool repair is
   mechanical because the full word is on the card in every case.

   **I expected restoring to be a trade-off and it is not.** Restored titles land at 21–23
   characters, which looked like it would overflow a band sized for `TITLE_MAX = 20`. But
   **36.5% of the 147,468 titles already in the pool are longer than 20 characters, 9.2% are
   longer than 27 — the width the generator's own comment says the band fits — and ZERO of the
   restores reach 27.** A 21-character title is unremarkable here. `TITLE_MAX = 20` was the
   defect, not the titles.

   The **26 Cebuano** restores are applied. The **79 English and Tagalog** restores are staged
   in `truncation-repairs.json` and NOT applied, because they are wider than the audit that
   found them — `python3 repair_truncations.py --apply` lands them. That is the decision waiting
   on Luis, and on this evidence it is a low-risk yes.
3. **Queue the 573 held cards for a Cebuano teacher**, unanimity-gated and hard-capped for the
   first batch, exactly as the Tagalog report recommended. The holds are the product here as much
   as the repairs are.
4. **Send the false-friend findings upstream to whoever owns the translation pipeline.**
   `langgam`/`hulmigas`, `kulob`/`mobukal` and `lingkod`/`mokurog` are systematic, not one-off,
   and will recur on the next content build unless the generator's Cebuano lexicon is fixed.

## 7. Files

| file | what |
|---|---|
| `sweep-chunk-{a..e}.json` | the full 337-batch sweep, 801 flags |
| `c5a-applied.json` / `c5b-applied.json` | every repair, old and new, plus every hold and its reason |
| `quarantine-retriage.json` | the 42 contaminated flags re-judged, 26 refuted / 16 survive |
| `c5c-triage.json` | 70 of 138 unattested title words, **unverified** |
| `truncation-20char.json` | the 128 mid-word title cuts, all three languages |
| `truncation-repairs.json` | 105 restores: 26 applied (bis), 79 staged (en/tl) |
| `title-unattested.json` | 138 words / 720 cards |
| `../ceb_usage.py` | the corpus-as-authority tool |
| `../apply_*.py` | the three gated appliers |
| `../PLAN.md` | stage-by-stage log, including every failure |

## 8. Known gaps

- **C5c is incomplete and nothing from it is applied.** 70 of 138 words triaged, **0 verified** —
  every verify agent died on the weekly limit. Its 34 DEFECT claims are unverified and must not
  be applied as they stand.
- No finding here is native-verified. The corpus is the authority used throughout, and the corpus
  is itself machine-translated.
- The sweep's own false-friend table was wrong nine times that are known; there is no reason to
  think that number is complete.
- 128 truncations is a floor, not a census.
