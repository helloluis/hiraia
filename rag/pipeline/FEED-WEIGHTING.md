# Feed weighting ruleset (draft)

**Goal:** every card draw (session start, reroll, miss-card directions) samples from the pool
with a weight — not uniformly. Heaviest: what the student is likely studying *this month*.
Lightest: what they have already seen.

## Inputs
- `curriculum-tags.json` — one MATATAG competency per card (`G5-L-5`), with grade + quarter.
  ~88% of feed cards; the rest are off-curriculum.
- `sy-calendar.json` — quarter date ranges (ASSUMED; confirm against the DepEd Order).
- `card_seen` / `topic_seen` — persistent SQLite (`seen-store.sql`).
- The student's grade setting (default 5).

## Weight = product of four factors

| factor | rule | range |
|---|---|---|
| **curriculum** | same grade & current quarter ×8; same grade, adjacent quarter ×3; same grade, other quarter ×1.5; adjacent grade, current quarter ×2; other ×1; off-curriculum OR tag confidence <0.20 ×0.4 | 0.4–8 |
| **recency in SY** | within the current quarter, weeks already covered (from `week`, when known) ×1.5 vs. weeks ahead ×1 — favour review over preview | 1–1.5 |
| **seen** | card: `0.5 ** times`, recovering by +50% per 7 days since `last_seen` (cap 1.0); topic: `0.8 ** times` likewise | (0, 1] |
| **base** | every card 1.0; illustrated-and-verified required to be in the pool at all | 1 |

`w = curriculum × recency × seen_card × seen_topic`. Sample proportional to `w`. Never zero:
a card seen five times is ~3% as likely as fresh, not excluded.

## Where each draw uses it
- **session start / reroll**: full weight over the whole pool.
- **edge-walk (cards 2–10)**: neighbour set from the existing edges, *re-ranked* by `w` — the
  drift still follows edges, but leans toward this month's competencies and away from seen.
- **miss card**: three directions = top-3 *distinct topics* by `w` from the curated pool of
  competency titles for the student's grade — never a similarity search (see misscard/README).
- **quiz interject**: unchanged (the quiz bank is keyed by factId; seen-ness of the *card* is
  enough).

## Calibration (Grade 5, Q2, against the real feed pool — `tag-curriculum.py`)

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
(2026-08-27) → 31% → Q2 — which is the cell the calibration above uses. Summer → no current
quarter, all quarters ×1. Boundary fuzz is tolerated by the adjacent-quarter ×3. Data:
`rag/sources/curriculum-guides/sy-calendar.json`.

## Open
- Calibrate the ×8/×3/×1.5 against the per-cell counts (see tag-curriculum.py output): a cell
  with 2,000 cards at ×8 vs. a cell with 300 at ×1.5 should still surface the small cell.
- ~~Confirm the DepEd calendar~~ DONE (DO 009 s. 2026). Still open: an official MATATAG quarter→term pacing guide would replace the fraction inference.
- Grades 7–10: the competency table is elementary-only (G3–G6). JHS cards get grade-only weight.
