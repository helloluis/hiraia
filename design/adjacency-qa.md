# Card-feed adjacency QA — "does the next card make sense after this one?"

Instrument: `packages/mobile/scripts/card-adjacency-qa.mts` (imports the real `nextChoices`,
walks the graph the way `cardStore.advance()` does, emits every adjacent pair).
Judged sample: `/tmp/adjacency-pairs.json` (300 pairs written by every run).

Measured 2026-08-22, 30 walks × 60 cards = 1,770 adjacent pairs, seed 20260822, Tagalog.
`cards.ts` before = `76acb02e` (HEAD `ca4bc734`), after = `cd4ea1d1` (working tree).

---

## 1. Integrity

| check | result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| `RUNS=8 CARDS=60 npx tsx scripts/card-harness.mts` | 0 dead-ends, 0 duplicate labels, 0 weak labels, 0 repeats, **same illustration as previous card 0.0%**, reused within 3 pages 0.0%, fork 11.9% (mean gap 7.9) |
| composition of the three parallel edits | clean — `cardStore` passes `recentIds` at all four `nextChoices` call sites (hydrate / jumpToRandom / navigateTo / advance); the harness passes it too; the QA script auto-detects the wiring and reports `trail: ON` |
| `npm run lint` | broken repo-wide at HEAD (typed-linting `parserOptions.project` missing) — pre-existing, not from this work |

The only real composition risk was an inert fix (graph accepts `recentIds`, store never sends
it). The QA script prints a WARNING in that case; it currently prints
`illustration-cooldown trail: ON (graph supports recentIds, store passes it)`.

## 2. Deterministic metrics — before vs after

Both columns are the **same instrument, same seed, same walk count**; "before" was produced by
running the current QA script against a detached `git worktree` at HEAD (pre-fix `cards.ts` +
pre-fix `cardStore.ts`), so this is a genuine A/B of the fix, not a knob flip.

| metric | brief (pre-fix, other seed) | before (HEAD, seed 20260822) | after | verdict |
| --- | --- | --- | --- | --- |
| same illustration slug, adjacent pair | 26.3% | **22.09%** | **0.00%** | fixed (chance floor 0.13%) |
| slug repeat within 3 cards | — | 27.23% | 0.00% | fixed |
| slug repeat within 5 cards | — | 27.63% | 0.00% | fixed |
| distinct slugs / cards per walk | — | 70.94% | 97.17% | better |
| text jaccard > 0.50 (near-identical) | 0.5% | 0.85% | **0.06%** | fixed |
| text jaccard > 0.30 (heavy restatement) | — | 7.01% | **1.47%** | much better |
| zero shared terms | 0.4% | 4.41% (0.24% on deep steps) | 3.90% (**0.00%** on deep steps) | random fallback gone; residual is lateral-by-design |
| suspect rate (≥1 defect flag) | — | 22.77% | 0.23% | better |
| shared terms, mean | — | 3.33 | 2.76 | *lower* — see note |
| idf overlap, mean | — | 0.4766 | 0.3774 | *lower* — see note |
| weak link (1 shared term, df ≥ 58) | — | 0.11% | 0.17% | flat/noise |
| fork rate | — | 11.36% | 11.58% | flat |
| dead-end escapes | — | 0.40% | 0.40% | flat |
| cross-domain lateral | — | 26.27% | 32.54% | more variety |

Note on the two "worse" rows: term overlap fell because the *near-twins* were removed. The old
graph scored high on term overlap partly by serving restatements of the same fact. Lower
overlap here is the cost of that removal, not a regression in relatedness — the judged
distribution below is the check that matters.

## 3. Human judgement (120 random pairs from `/tmp/adjacency-pairs.json`)

Same rubric applied to 40 random pre-fix pairs (from the HEAD worktree run) for comparison.

| verdict | before (n=40) | after (n=120) |
| --- | --- | --- |
| good — related and additive | 32.5% (13) | **43.3%** (52) |
| acceptable — loose but pleasant | 20.0% (8) | **27.5%** (33) |
| repetitive — restates card A | 27.5% (11) | **10.0%** (12) |
| non-sequitur — jarring, no connection | 20.0% (8) | **19.2%** (23) |
| **defect total** (repetitive + non-sequitur) | **47.5%** | **29.2%** |

By step type, after the fix: deep steps (110 judged) 10.9% repetitive, 18.2% non-sequitur;
lateral steps (10 judged) 1 good / 6 acceptable / 3 non-sequitur. The pre-fix sample is small
(n=40, ±~14pp on any single cell) — treat the repetitive drop as real (it is corroborated by
jaccard>0.30 falling 7.01% → 1.47%) and the non-sequitur row as **unchanged**.

**Headline: the fix killed the repetition class and did nothing for the semantic class.**

### The 5 worst pairs (verbatim, all `deep` steps — the app's default "next")

1. **`bleach` is a false friend** (`vinegar-bottle-suka` → `coral-bleaching-process-diagram`, 0 jaccard, shared term `bleach` df 5)
   - A: "Ano ang mangyayari paghahaluin ang bleach at suka? Huwag ihalo ang bleach sa suka o ibang asido dahil makakabuo ito ng nakakalasong gas!"
   - B: "Bakit nagiging puti ang coral? Kapag sobrang init ng tubig-dagat, itinataboy ng coral ang kanyang zooxanthellae at nagiging puti. Ito ang tinatawag na coral bleaching."
2. **A number word as the link** (`sun-spots-surface` → `etruscan-shrew`, shared term `libo` = "thousand", df 4)
   - A: "Gaano kainit ang ibabaw ng Araw? Sobrang init! Ang ibabaw ng Araw ay napakainit, umaabot sa libu-libong digri Celsius."
   - B: "Aling hayop ang may pinakamabilis na tibok ng puso? Ang puso ng Etruscan shrew ay maaaring tumibok ng mahigit 1,000 beses kada minuto — isa sa pinakamabilis sa lahat ng hayop!"
3. **A Cebuano adjective as the link** (`ozone-layer-protection` → `barquillos-rolled-wafer`, shared term `matahum` = "beautiful", df 2 — rare, so the link gate waved it through)
   - A: "Ang stratosphere ay nasa itaas ng troposphere at may ozone layer. Kalmado ang hangin dito kaya lumilipad ang mga jet airplane dito!"
   - B: "Ang barquillos ay manipis na masa na iniluluto sa mainit na bakal hanggang tumigas! Habang mainit pa, ito ay iginugulong para maging malutong na tubo."
4. **An English noun as the link** (`light-reflection-mirror` → `mixture-heterogeneous`, shared term `strips`, df 2)
   - A: "Magsuot ng retroreflective strips sa gabi! Binabalik nila ang ilaw ng headlights sa driver, kaya super nakikita ka at iwas-aksidente!"
   - B: "Ano ang bumubuo sa tradisyonal na salakot hat ng mga Pilipino? Ito ay isang heterogeneous mixture ng mga hinabing matibay na rattan strips at resin!"
5. **A colour word as the link** (`rust-flaking-corrugated-roof` → `moon-orbiting-earth`, shared terms `reddish` + `during`)
   - A: "Napapaisip ka ba kung ano ang mapulang-kayumangging bagay sa mga bubong? Ang kalawang na lumilitaw sa bakal na bubong tuwing tag-ulan ay isang kemikal na pagbabago na gumagawa ng iron oxide!"
   - B: "Sa total lunar eclipse, nagiging pulang-kahel ang buwan dahil ang atmospera ng Earth ay nagbe-bend ng sunlight palibot sa planeta para ilawan ito!"

Runners-up in the same class: `runoff flows downhill` → `playground slide is an inclined plane`
(link `bababa`, "goes down" — the slide card is an attractor, it turned up twice in 120),
`grilling corn sa tabing-kalsada` → `rain tree planted along roads` (link `kalsada`),
`bearded pig spreads seeds` → `sugar dissolves and spreads` (link `nagkalat`).

### The worst survivors of the repetitive class (different pictures, same fact)

- `drum` → `tambol-marching-drum`, jaccard 0.44: "Paano lumilikha ng tunog ang tambol? … pinalo ang nakaunat nitong balat" → "Paano gumagawa ng tunog ang tambol? Kapag pinukpok, nayayanig ang nakaunat na balat nito!"
- `oyster-mussel-farm-scene` → `oyster-talaba`, jaccard 0.30: "Gaano karami ang masasala ng isang talaba? Ilang dosenang litro sa loob ng isang araw lang!" → "Isang talaba lang ay nakakasala na ng maraming litro ng tubig sa loob ng isang araw."

## 4. What the fix actually changed

1. **Illustration cooldown** (`SLUG_COOLDOWN = 5`): the current card's slug plus the last five
   trail slugs are unservable for both deep and lateral picks. `cardStore` passes its existing
   `recent` id trail (`RECENT_WINDOW = 5`). This is the whole of the 22% → 0% move; it also
   removes most of the near-identical wording, because restatements of one fact share a picture.
2. **Link gate on the deep pick**: `mass >= 0.02` and (`count >= 2` or `minDf <= 10`) — mass
   rather than a raw term count, because the bank's terms are trilingual and one concept in two
   languages counterfeits "two shared terms".
3. **No silent random fallback**: a dead end now offers two honestly-labelled `lateral` choices
   instead of `pick(others)`. Deep-step zero-overlap is now 0.00%.
4. **Near-dup cap 0.55 → 0.25** and a **text-jaccard cap of 0.35** on the winning candidate.

## 5. What is still wrong

- **The semantic band is untouched: ~19% of adjacencies are non-sequiturs.** Every one of the
  worst pairs above passes the term gate on a *rare* shared token that is not a topic —
  a number (`libo`), a colour (`reddish`), a Cebuano adjective (`matahum`), an English homonym
  (`bleach`, `strips`). Rarity is not aboutness. Only a semantic signal fixes this: the funded
  LaBSE embedding graph, or (cheaper) a stop-list pass over `terms[]` for numerals, colours,
  bare adjectives and function words, which the same data build has to do anyway.
- **~10% still read as restatements** — different picture, same fact
  (`drum` → `tambol-marching-drum`). The slug rule cannot see these and the 0.35 text cap only
  catches shared *vocabulary*, not shared *claims*.
- **Attractor cards**: the playground-slide inclined-plane card and the bahay-kubo/nipa cluster
  turn up disproportionately as deep destinations.
- **`packages/web/src/data/cards.ts` is a hand-synced port that still has the old
  `nextChoices`** — the web demo will keep repeating illustrations until it is ported
  (5 call sites in `packages/web/src/store/useCardDemoStore.ts`).
- Term overlap is genuinely lower now (3.33 → 2.76 mean). If a future change pushes
  `sharedTermsMean` back up *without* moving the judged distribution, suspect restatements.

## 6. Re-running this QA (one command)

```bash
cd packages/mobile
npm run qa:adjacency          # RUNS=30 CARDS=60 SAMPLE=300, seed 20260822, writes /tmp/adjacency-pairs.json
npm run qa:cards              # the older behavioural harness (dead-ends, labels, quiz shape)
```

Knobs (all optional): `RUNS`, `CARDS`, `SAMPLE`, `SEED`, `LANG_CODE` (**not** `LANG`, the shell
owns that), `TRAIL=on|off` to force the illustration cooldown, `OUT=` to write the judged sample
elsewhere, `BASELINE=` to print a BEFORE → AFTER table:

```bash
OUT=/tmp/before.json npm run qa:adjacency            # save a baseline
BASELINE=/tmp/before.json npm run qa:adjacency       # delta table vs it
```

The header prints a sha1 of `cards.ts`, so a run can never be silently attributed to the wrong
revision, and the delta table refuses to hide an A/A comparison.

To re-measure a **pre-fix** baseline from any old revision (this is how the "before" column
above was produced):

```bash
git worktree add --detach /tmp/hiraia-base <rev>
cp packages/mobile/scripts/card-adjacency-qa.mts /tmp/hiraia-base/packages/mobile/scripts/
(cd packages/mobile && OUT=/tmp/adj-prefix.json RUNS=30 CARDS=60 SAMPLE=300 \
   npx tsx /tmp/hiraia-base/packages/mobile/scripts/card-adjacency-qa.mts)
git worktree remove /tmp/hiraia-base
```

The script resolves its own directory, so it measures the *old* graph while running under the
current toolchain; the old `cardStore` has no `recentIds`, so `trail: OFF` is detected
automatically.

Judging step: the run writes 300 sampled pairs with `fromTl/toTl`, `fromEn/toEn`, `step`,
`sharedTerms`, `rarestSharedDf`, `jaccard` and `flags`. Take a random 120 and score each
good / acceptable / repetitive / non-sequitur (rubric in §3). Machine metrics cannot see the
non-sequitur class — that judged pass is the only instrument for it.
