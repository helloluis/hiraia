# Miss-card benchmark

**The card:** when retrieval scores a kid's input below 0.63 (see `../retrieval/`), the app shows
a "topic miss" card: the model proposes **three nearby science topics as directions** the kid
can tap. It's a real card type, not an error — it is how the feed recovers from `minecraft`.

**What the model must do (one generation):** given the typed term and the mode, emit exactly
three lines, each `topic — one sentence why it connects`, in the mode language.

**Pre-registered bar (written before the first result):**
- **format**: exactly 3 non-empty lines — ≥95%. The app parses these into tappable options.
- **language**: fastText lid == mode — ≥95% (routing bench says the template gets ~99%).
- **retrievability**: every proposed topic scores ≥0.63 against the bank — **≥90% of cards
  fully pass.** This is the one that matters: a direction the feed can't retrieve is a dead end.
- Watch for: the model *answering the miss* instead of redirecting (e.g. writing about Minecraft),
  and hedging ("I don't know minecraft…") instead of proposing.

Probes: 72 terms (27 true misses, 15 borderline science, 30 kid-plausible extras) × 3 modes = 216.
Model: SFT v1 Q4_K_M. Scorer needs the LaBSE service on :8091.

## Result — three attempts on SFT v1, 2026-08-26 (216 probes each, T=0.7)

| | ≥3 directions | mode language | **all 3 retrievable (≥0.63)** | preamble | truncated |
|---|---|---|---|---|---|
| v1 prose template | 68/216 | 211/216 | **57/216 (26%)** | 113 | 49 |
| v2 "EXACTLY three lines, no intro" | 87/216 | 198/216 | **60/216 (28%)** | 127 | 88 |
| v3 JSON-schema constrained decoding | 151/216 | 180/216 | **55/216 (25%)** | 58 | 53 |

**The bar was ≥90% retrievable. Every approach lands at ~25%, flat.** Format compliance is
solvable (the schema forces three `{topic, why}` objects), but what the model puts *in* the
slots is not: `my dog` → Bacteria / Enzymes / Enzymes; `kumusta` → "the colour of your hair";
`minecraft` → a truncated non-topic. The prose-v2 wording made a 2B model *more* verbose, not
less. Constrained decoding forces the shape of a good answer onto a model that cannot produce
the substance — it does not know, in any phrasing, what "three nearby science topics that exist
in our bank" means.

**This is a capability ceiling, not a prompt problem, and the fix is the same one that closed
routing: don't ask the model to do what retrieval does better.** The three directions for a
miss card should be the top-3 *distinct topics* in the bank nearest the query — retrievable
by construction (100%), instant, deterministic, and inspectable. `retrieval-directions.json`
shows this for all 27 true misses. The model's role on a miss card, if any, is one line of
connective text ("Wala tay cards sa 'minecraft', pero…"), which the routing benchmark says it
can do at 99%.

**What the model IS good for in this product, from today's evidence:** card 1 on a hit
(templated single generation, 99% language, fluent) — and nothing that requires it to reason
about what the bank contains.

### Caveat on the retrieval prototype — "retrievable by construction" is not "sensible"

Reading the 27 retrieval-based triples by hand: only **7/27 are plausible** follow-ons (`my dog`
→ dogs/foals, `birthday` → birthstones, `christmas` → parol/Sinulog, `qwerty` → the QWERTY
keyboard fact). The other 20 are **surface-form coincidences**: `tiktok` → tokay gecko,
`roblox` → fruit bats, `minecraft` → meerkats/mudskipper, `hello` → slime protection. And the
top-1 score does not separate the two groups (both 0.43–0.67).

That is the real shape of the problem: **for a true miss, "nearby" is undefined** — by
definition there is no conceptual neighbour in the bank, so nearest-neighbour returns noise
that happens to share letters. The 7 plausible cases are not really misses; they have a partial
concept (dog, birthday, christmas) that retrieval finds. They are weak hits and the feed's
normal edge-walk handles them.

**So the miss card cannot be "three related things" by any mechanism** — not the model (~25%),
not similarity search (~26%). The honest design for a true miss is a card that says "walang
cards tungkol sa 'minecraft'" and offers **three directions from a curated, mode-specific list
of popular topics** (rotated, not searched). The model may write the one connective sentence.
Which topics go on that list is a product decision.
