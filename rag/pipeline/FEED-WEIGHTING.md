# Feed weighting ruleset (draft)

**Goal:** every card draw (session start, reroll, miss-card directions) samples from the pool
with a weight — not uniformly. Heaviest: what the student is likely studying *this month*.
Lightest: what they have already seen.

## Inputs
- `curriculum-tags.json` (v2, multi-label) — every MATATAG competency a card serves (`codes`, ≤3, best
  first, G3–10) and the distinct grade-quarter `cells` they imply. A spiral curriculum revisits ideas,
  so most cards carry two codes. The **curriculum factor is the MAX over the card's cells**. Labels come
  from `fw-label-competencies.py` (Fireworks qwen3.7-plus, 83% agreement with Claude seed labels); the
  lexical anchor tagger (≈50% precision) is retired to `curriculum-tags.lexical.json`.
- `sy-calendar.json` — quarter date ranges (ASSUMED; confirm against the DepEd Order).
- `card_seen` / `competency_seen` — persistent SQLite (`seen-store.sql`). Topic-level seen-ness keys on the
  competency code, not `card.topic` (a per-card slug — 15,739 distinct values, 67% sentence-shaped).
- The student's grade setting (default 5).

## Weight = product of four factors

| factor | rule | range |
|---|---|---|
| **curriculum** | max over the card's cells (cells agreed by two labelers or from a confident label count in full; weak cells are capped at ×3); each cell's lift above ×1 is scaled by that cell's own competency normalisation `sqrt(median_n / n_code)` clamped [0.1, 1] (it only ever dampens, so no cell exceeds its band) — a tagged card is never below ×1, so off-curriculum stays lightest; of: **school out: every cell of the student's own grade ×6, equally** (see below); in term, same grade & current quarter ×6; same grade, adjacent quarter ×3; same grade, other quarter ×1.5; adjacent grade, current quarter ×2; other ×1; off-curriculum OR tag confidence <0.20 ×0.4 | 0.4–6 |
| **recency in SY** | within the current quarter, weeks already covered (from `week`, when known) ×1.5 vs. weeks ahead ×1 — favour review over preview | 1–1.5 |
| **seen** | card: `0.5 ** times`, recovering by +50% per 7 days since `last_seen` (cap 1.0); competency: `0.8 ** times` likewise | (0, 1] |
| **base** | every card 1.0; illustrated-and-verified required to be in the pool at all | 1 |

`w = curriculum × recency × seen_card × seen_competency`. Sample proportional to `w`. Never zero:
a card seen five times is ~3% as likely as fresh, not excluded.

## Where each draw uses it
- **session start / reroll**: full weight over the whole pool.
- **edge-walk (cards 2–10)**: neighbour set from the existing edges, *re-ranked* by `w` — the
  drift still follows edges, but leans toward this month's competencies and away from seen.
- **miss card**: three directions = top-3 *distinct competencies* by `w` (a competency's weight =
  its curriculum factor × its `competency_seen` decay), each shown through a short kid-facing
  trilingual LABEL authored per competency (e.g. G5-M-2 → "Solid, liquid, gas" / "Solido, likido,
  gas") — never `card.topic`, never a similarity search (see misscard/README). Tapping a direction
  starts the feed inside that competency's cards. Labels are a swarm deliverable (content
  competencies only).
- **quiz interject**: unchanged (the quiz bank is keyed by factId; seen-ness of the *card* is
  enough).

## Calibration v2 (Grade 5, Q2, v2 multi-label tags — `feed-calibration.mts`)

Re-fitted after the LLM re-tag: 16,414/16,948 pool cards tagged, 8,355 with two cells. Multi-cell cards push more mass into the current cell, so the current-quarter multiplier moved from ×8 to ×6, landing the Grade-5/Q2 share of draws in the 25–32% band (sweep: see `feed-calibration.mts`). The v1 single-label table below is kept for history.

## Calibration v1 (single-label lexical tags — superseded)

| cell | cards | weight | share of draws |
|---|---|---|---|
| G5 Q2 (this month) | 615 | 8 | **24%** |
| G5 Q1 (just finished — review) | 989 | 3 | 14% |
| off-curriculum + low-confidence | 7,785 | 0.4 | 15% |
| G5 Q3 (preview) | 426 | 3 | 6% |
| G6 Q2 / G4 Q2 (adjacent grade) | 499 / 448 | 2 | 5% / 4% |
| everything else | ~6,000 | 1–1.5 | ~32% |

A quarter's ~600 confidently-tagged cards get a quarter of all draws; variety keeps the rest.
Tag confidence is the margin over the runner-up competency; ~19k of 30k tagged cards are ≥0.20.
`horse mane and tail` (conf 0.00) correctly falls into the off-curriculum band; `wheelbarrow`
(0.23, correct) stays in — hence 0.20 not 0.25.

## Calendar — SY 2026-27 is THREE terms (DO 009 s. 2026), not four quarters

Opens 2026-06-08, closes 2027-04-08, 201 class days. Instruction: T1 Jun 15–Sep 1, T2 Sep 16–Dec 4,
T3 Jan 4–Mar 23; each term ends with a two-week end-of-term block. MATATAG competencies stay in
FOUR quarters and no official quarter→term pacing guide exists yet, so the app infers the
curriculum quarter from the **fraction of instructional weekdays elapsed** (Q = ⌊4·f⌋+1). Today
(2026-08-27) → 31% → Q2 — which is the cell the calibration above uses. Boundary fuzz is tolerated by
the adjacent-quarter ×3.

**When school is out** (outside the school year — the April–June break, and any date the calendar does
not cover) there is no quarter to infer, so the rule changes shape rather than switching off: **every
card tagged to the student's own grade is weighted equally, at the in-quarter ×6**, and everything else
stays at baseline. The break reviews the whole year the child just finished instead of drifting into
other grades — measured for a Grade-5 reader, their own grade goes from 39% of draws to **61%**
(Q1 10.4% · Q2 22.0% · Q3 10.9% · Q4 17.9% — equal per card, so the shares follow how many cards each
cell has), with other grades falling from 59% to 38%. The grade a child is *entering* is not assumed:
the stored grade is whatever they last set. Data:
`rag/pipeline/sy-calendar.json`. **Rollover:** dates outside every known DepEd calendar use a generic PH
school-year model (opens the second Monday of June, closes the second Friday of April, one instructional
window) — `calendarFor()` in `feedWeighting.ts` — so SY 2027-28 and later keep weighting without an app
update; add each new DepEd Order to `KNOWN_CALENDARS` when it is published.

## Cost (measured on the Mac, 16,948-card pool; the Redmi SD685 is roughly 8–15× slower)
The curriculum factor is a **session table** (`cards.ts` `ensureWeightTable`), built once and rebuilt only when the
grade or the inferred quarter changes; the seen-store is a **sparse overlay** resolved once per draw (competency
codes as small ints, one tight loop over typed arrays; seen cards applied by index). Per call: startCard 0.30 ms
un-weighted → **0.21 ms weighted** (0.44 ms with 400 seen cards / 150 seen competencies — faster than the old
un-weighted path, which copied a filtered pool); jumpCard 0.28 → 0.49 ms; nextChoices **~12 ms un-weighted**
(pre-existing lexical edge scoring over the domain pool) → ~12.6 ms weighted. So the weighting costs well under a
millisecond at session start / reroll and ~1 ms per page turn; the edge-walk's own 12 ms is the cost worth attacking
next, and it predates this work. Untagged cards never decay as a group ('off' is not a competency). Equivalence, rebuild-on-key-change, bump-visible-next-draw
and timing are checked by `packages/mobile/scripts/feed-weights-check.mts`.

## Open
- ~~Calibrate the ×8/×3/×1.5 against the per-cell counts~~ DONE (table above; reproduced through
  `packages/shared/src/curriculum/feedWeighting.ts`). Recency is ×1 until tags carry a `week`.
- ~~Confirm the DepEd calendar~~ DONE (DO 009 s. 2026). Still open: an official MATATAG quarter→term pacing guide would replace the fraction inference.
- ~~Grades 7–10 grade-only~~ DONE: the 180 JHS competencies are extracted and labelled; quarter weighting applies to all 324.
