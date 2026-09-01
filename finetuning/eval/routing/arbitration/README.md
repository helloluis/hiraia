# Query-arbitration gate

**Not the same thing as `../` (the template-routing benchmark).** That one asks *which language
does the model reply in*. This one asks *which of four things should happen at all* when a child
types into the feed's search box — and it needs no model to answer.

```bash
finetuning/eval/routing/arbitration/run-arbitration.sh          # boots LaBSE, runs 118 gating cases
BUCKETS=out-of-scope ./run-arbitration.sh                       # one bucket
CASES=gravity,tsunami ./run-arbitration.sh                      # substring id filter
SET=tuning ./run-arbitration.sh                                 # one half (never a verdict)
JSON_OUT=/tmp/arb.json ./run-arbitration.sh                     # dump for a diff
```

## What is being arbitrated

| outcome | meaning | who decides |
|---|---|---|
| `served-existing` | an authored card already answers it — serve **that** card | `searchCards` (`cards.ts`, `SEARCH_FLOOR` 0.34) |
| `generated` | nothing answers it but grounding exists — the model writes one | retrieval has hits |
| `gap` | in domain, nothing retrievable — *"I don't have a page about that yet"* | `lexEmpty` / no hits |
| `offdomain` | not science — *"I'm only a science tutor"* | `isOffDomain(topCos, lexUnreachable)` |

`served-existing` is the outcome worth fighting for: authored prose, a verified illustration, a
title, emphasis spans, quiz linkage. Today the arbitration is **sequential** — `cardStore.ts`
runs `searchCards` first and only on a miss falls to `answerQuery`, which then splits
gap/offdomain. So search does not merely compete for the answer; when it is confident, **nothing
else gets a vote**, which is exactly why an over-eager search is invisible to every other
instrument in the repo.

## Why it exists

Measured on the web subset: **36 of 38 natural questions returned a confident existing card and
they were the WRONG cards** — *"what is gravity"* → mangroves, *"what is a tsunami"* → mangroves,
*"how hot is lightning"* → 0.802 on *"fireflies are beetles"*. A tightening landed on **web
only**; mobile's `searchCards` has not been tightened. Latency is not the problem: search is
0.08 ms p50 / 1.15 ms max over all 46,421 cards against 3–8 s for a generation, so search-first
is right and a "race" would abort a generation on every query for zero gain.

## Two halves, and the gate is green only when BOTH are

`cases.json` is the **tuning set** (94 gating + 4 aspirational). `cases-holdout.json` is a
**sealed holdout** (24) — same buckets, same derivation method, different strings.

It exists because the gap/offdomain split is decided by **one LaBSE cosine whose two expected
classes are provably not separable**: measured here, gap-expected cases span 0.561–0.682 and
offdomain-expected span 0.345–0.694, and the off-domain items are on average *higher*. So the
cheapest way to turn a single-file suite green is a ~14-entry proper-noun denylist
(`spiderman`, `jollibee`, `roblox`, `taylor`, `darna`, …) — precisely the heuristic
intent-detection `CLAUDE.md` forbids — and a suite whose every string is committed cannot tell
that apart from a real fix. A change that passes the tuning half and fails the holdout is a
**memorised** fix. Do not tune against the holdout; if you find yourself editing it to make a
change pass, the change is what is wrong.

## Every case asserts BOTH halves

What happened **and** what did not:

- **`served-existing`** — search served a card **AND** it is one of the ground-truth ids. Serving
  a *different* card is reported as `served-wrong` and is a **FAIL**. `served-wrong` is not an app
  state; it is this gate's name for the mangrove bug, and it exists so the bug cannot hide inside
  a clean-looking diagonal in the confusion matrix.
- **`generated`** — search **explicitly declined** (`best === null`) *and* the route reached
  generation. A case that only checked "a card came back" could not tell right from wrong.
- **`gap` / `offdomain`** — the model-free path fired **and the other one did not**. Confusing
  these two is the product's worst failure: telling a child their real science question is
  off-topic.
- **`misspelling` / `tokenisation`** — `served-existing` *or* `generated` both pass, and
  `offdomain` is a **hard** failure whatever else happened.
- **`chitchat`** — `offdomain` *or* a card **from the on-topic accept set**. "gusto ko ng ice
  cream" may be declined politely or answered with *ice cream melts from solid to liquid*; what it
  may not be answered with is a random card (baseline: *agar carrageenan* at 1.000).

## Ground truth

Never intuition. Every expectation is derived from `packages/mobile/assets/data/cards.db`
(46,421 cards / 50,279 facts) plus the pool in `cardsIndex.generated.json`:

- *has a card* required **reading the card text**, not just a topic-word hit.
- *no card* required a topic/terms probe **and** a `LIKE` over card prose in en+tl+bis to both
  come back empty. Two cases were reclassified mid-design when the prose probe contradicted the
  topic probe (`unsa ang RICE first aid para sa pilay` → ffct-24083 exists; `bakit hindi masakit
  ang gupit ng buhok` → ffct-02110 exists). A topic probe alone produces false absences — that is
  a standing method caveat for anyone adding cases.
- `generated` vs `gap` was then decided **purely** by whether the fact bank grounds it. Card
  domains are only LIVING_THINGS / EARTH_SPACE / MATTER / FORCE_MOTION_ENERGY, so all 3,019
  PH_GEOGRAPHY and 2,849 PH_CIVICS facts are **uncarded** — that disjointness is what makes
  `generated` derivable rather than guessed.
- Accept sets are pinned three ways and materialised at run time, with the resulting count
  printed, so a set that silently empties (a renamed topic, a re-minted id) is a visible failure
  rather than a free pass:
  - `acceptIds` — an explicit id list, where the answer is one card.
  - `acceptRule` — `{topic, domain?}` regex over the card's own topic/`title_en`; `domain` is a
    full-match regex so a sense can span two domains (`MATTER|LIVING_THINGS`).
  - `acceptProse` — regexes over the card's own **body text**, for answers that live only in the
    prose. *"how hot is lightning"* is the case in point: ffct-35303's text is literally the
    query while its topic is just *"Weather/Lightning"*, so a topic rule scored the right card as
    `served-wrong`.
- **Accept regexes carry their own anchors, and that is load-bearing.** Unanchored, `/rock/`
  admitted 38 rocket-propulsion cards, `/nail/` admitted 130 snail cards, `/mayon/` admitted
  mayonnaise and `/pulse/` admitted nerve impulses — so a wrong card scored PASS. A *leading*
  `\b` is only added where the stem has a false friend: `\bvolcan` would have thrown away nine
  legitimate *stratovolcano* cards, and `\bgravity\b` throws away `gravity_tool`.
- The two **polysemy** cases (`araw` = sun/day, `bato` = rock/kidney) are pinned to cards whose
  *subject* is one of the senses, not to every card that mentions one: at 920 members an accept
  set certifies nothing, and "mud protects carabao skin from the sun" is not an answer to
  *"araw"*.

## Language: the query's vs the app's

`answerQuery` reads `this.config.language` — **not** the language of the query — for retrieval
*and* for the spelling probe (`LocalEngine.ts`, `ragLang`). So each case carries two fields:
`lang` documents the query, `configLang` is what the gate routes on, defaulting to the shipped
`DEFAULT_LANGUAGE` (`tagalog`). It matters: `bulkano` is `generated` under Tagalog config and
`gap` under English; `narwhal` is `offdomain` under tl/en and `gap` under Cebuano. Four
`xlang-*` cases exercise the mismatch deliberately, since a Tagalog-configured app with an
English question typed into it is the common real-world state.

## What it drives

Production code, not a copy of it. Search is the **real** `searchCards` out of
`packages/mobile/src/data/cards.ts`, loaded under Node through
`packages/mobile/scripts/load-cards-node.mts` — the same shim `card-harness.mts` uses — so
`SEARCH_FLOOR`, the stop list, `UNKNOWN_TOKEN_IDF` and the pool scan order are the shipping ones
by construction. The model-free split mirrors `LocalEngine.answerQuery` in the same gate order,
with both floors imported from `@hiraia/shared`.

**The embedder is mandatory, and it must be the right one.** `isOffDomain` reads a LaBSE cosine
against `OFFDOMAIN_OOV_FLOOR` 0.62 / `OFFDOMAIN_HARD_FLOOR` 0.40. Without one every query looks
off-domain, so a missing embedder **aborts loudly**; it never degrades to lexical-only. And a
200 on `/health` is not enough: the runner reads `/props` (falling back to `/v1/models`) and
refuses anything that is not `labse.Q4_K_M`, on the boot path *and* on the reuse path, because
five verdicts here sit within 0.02 of a floor and would otherwise silently become verdicts about
the substrate. No LLM is loaded — the arbitration is decided before a token is generated, and
the quality of the card the model then writes is the card gate's question
(`finetuning/eval/harness/run-harness.sh`).

Every run prints its **provenance** (HEAD, dirty-worktree digest, sha of `cards.ts`, `cards.db`
and the pool, resolved embedder path) and writes it into `JSON_OUT`. A baseline taken on a dirty
worktree is only comparable to a run on the same worktree state — without those hashes a later
"61/118" could not be told from a corpus regeneration.

## Baseline — 2026-08-31 (r2) · **RED, 43/118**

Recorded in `baseline-2026-08-31.txt` / `.json` (HEAD `d39c0a8bec7e`, worktree dirty
`58dd4da3c3df`, cards.db `c4d1c002f963`). The suite was designed **before** any fix, so a red
baseline is the deliverable, not a problem.

```
                              TUNING                                     HOLDOUT
bucket            pass  fail  total    rate         bucket            pass  fail  total    rate
has-card            17    37     54     31%         has-card             7     1      8     88%
borderline           9     9     18     50%         borderline           2     4      6     33%
out-of-scope         2     9     11     18%         out-of-scope         1     4      5     20%
chitchat             0     2      2      0%         chitchat             1     0      1    100%
misspelling          2     5      7     29%         misspelling          1     2      3     33%
tokenisation         1     1      2     50%         tokenisation         0     1      1      0%
TOTAL               31    63     94     33%         TOTAL               12    12     24     50%

form              pass  fail  total    rate   (excludes 9 search-duplicate sentences)
term                15    30     45     33%
sentence            14    26     40     35%

CONFUSION MATRIX — expected (rows) x actual (cols) — tuning
expected \ actual           served-existing     served-wrong        generated              gap        offdomain
served-existing                       17 ok            37 XX                .                .                .
gap                                       .                .                .             3 ok             4 XX
generated                              5 XX                .             6 ok                .                .
offdomain                              5 XX                .             1 XX             3 XX             2 ok
offdomain|served-existing                 .             2 XX                .                .                .
served-existing|generated              1 ok             1 XX             2 ok             5 XX                .
(all)                                    28               40                9               11                6

CONFUSION MATRIX — expected (rows) x actual (cols) — holdout
expected \ actual           served-existing     served-wrong        generated              gap        offdomain
served-existing                        7 ok             1 XX                .                .                .
gap                                       .                .                .             2 ok             1 XX
generated                              3 XX                .                .                .                .
offdomain                              1 XX                .                .             3 XX             1 ok
offdomain|served-existing              1 ok                .                .                .                .
served-existing|generated                 .             1 XX             1 ok             2 XX                .
(all)                                    12                2                1                7                2

wrong card served (the mangrove bug) .................. 42
in-domain query told it is off-domain ................. 5
  of which a child's SPELLING or SPACING .............. 0   [must be 0]
off-domain query answered with a confident card ....... 6
ungrounded query sent to generation anyway ............ 0

SOFT — what the CORRECT cards actually carried
right card served with NO illustration ................ 1
right card served with NO title band ................. 12

verdicts decided within 0.02 of their floor (coin flips) . 5
aspirational (not gating) ............................. 0/4
```

### What the matrix says

1. **Column `served-wrong` = 42**, and it is one bug, not forty-two. Of the **85** queries search
   answered, **74 scored exactly 1.000**: when every query token is in the vocabulary the idf
   denominator equals the numerator, so *every* card carrying those tokens ties, and
   `frac > bestScore` keeps the **first one scanned** — the lowest pool ordinal, i.e. index
   insertion order (LIVING_THINGS first). Re-measured on this suite: the median query has **33**
   cards tied at the winning score, `bagyo` has 707, `bato` 1,548 and `araw` **3,129**. Verified directly: `gravity` df=687 → ffct-00835 *"plant tropism"*; `tsunami`
   df=134 → ffct-07282 mangroves; `bulkan` df=545 → ffct-01913 hydrothermal vents; and in the
   *holdout*, `ulap` → *"puffball mushroom spores"*. The confident answer is an arbitrary card
   from a tie of hundreds.
2. **Row `offdomain`, column `served-existing` = 5 (+2 chitchat).** Off-domain handling **cannot
   be evaluated at all** right now, because search answers *"kumusta ka"*, *"mahal kita"* and
   *"salamat po"* with a confident science card at 1.000 before `isOffDomain` is ever consulted.
3. **gap ↔ offdomain leaks in BOTH directions**, in both halves. `narwhal` (0.596) and `capybara`
   (0.561) are told they are not science; `spiderman` (0.694), `jollibee chickenjoy` (0.682),
   `minecraft` (0.642) and `pokemon` (0.670) are treated as in-domain gaps. The cosines genuinely
   interleave — that is the finding, not the fix, and it is why the holdout exists.
4. **The misspelling/spacing floor holds: 0 violations.** `erthquake`, `dinosawr`, `gravitiy`,
   `kidlaat`, `photosinthesis`, `amiba` and `lightening` all come back `unreachable: false` — the
   spelling probe reaches them — so the OOV arm stays silent and they land on an honest `gap`.
   They still FAIL the bucket (a spellable child query should reach a card or a generation), but
   the structural defence is intact and this gate exists to keep it that way **while search is
   tightened**.
5. **Form matters, and not the way you would guess.** `SEARCH_STOP` strips
   what/is/ano/ang/unsa/ngano, so *"what is gravity"* tokenises to exactly `{gravity}` and is
   byte-identical to the term — nine such sentences are marked `searchDuplicateOf` and excluded
   from the form table, or it would be comparing a form against itself. Where a sentence carries
   real extra **content** words it makes things *worse*: the extra tokens join the idf denominator
   and let a card that happens to carry one outrank the topic cards (*"bakit asul ang langit"* →
   *"December birthstone"*, turquoise being blue-green; *"paano huminga ang isda sa ilalim ng
   tubig"* → a dolphin card).
6. **Five verdicts are coin flips.** `unsa ang narwhal` passes at +0.001 over the OOV floor,
   `ano ang antimatter` fails at −0.005, `ano ang narwhal` (English config) at −0.002, holdout
   `quokka` at −0.012 and `walrus` at +0.013. They are printed with an `UNSTABLE` flag: a fix
   that only moves these has not moved anything.
7. **A green gate would not prove the feed still shows pictures.** Only 42% of the pool has art,
   and art and typography are **disjoint** populations — a poster card carries title+emphasis and
   no image, an illustrated card carries no title. The report therefore prints what each served
   card actually carried (`[art ttl emp quiz]`) and counts correct-but-illustration-less serves as
   an advisory line. It is not part of the verdict; it is there so a regression in card quality
   cannot hide behind a correct id.

### Deliberately filed as `has-card`, not `borderline`

`what is gravity`, `what is a tsunami` and `how hot is lightning` are **not** borderline in this
corpus: ffct-21860's topic is literally *"gravity"*, ffct-29270's is *"what a tsunami is"*, and
ffct-22623's text is *"How hot is lightning, and what can it do?"*. Filing them as wrong-card
failures rather than gaps is the strictly stronger gate.

### Aspirational (reported, never gating)

`hurricane katrina`, `quantum computer`, `string theory` and `solar sail` are labelled `gap`
because that is what the product should say — but `lexEmpty` is computed over the whole query and
each of these has a **dense head token** in the bank (`hurricane` 30 cards / 30 facts, `quantum`
15/3, `string` 135, `solar` 566). The route can therefore only ever answer `generated`; reaching
`gap` needs a concept-level coverage check that nothing in the repo implements. They are printed
in their own section and excluded from the verdict, so the gate cannot silently demand an unbuilt
feature — and nobody can quietly relabel the requirement away either.

### Known limitation

`generated` here means **"the arbitration decided to generate"**. `cardStore.ask` additionally
requires the generation to come back non-empty and survive `sanitizeCardAnswer`, and falls
through to the gap card when it does not. That last hop is model-dependent and belongs to the
card gate; this suite stops at the routing decision on purpose, which is what lets it run in
seconds with no LLM.

## After the aboutness fix — 2026-08-31 · still RED, but **75/118** (was 43/118)

Recorded in `result-2026-08-31-aboutness.{json,txt}` (HEAD `d39c0a8bec7e`, cards.db
`20714cddb309` — the database was **rebuilt** to carry the salience column the fix reads, so its
hash necessarily differs from the baseline's `c4d1c002f963`; every other table in it round-trips
byte-identically, which was checked before the run). The artefact records `cards.ts`
`da0498a35440`; the file was then reflowed to the 100-column print width and is `f79a609abc15`
today. The tuning half was re-run at that hash — 60/94, **0 of 94 rows differing** — so the
recorded verdicts stand; the holdout was deliberately not re-run, having been spent once.

`searchCards` now ranks on **two** directions instead of one — query coverage (`frac`, the old
score, unchanged and still gated at `SEARCH_FLOOR`) and then **aboutness share**: how much of the
CARD's own salience mass the query occupies, salience being `1/(1+rank)` with rank 0 = the card's
topic, rank i+1 = its i-th `terms` entry, and a fixed `PROSE_RANK` for a passing mention, all over
the card's own `H(|head|)`. A confident serve additionally needs at least `min(2, |query words|)`
distinct matched words and at least one of them at head level. See the doc comment on
`searchCards`; the per-posting ranks and the per-card head sizes are built by
`rag/pipeline/build-cards-db.py` into `search_token.ranks` and `search_meta`.

```
                              TUNING                                     HOLDOUT
bucket           pass  fail  total   rate  (base)   bucket           pass  fail  total   rate  (base)
has-card           44    10     54    81%   (17)    has-card            7     1      8    88%    (7)
borderline         10     8     18    56%    (9)    borderline          4     2      6    67%    (2)
out-of-scope        2     9     11    18%    (2)    out-of-scope        1     4      5    20%    (1)
chitchat            1     1      2    50%    (0)    chitchat            1     0      1   100%    (1)
misspelling         2     5      7    29%    (2)    misspelling         1     2      3    33%    (1)
tokenisation        1     1      2    50%    (1)    tokenisation        1     0      1   100%    (0)
TOTAL              60    34     94    64%   (31)    TOTAL              15     9     24    63%   (12)

wrong card served (the mangrove bug) .......... 42 -> 13
off-domain query answered with a confident card  6 -> 3
in-domain query told it is off-domain .......... 5 -> 5   (of which spelling/spacing: 0 -> 0)
ungrounded query sent to generation anyway ..... 0 -> 0
ties at the winning score, over the 89 candidate-producing queries:
        median 32 -> 1 · p90 469 -> 2 · max 3,129 -> 6 · any tie 83/89 -> 14/89
```

**The holdout is not materially worse than the tuning half** (63% vs 64%), which is the number
that matters — but read *where* it moved before reading that as symmetry. The holdout's `has-card`
bucket was **already 7/8 at baseline**: this suite's main lever had almost no headroom there, so
the holdout's +3 came from `borderline` and `tokenisation`, not from the bug that was fixed. The
tuning half is where the has-card evidence lives (17/54 -> 44/54).

### What is still red, and who owns it

- **`out-of-scope` 2/11 and 1/5 is not search's** and did not move under any variant. Declining
  hands those queries to `isOffDomain(topCos, lexUnreachable)`, and points 3 and 6 above still
  stand: the two classes are not separable on that one cosine. A green-ish total here must not be
  read as progress on off-domain handling.
- **Four has-card failures are accept-set artifacts, not wrong cards**, and are left alone
  deliberately (the suite is not to be edited to make a fix look better):
  - `bulkan` / `unsa ang bulkan` -> `dcard-01100` *"Volcanoes as Natural Sources"*. Topic matches
    `volcan`; the card's `domain` is `FORCE_MOTION_ENERGY` (geothermal energy) and the rule
    requires `EARTH_SPACE`.
  - `dinosaur` -> `dcard-07563` *"Dinosaur Extinction Boundary"* and `dinosauro` ->
    `ffct-34612` *"what likely ended the dinosaurs"*: both are dinosaur cards filed under
    `EARTH_SPACE` while the rule requires `LIVING_THINGS`.
  - `bituon` -> `ffct-33184` *"why we don't see stars in daytime"*, a stars card that no anchor in
    `^(a |the )?stars?\b|stars are|star colors|constellation|shooting stars` admits.
  The domain clause is doing real work elsewhere (it is what keeps `bato` = rock from admitting
  kidneys), so this is a note for whoever next revises the ground truth, not a request to drop it.
- **Genuine remaining misses** (the served card is topical but not an answer): `araw` ->
  *"Sikat ng Araw at Biodiversity"*, `ngano nga adunay linog` -> *"check for fire hazards after a
  quake"*, `paano gumagawa ng pagkain ang halaman` -> *"plant kingdom"*, `how tall is mount
  everest` -> *"Philippine Trench is deeper than Everest is tall"*, `ngano nga pula ang atong
  dugo` -> *"Iron in our blood carries oxygen"*, and in the holdout `paano umiinom ng tubig ang
  halaman` -> *"How it gets water without drinking"*.

### Cost

Measured over 3,122 queries against the full 46,421-card pool (the 122 gate queries plus 3,000
drawn from real card topics), two runs each: **p50 0.098 ms -> 0.095 ms, p90 0.50 -> 0.34,
p99 1.45 -> 0.92, max 9.02 -> 2.09 ms.** The extra direction costs nothing because the per-query
`Map`s became typed-array scratch buffers indexed by ordinal, the same pattern the draw path
already used. The asset grew by the 1.9 MB of salience ranks (one byte per posting) plus 46,421
bytes of head sizes, inside a 135 MB database the APK deflates.

## After the weak-hit gate — 2026-09-01 · still RED, but **80/118** (was 75/118)

Recorded in `result-2026-09-01-weakgate.{json,txt}` (HEAD `d39c0a8bec7e`, cards.db
`45cf6762f5bc`, pool `addba7fe9445` — the corpus was rebuilt on 2026-08-31 20:43, after the
aboutness result was recorded and before this work started, which moved ~20 serves to different
but same-topic cards and flipped exactly one verdict on its own: `dinosaur` now lands on a
LIVING_THINGS dinosaur card its accept rule admits. The pre-change baseline **at this corpus**
is therefore 61/94 tuning / 15/24 holdout, and everything below is measured against that.)

The SEQUENCING fix: `cardStore.ask` (and the web demo's `useCardDemoStore.ask`) no longer
serves ANY `searchCards` hit unseen. `searchCards` now labels a hit **weak** when its
aboutness share is under `WEAK_ABOUT` 0.04 — no card is really ABOUT the words typed, something
merely mentions them — and only a weak hit consults the off-domain gate before serving:
`isOffDomain(topCos, true)`, the OOV arm, because a weak hit is precisely a query with no
lexical evidence that the corpus knows it as a subject (`LocalEngine.weakHitOffDomain` on the
phone; `POST /api/demo/card {classifyOnly:true}` on the web). A strong hit is served instantly,
zero-model, exactly as before; a weak hit that the gate calls in-domain, or that finds the
embedder unavailable, is ALSO served — the consult can only ever swap a junk serve for the
science-tutor card, never a card for silence.

The threshold is derived from this suite's own measured distribution (tuning half): every
junk-query serve scored aboutness 0.017–0.031 at topCos 0.479–0.545 (all above the HARD floor —
which is why the miss-path gate never caught them — and all under the OOV floor), while
right-card serves start at 0.038 and sit at topCos 0.70+ in that band; the first right serve
the OOV floor would refuse is at 0.058. `run-arbitration.mts` mirrors the new serve sequencing
(weak → consult → refuse/serve) — a mirror of shipped code, same as the search half; rows carry
`weak`/`weakRefused` and a refused hit prints as such.

```
                              TUNING                                     HOLDOUT
bucket           pass  fail  total   rate  (pre)    bucket           pass  fail  total   rate  (pre)
has-card           45     9     54    83%   (45)    has-card            7     1      8    88%    (7)
borderline         10     8     18    56%   (10)    borderline          4     2      6    67%    (4)
out-of-scope        5     6     11    45%    (2)    out-of-scope        1     4      5    20%    (1)
chitchat            2     0      2   100%    (1)    chitchat            1     0      1   100%    (1)
misspelling         2     5      7    29%    (2)    misspelling         1     2      3    33%    (1)
tokenisation        1     1      2    50%    (1)    tokenisation        1     0      1   100%    (1)
TOTAL              65    29     94    69%   (61)    TOTAL              15     9     24    63%   (15)

off-domain query answered with a confident card ....... 6 -> 0   (both halves)
weak band: 7 of 122 queries paid the one-embed consult (5.7%); 4 refused, all correctly.
consult cost, measured warm on the desktop path: p50 56 ms, max 67 ms (embed + in-RAM scan).
```

- **All four flips are the intended ones**: `kumusta ka` (0.540), `unsa imong ngalan` (0.521),
  `boring na ako` (0.479) and `paborito kong pagkain ay adobo` (0.545) — the queries search
  answered with a hand-wave card, a name-mocking card, the coconut rhinoceros BORER beetle and
  *Rocks and Minerals*. `has-card` and `borderline` did not move in either half: the three
  non-refused weak hits (topCos 0.639–0.767) were served exactly as before.
- **The holdout is untouched by construction, not just unregressed**: zero holdout rows fall in
  the weak band (its junk queries all decline at search already), so the +0 there is "no
  evidence", not "confirmed transfer". The next holdout revision should include a junk query
  that search MATCHES weakly, for exactly this seam.
- **`out-of-scope`'s remaining red (6 tuning / 4 holdout) is the DECLINE path**, unchanged and
  out of this fix's reach: `spiderman` 0.694, `jollibee` 0.682, `minecraft` 0.642, `pokemon`
  0.670 sit ABOVE the OOV floor, interleaved with real science (`narwhal` 0.588–0.632) — the
  known non-separability, point 3 above. The weak-hit gate only reaches queries search would
  have SERVED.
- `sigarilyas` (0.639, +0.019 over the OOV floor) is the one weak consult inside the UNSTABLE
  margin: on a different embedder build it could flip to an offdomain refusal, which for that
  in-domain query would be the product's worst failure (a real vegetable told it is not
  science). The margin is positive today and the embedder build is pinned by this gate;
  recorded, not tuned around.
