# Local APK content check — session walks + LLM judge

Two halves, matching the repo's eval philosophy (deterministic gate + judged benchmark):

1. **`session-walk.mts`** — deterministic, free. Simulates reader sessions headless through
   the REAL feed logic (`src/data/cards.ts`) over the same `cards.db` + `tokens.bin` the APK
   ships (via `load-cards-node.mts`). Records the reader-visible transcript: band title,
   body text, illustration file, display-resolved ticket labels, quiz interjects, magnet
   state. ~100 sessions × 30 pages in ~55s.
2. **`judge-walks.wf.js`** — LLM-judged, on the Claude SUBSCRIPTION (no API key; the
   repo's `.wf.js` workflow convention, see `finetuning/distill/eval/judge-v2.wf.js`).
   One agent per transcript scores 0-5 on sequencing / text quality / art fit / titles /
   quiz, flags issues with page refs, and can VIEW the webp/png art files to check the
   picture matches the topic. Merge pass aggregates into a report.

## Usage

```bash
cd packages/mobile

# transcripts (RUNS/TURNS/ASKS/GRADE env vars; defaults 12×30)
RUNS=24 TURNS=30 npx tsx scripts/session-walk.mts

# judge (from repo root; interactive Claude Code session — the Workflow tool needs approval)
claude -p 'Run the workflow at packages/mobile/scripts/judge-walks.wf.js with args
  {"dir":"packages/mobile/scripts/walk-out"} and print the returned report in full.'
```

Transcripts land in `scripts/walk-out/session-NN.json`. Judge scores and issue lists come
back in the workflow's return value; save them wherever useful.

## What a session records

- 4 reader policies rotate: deep-diver, topic-hopper, wanderer, random (lateral-leaning
  policies take the deep ticket on single-path pages, like a real reader).
- 2 asks per session (rotating through ASKS) exercise the magnet: landing, on-topic pull,
  served-count decay, auto-release at exhaustion.
- Quiz interjects at the app's cadence (4-5 pages), about recent cards, no repeats.
- Labels resolve the way the display-time fix does: authored title first
  (`bandLabel`), drawn fragment only when the card has no title.

## First findings (smoke test, 1 session judged)

The judge scored titles 1/5 — the weakest dimension. Real issues it caught:
- ticket fragments on no-title cards ("inapo", "na-extinct", "dinosaurs were") — the
  display-time fix only upgrades cards WITH titles; ~42% of the deck has none
- English fallback band titles in the Tagalog deck ("What Dinosaurs Were") — those cards'
  authored titles are English-only
- magnet repetition: 6/10 dinosaur cards restate the same extinction fact; the dedup gates
  (idf overlap, Jaccard) don't catch paraphrases
- spoilers: a ticket can state the next card's entire fact ("66 milyong taon")
- art mismatches: "Itlog ng Dinosaur" illustrated by a feathered theropod, no egg

These are data problems (missing titles, paraphrase dupes, art assignment), not feed-logic
problems — fix alongside the card bank, not in cards.ts.
