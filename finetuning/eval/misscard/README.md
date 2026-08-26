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
