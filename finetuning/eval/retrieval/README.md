# Retrieval score experiment — can the app tell a science query from a miss?

**Question (Luis, 2026-08-26):** the fact bank can't hold all knowledge. When a kid types a
word, can the app decide from the retrieval score alone whether to show fact cards or a
"topic miss" card — without asking the model to judge?

**Setup.** 166 one-or-two-word queries, embedded with the LaBSE service (raw CLS, L2-normalised
— the exact device method), scored by cosine against the *current* bank blob
(`packages/mobile/assets/rag/vectors-labse.i8.bin`, 49,556 facts × tl/bis/en). Labels were
corrected after the first pass: `basketball`, `guitar`, `piano`, `jose rizal`, `manny pacquiao`
are legitimately in the bank (everyday physics, PH civics), so they are *science*, not misses.

**Result.**

| bucket | n | top-1 cosine p10 / p50 / p90 |
|---|---|---|
| science (curriculum + adjacent) | 139 | 0.661 / 0.708 / 0.755 |
| true miss | 27 | 0.515 / 0.583 / 0.622 |

**Cut at top-1 ≈ 0.63 → 97% balanced accuracy.** 1 miss admitted (`minecraft` → "earthquake
drill", 0.671), 2 science rejected (`animal` 0.612, `soccer` 0.606). Top-5-mean and top-10-mean
cluster features do **not** beat plain top-1. The app's existing `CONTEXT_FALLBACK_FLOOR = 0.62`
is already the right number.

**Curriculum vs adjacent is NOT separable** (51% — coin flip). `narwhal` scores like `whales`.
This is the good outcome: "weak hit" needs no special path. Two tiers, not three:

- **score ≥ 0.63 → fact cards** (the feed's edge-walk from the top hit; model optional for card 1)
- **score < 0.63 → miss card** (the model proposes three directions; see `../misscard/`)

**Caveats.** n=27 misses, one pass, my own query list. The residual tail is real and is exactly
kid-shaped input: `minecraft`, `pizza`, `kumusta` sit at 0.62–0.67 next to accidental
neighbours. A miss-card that is *good* (three sensible directions) is the mitigation for the
tail, which is why the miss card is a real card type and not an error state.

**Also found:** the cards feed's search today (`packages/mobile/src/data/cards.ts:searchCards`)
is **lexical idf token overlap**, not embeddings. `narwhal` scores 0 against `whales` there.
Switching the feed's search to the LaBSE path is what makes the adjacent case work at all.

Files: `queries.json`, `score_queries.py`, `scores-labse.json`.
