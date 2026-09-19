# Tier-2 judging design — Tagalog question leads (non-counting classes)

Working files:
`/Users/luis/Code/hiraia-card-lang/tools/card-language-audit/runs/2026-09-19-tl-questions/tier2-sample.json`
`/Users/luis/Code/hiraia-card-lang/rag/pipeline/cardsPool.app.json`
`/Users/luis/Code/hiraia-card-lang/tools/card-language-audit/judge.py` (existing harness — the design below drops into it)

I read all 300 sample items against their `fact.en`, `fact.tl` answer line, `title.tl`, `terms` and `emphasis.tl`, and ran corpus-wide counts over all 19,279 question leads.

---

## 1. VERDICT ON THE SWEEP

**Qualified yes — but not the sweep that was proposed, and the money is not where you think it is.**

### Measured defect rate

| tier | what counts | sample | rate | 95% CI (Wilson) | projected to 19,279 |
|---|---|---:|---:|---|---|
| **A — hard defects** | a Filipino teacher would fix without debate; provable from the card's own EN / answer / title | 11/300 | **3.7%** | 2.1 – 6.5% | ~710 (400 – 1,240) |
| **B — A + arbitrable** | plus items needing a native speaker or whole-card work | 35/300 | **11.7%** | 8.5 – 15.8% | ~2,250 (1,640 – 3,050) |

Tier A ids I found: `ffct-33320`, `ffct-24873`, `ffct-18570`, `ffct-32970`, `ffct-20840`, `ffct-34459`, `ffct-21503`, `ffct-35217`, `ffct-37336`, `ffct-24365`, `ffct-00277`.

So the corpus is **not** mostly clean — but it is nowhere near the 30–40% that several of the refuted classes implied, and the honest headline is that **most of the leads are good Tagalog**. 88% of the sample I would ship unchanged.

### Why the LLM cost is irrelevant and the human cost is not

Prompt below is ~550 input / ~40 output tokens per item.

- 19,279 items × 3-model panel on the cheap tier ≈ **$4–8 total**. The existing bake-off spent $0.02 for 8 models × 59 items; this is the same order.
- At a realistic FLAG rate of ~12%, a single judge queues **~2,300 cards** for a human. Gated on 3-model unanimity (which is what gave precision 1.00 in S2), call it **~1,100 cards**.
- A Filipino teacher at 45 s/card = **~14 hours** of arbitration, before any editing. Then the edit pass. Then: **17.3% of question leads (3,326 of 19,279) carry an `emphasis.tl` span inside the lead**, so one edit in six must update `emphasis.tl` in the same change or it silently drops the card's bolding.

**The budget line is teacher-hours, not tokens.** Everything in the design below is aimed at making the human queue small and pre-sorted, not at making the model cheap.

### What to actually fund, in order

**Step 0 — three deterministic enumerations. Free, do them before spending anything.**

Three of the four surviving classes do not need a model at all:

| enumeration | command shape | corpus size | expected real |
|---|---|---:|---:|
| `gawa ng` in a question lead | exact string over leads | **32** (verified) vs 48 `gawa sa`, 7 `Saan gawa`, 73 `bumubuo sa` | 23 material-sense |
| singleton non-word sweep | token freq ≤2 pool-wide, minus English/proper nouns | ~1,900 candidates | ~130–190 (precision ~10%) |
| within-card English self-contradiction | lead has English token X; `title.tl`/`bis`/answer carries the Tagalog | 1,490 leads have an English token absent from the card's own `terms`/`topic`/`title.tl` | ~300–400 |

These are enumerated fix lists a human reads once. No judge needed.

**Step 1 — one narrow LLM pass (~$5).** Exactly one class cannot be enumerated: *the TL lead drops or distorts something the EN lead has, and the TL answer does not restore it in Tagalog*. It is also the biggest class (≈2–4% strict). I tested the obvious prefilter — "EN lead ≥2 tokens longer than TL lead" fires on 11.5% of the pool but catches only 4 of my 9 known cases. **No prefilter; run all 19,279.** It costs less than the prefilter is worth.

**Step 2 — human gate on unanimous FLAGs only, hard-capped at, say, 400 cards for the first batch.** Measure the hit rate on that batch before authorising the rest. If unanimous-FLAG precision comes in under ~0.7, stop.

### The uncomfortable part

The single highest-value defects I hit while reading are **not language defects at all**, and the project rule ranks them above fluency:

- `dcard-04970` asks which cleanser is the *better buy*; the answer never mentions price.
- `ffct-09227` "Bakit parang umuugong ang tainga...?" → answer restates the premise and explains nothing.
- `ffct-36052` says jars are shaped by *alahero* (jewellers) in Vigan; the word is *magpapalayok*.
- `ffct-21283` "nagiging likidong batter sa matigas na cake" inverts the direction of the change.

If there is one sweep to fund, **it is an answer-quality pass, not a lead-language pass.** I would fund Step 0 (free) + Step 1 (~$5) for language, and put the teacher-hours into answers.

---

## 2. THE RUBRIC — paste-ready judge prompt

Design decisions, because they are load-bearing:

- **The judge never sees the lead alone.** Every over-flag in the refuted classes came from judging a lead in isolation. Almost every *genuine* defect in this corpus is provable as a **within-card contradiction** — the card's own answer, title, or English original disagrees with its own lead.
- **The model must quote the contradicting text.** If it cannot quote it, it must PASS. This is the anti-prescriptivism mechanism: it makes "sounds off to me" structurally impossible to express.
- **Binary verdict + closed slug + `native` boolean**, so it scores in `judge.py`'s existing `score()` (FLAG↔BROKEN, PASS↔CORRECT) with precision and recall on FLAG reported separately.

```
You audit ONE Tagalog question that opens a science card for Filipino grade-5 children
(readers are behind grade level). Accuracy outranks Tagalog fluency.

You are shown the whole card. FLAG only when the card CONTRADICTS ITSELF or contradicts
its own English original. If you cannot quote the contradicting text from the card, PASS.

FLAG only for one of these six, and only with a quote:
  en-mismatch   TL lead drops or replaces a detail in EN_LEAD, and TL_ANSWER does not
                restore it in Tagalog. (EN "iron nails / copper coins" -> TL "mga pako sa barya")
  answer-clash  TL lead states/asks something TL_ANSWER contradicts: wrong unit, wrong
                quantity, wrong entity, or asks paano when the answer gives bakit.
  nonword       a token in TL_LEAD is not a word in Tagalog, Filipino, English or Spanish —
                a typo or malformed coinage. ("Ilanong" for ilang; "lumilikod" for lumiliko)
  no-predicate  TL_LEAD has NO predicate at all. Tagalog predicates may be nominal,
                adjectival, locative or existential — absence of a VERB is NOT this.
  own-tagalog   TL_LEAD uses an English word while THIS CARD's own TITLE_TL, TERMS or BIS
                line already uses the Tagalog form for it.
  gawa-ng       "gawa ng X" where EN says made of/from (material). Material is "gawa sa X" /
                "Sa ano gawa ang X?". "gawa ng X" = made BY X.

NOT defects. Never flag these:
  - "ay" inversion (Ang X ay Y) — DepEd-standard written Filipino.
  - no verb; nominal/adjectival/locative predicate ("Bakit asul ang langit?").
  - no ang-subject ("Bakit nangangati sa gabi...?") — normal impersonal Tagalog.
  - genitive actor under a pseudo-verb: kailangan/gusto/ayaw/pwede + ng-actor.
  - adjective/adverb + bare verb with no linker ("mas mataas tumalbog", "Gaano kalayo
    makakalipad ang X?").
  - English science vocabulary the child meets in DepEd class (matter, energy, lever,
    suspension, periodic table, Earth, cholesterol) or a proper name (Mayon, Magat Dam).
  - a term the card exists to teach, incl. anything in TERMS or EMPHASIS_TL.
  - English plural -s after mga or a numeral; Tagalog affix on an English root
    (nag-a-accelerate, i-recycle, nag-trip).
  - everyday borrowings (purple, rainbow, fluffy, soda, helmet); hyphen style
    (pinaka-sariwa, ka-init); spelling variants (paruparo / paru-paro).
  - deictic ito/iyon/dito, "Alam mo ba" hooks, first-person ko, iyong, repeated roots,
    long leads, parentheses/quotes/symbols, and disagreement with OTHER cards.
  - anything you would call clunky, bookish, colloquial, or regional. Register variation
    is not a defect. Wrong facts and broken words are.

EN_LEAD: {en_lead}
TL_LEAD: {tl_lead}
TL_ANSWER: {tl_answer}
TITLE_TL: {title_tl}
TERMS: {terms}

Reply with ONE line of JSON, nothing else:
{"v":"PASS"}
or
{"v":"FLAG","c":"<slug>","q":"<<=12 words quoted from the card that prove it>","native":true|false}

Set "native":true if a Filipino teacher should arbitrate before anyone edits.
```

Operational notes:

- Run the same 3-model panel S2 validated (`google/gemini-3.5-flash-lite` + `openai/gpt-5-nano` + `inclusionai/ling-3.0-flash`); **act only on unanimous FLAG**. S3 already showed the panel flips on byte-identical input at temperature 0, so treat 2-1 splits as noise and re-run at n=3.
- The `q` field is the review artefact. A human skims quotes, not cards.
- Any output with `"c"` outside the six slugs, or with `q` not a substring of the card, is discarded as unparseable — not scored as PASS.

---

## 3. MINI GOLD SET — 30 items

Drawn from the 300-item sample. **Enriched: 15 FLAG / 15 PASS. This is NOT a prevalence estimate** (true rate is 4–12%); it exists to measure precision and recall separately, as `judge.py` already does. Labels are mine, not native-verified; `native: yes` rows should be settled by a Filipino teacher before they gate anything.

### FLAG (15)

| # | id | Tagalog lead | class | native | why |
|---|---|---|---|---|---|
| 1 | ffct-33320 | Ilanong oras bago marating ng liwanag ng Araw ang Earth? | nonword + answer-clash | no | "Ilanong" exists on 2 of 49,156 cards; and the lead says *hours* while its own answer says "halos 8 minuto". |
| 2 | ffct-24873 | Nag-a-accelerate ba ang kotse kapag lumilikod? | nonword | no | "lumilikod" 1 lead vs "lumiliko" 5; EN is "when it turns". `Nag-a-accelerate` is NOT the defect — it is `emphasis.tl`. |
| 3 | ffct-18570 | Gaano ka-angkop ang temperatura ng kwarto mo ngayon? | en-mismatch | no | EN is "How warm"; ka-angkop = how *suitable*; answer gives 20–25 °C. Near-duplicate ffct-18823 says "Gaano ka-init". |
| 4 | ffct-32970 | Bakit matigas na bato tulad ng granite sa kalsada, pero malambot na limestone sa gusali? | no-predicate | no | EN "Why do builders **use**…"; verb and ang-pivot both gone — NP+PP with nothing predicated. |
| 5 | ffct-20840 | Alam mo ba kung ano ang gawa ng Chocolate Hills? | gawa-ng | no | Its own next line reads "Gawa sila **sa** solid limestone". Self-refuting. |
| 6 | ffct-34459 | Ano ang gawa ng outer core ng Earth? | gawa-ng | no | EN "made of"; the agentive reading is a competing *true* fact (the outer core does generate the field), so the ambiguity teaches wrongly. |
| 7 | ffct-21503 | Paano hihiwalayin ng neodymium magnet ang mga pako sa barya? | en-mismatch | no | EN names **iron** nails / **copper** coins — the whole physics; answer restores only in English. PH coins are magnetic, so a kid testing it gets the opposite result. |
| 8 | ffct-35217 | Ano ang amihan season? | own-tagalog | no | `title.tl` = "Panahon ng Amihan"; body reads "Sa panahon ng amihan season" — tautology. ⚠ `emphasis.tl` = ["amihan season"] must move with the edit. |
| 9 | ffct-37336 | Bakit nag-o-order ang authorities ng evacuation kapag nagpapakita ng danger signs ang bulkan? | own-tagalog | no | The card's own `terms` carry awtoridad / paglikas / panganib; `title.tl` = "Paglikas sa Bulkan". Answer adds "ash, gas, at fast-moving flows". |
| 10 | ffct-24365 | Bakit mas mahirap isagwan ang banca kapag mabigat ang lulan? | own-tagalog | no | `title.tl` = "Mabigat na **Bangka**"; `banca` 5 leads vs `bangka` 18. Pure orthographic self-contradiction. |
| 11 | ffct-13153 | Ilang uri ng reef fish ang nasa Pilipinas? | own-tagalog | no | `title.tl` = "Isda sa Bahura"; ffct-14328 *in the same sample* writes "isda sa bahura". |
| 12 | ffct-01188 | Gaano kalayo makakalipad ang Draco? | en-mismatch | no | **Hard case.** EN "Draco **lizard**"; nothing anywhere on the card tells the child Draco is an animal. The *construction* (Gaano ka-ADJ + bare verb) is correct and must not be flagged. |
| 13 | dcard-06801 | Bakit gumagamit ng maliwanag na ilaw ang mga mangingisda tuwing new moon? | own-tagalog | yes | The card's own `bis` says "bag-ong bulan"; grade 3; DepEd term is "bagong buwan". ⚠ `emphasis.tl` = ["new moon"]. |
| 14 | ffct-06945 | Anong kilalang sintomas ng rabies may kinalaman sa tubig? | no-predicate | yes | Heavy NP abuts a predicate with neither `ang` nor `na`; garden-paths on "rabies may kinalaman". ~10 such long-NP cases corpus-wide. |
| 15 | ffct-03685 | May daga bang tanging dito lang? | no-predicate | yes | The post-nominal modifier has no predicate to hang on ("May daga bang **matatagpuan** dito lang?"). "tanging…lang" is idiomatic and is NOT the defect. |

### PASS (15) — traps a bad judge fires on

| # | id | Tagalog lead | why it must PASS |
|---|---|---|---|
| 16 | ffct-21762 | Bakit ang purong tubig ay neutral? | `ay` inversion is DepEd-taught *di-karaniwang ayos*; the card's own body uses it too. |
| 17 | ffct-11528 | Bakit kailangang laging lumangoy ng ilang pating? | Pseudo-verb `kailangan` takes a genitive actor. "ang ilang pating" would be the error. |
| 18 | ffct-26046 | Bakit asul ang langit? | Verbless adjectival predicate — the Tagalog norm; 32/300 sample leads have no verb and ~30 are impeccable. |
| 19 | ffct-31173 | Pwede bang niyebe sa bundok habang umuulan sa kapatagan sa ibaba? | `pwede` + nominal complement is productive (ffct-04270, ffct-11581). "mag-niyebe" occurs 0 times. |
| 20 | ffct-02909 | Bakit nangangati sa gabi dahil sa pinworm? | Zero-subject sensation verb; 502 of 4,869 bakit-leads have no ang/ay/pronoun and are fine. |
| 21 | ffct-19392 | Bakit ito tinawag na polonium? | Cataphoric `ito` licensed by the naming predicate; 11 cards use this template. |
| 22 | ffct-37554 | Bakit mas mataas tumalbog ang bola sa matigas na sahig? | Linkerless ADJ+verb is the corpus **majority** (143 vs 25). |
| 23 | ffct-19325 | Bakit malambot at fluffy ang mamon? | EN is "so fluffy **and** soft" — two properties, not a double gloss. "mahimulmol" would mean linty. |
| 24 | ffct-07864 | Saan gawa ang matigas na kalansay ng coral? | The correct material frame — the positive control for `gawa-ng`. |
| 25 | ffct-18205 | Anong tatlong subatomic particles ang bumubuo sa atom? | Numeral + English plural is corpus-normal (408 instances); its own body says protons/neutrons/electrons. |
| 26 | ffct-12776 | Kung nasilawan ang cave fish, babalik na ba agad ang mata nito? | Completed aspect in a `kung`-protasis is the canonical Tagalog conditional. |
| 27 | ffct-27165 | Bakit lumilitaw ang magagandang rainbow sa Subic Bay pagkatapos ng ulan? | **Hard.** `bahaghari` beats `rainbow` 39:2 corpus-wide — but this card is internally *consistent* (answer + `bis` + `emphasis.tl` all say rainbow). House style, not a card defect. `native: yes`. |
| 28 | ffct-24544 | Alam mo ba na ang cheetah ang pinakamabilis na hayop sa lupa? | "Alam mo ba" is authored in EN (354 cards) and the body adds 100 km/h + tires quickly. Not self-answering. |
| 29 | ffct-25297 | Bakit pula ang itsura ng mansanas? | EN "look red". `itsura` IS the science — removing it asserts the naive intrinsic-colour premise the card corrects. |
| 30 | dcard-04970 | Alin ang mas magandang bilhin: 4.5% cleanser sa 500 ml o 4.5% cleanser sa 1 liter? | **Hard.** The Tagalog is fine; the defect is that the answer never mentions price. Out of scope for a language judge — route to an answer-quality check. |

---

## 4. WHAT NOT TO DO

Twenty classes were proposed; sixteen were refuted. Every one of them would have fired on thousands of correct cards. These are the specific traps.

1. **Do not judge the lead in isolation.** This single mistake produced most of the refuted classes: "invertebrate is never glossed" (it is, twice), "the answer reveals nothing" (it does), "the term is unexplained" (the next line explains it). The judge must see EN, answer, title and terms.

2. **Do not treat "no verb" or "no ang-subject" as a defect.** Tagalog has nominal, adjectival, locative and existential predicates. 32/300 sample leads are verbless and ~30 are excellent. 730 of 19,279 leads contain no `ang`/`ay`/`may`/pronoun. A rule keyed on this flags ~2,000 good cards.

3. **Do not touch `ay`.** It is DepEd-standard, it appears in 47% of card **bodies**, and de-`ay`-ing 219 leads while 9,097 bodies keep it creates a lead/body split for zero gain. The proposed rewrite of ffct-23573 also injected a false "rin".

4. **Do not require linkers that Tagalog does not require.** "mas mataas tumalbog", "Gaano kalayo makakalipad", "madalas umuwi" — the linkerless form is the corpus majority (143 vs 25) and the natural spoken form. Enforcing `na` would target ~476 correct cards.

5. **Do not "correct" the pseudo-verb genitive actor.** `kailangan/gusto/ayaw/ibig/pwede` + `ng`-actor is textbook (Schachter & Otanes). "ang ilang pating" is the calque.

6. **Do not de-English DepEd vocabulary.** Science is English-medium from G3/G4. `matter`, `suspension`, `lever`, `periodic table`, `Earth` (1,463 vs Mundo 959) are the words on the child's worksheet. Replacing them reduces transfer to school and violates accuracy-over-fluency.

7. **Do not run a bare "English word exists in Tagalog" rule.** It fires on `purple` (31 uses, and "Bakit purple ang ube?" is unimpeachable), `rainbow`, `fluffy`, `soda`, `Mayon Volcano`, `Magat Dam`, `PHIVOLCS`, `evacuation` (corpus-majority English, 35:32). The only safe version is the *within-card* test: does **this card's own** `title.tl` / `bis` / `terms` already carry the Tagalog?

8. **Do not strip English plural -s or Tagalog-affixed English verbs.** `mga petals`, `tatlong subatomic particles` (numeral+plural: 408 instances), `nag-trip`, `i-recycle`, `nagre-react` are mainstream written Filipino. "mga petal" and "90 degree" are the deviant forms. And 21 of 24 affix-hyphen cards repeat the English root in their own `terms` — rewriting the lead decouples retrieval from the printed text.

9. **Do not normalise orthography or spelling variants at scale.** `paruparo`/`paru-paro` (both standard, 36 vs 7), `pinaka-sariwa` (168 leads), `ka-init` vs `kaingit` — invisible to the reader, and `ka-init`'s hyphen arguably blocks a misparse. Churn.

10. **Do not chase cross-card consistency.** Cards are served one at a time in a shuffled feed. `Earth`/`Mundo`/`Daigdig`/`Lupa`, `scientist`/`siyentipiko`, `parte`/`bahagi` — a deck-wide harmonisation touches ~2,100 cards, risks semantic breakage (`lupa` = soil/land 2,601 times; `mundo` = world), and delivers nothing a child perceives. `ffct-38824` needs `lupa`=land AND `Earth`=planet in one sentence.

11. **Do not flag deixis, hooks, length, quotes, symbols or first-person voice.** `ito`/`iyon`/`dito` are anchored by the naming predicate or by the card's own title band; "Alam mo ba" is the deck's best register and is authored in EN on 411 cards; `Ω`/`(aq)`/`(February)` are inaudible to the shipped TTS tokenizer and sometimes *are* the lesson; `ko` mirrors a first-person EN source on 63 of 64 cards.

12. **Do not let a "fix" introduce a fact.** This happened repeatedly in the proposals: "nilalagyan ng asukal ang nata" (sugar goes into the coconut water), "Bumibilis ba ang kotse kapag lumiliko?" answered "Oo!" (false physics), "enerhiya mula sa alon" for tidal energy, "bilis ng liwanag at iba pang alon" (sound waves do not travel at 3×10⁸ m/s), "hinalong harina" for bibingka (rice flour, not wheat), "ang elementong ito ni Marie Curie" (she did not own polonium). **Any rewrite that changes a content word must be re-checked against the answer.**

13. **Do not edit a lead without editing the card.** 3,326 leads (17.3%) contain an `emphasis.tl` span — an unmatched edit silently kills the bolding. Retrieval `terms` index the English surface forms. `bis` and `en` must stay in sync. A lead-only word swap is literal churn on at least two of the cases proposed above.

14. **Do not automate any of this.** Even the two confirmed non-words are pool singletons — there is no regex for a long tail of unique typos, and the rare-token sweep that finds them runs at ~10% precision, with false positives that are ordinary Filipino words a naive scrubber would "fix" into worse cards.