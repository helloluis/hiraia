# Card categories — backfilling the 19,564 uncategorized cards

**Job:** every feed card should carry 1–2 taxonomy categories (`cats`) so the Calendar view can
break a big topic into short, countable sub-topic pills ("Mammals · 76", "Planets · 118") and the
feed can navigate *up* the stack ("other marine animals"). 26,857 cards have `cats`; **19,564 do
not** — all of them `ffct-*` cards from the original factoid bank, which the title/taxonomy pass
never covered (the recent title mop-up gave them titles but not categories). In a large Grade-5
topic that is 40–60% of the cards, which would collapse into one useless "Other" pill.

This is a **data job**, not an app change. Nothing in `packages/mobile/src` needs to be touched.

> **Do not run this on Claude.** Route it to Fireworks — `deepseek-v4-flash-0731` is the model the
> existing stage-2 script uses and benchmarked as the one that returns parseable JSON on this exact
> task (qwen3p7-plus burned its budget on reasoning). Beyond cost, there is a hard constraint: a
> chunk of the bank is grade-school biology, and Tagalog/Bisaya child-body text (reproduction,
> blood, bones, poison, illness) trips Anthropic's AUP classifier and kills the whole context.
> Send ids and text to Fireworks directly; do not paste card bodies into a Claude session to
> "check" them. Spot-checks below are done on **English** `topic`/`title_en` only.

Worktree: `/Users/luis/Code/hiraia-unified` (branch `unified`). Other agents are working in this
tree — **commit your own files by path, never `git add -A`, never checkout/stash/reset.**

---

## 1. Where the data lives

**Source of truth is `rag/pipeline/cardsPool.app.json`** — `{ "cards": [...], "taxonomy": [...] }`,
46,421 cards. `build-cards-db.py` bakes it into `packages/mobile/assets/data/cards.db` (deleted and
rebuilt every run — never edit the db) and into the resident index
`packages/mobile/src/generated/cardsIndex.generated.json`, which is what the app reads `cats` from
(`packages/mobile/src/data/cards.ts:79` `cats?: string[]`; category shelves at `:461-468`).

A card:

```jsonc
{
  "id": "ffct-00001",
  "factId": "lungs-bring-in-oxygen-g4",
  "domain": "LIVING_THINGS",                 // MATTER | LIVING_THINGS | FORCE_MOTION_ENERGY | EARTH_SPACE
  "topic": "lungs take in oxygen",           // short internal descriptor — the best single input
  "terms": ["oksiheno", "oxygen", "baga", "lungs", ...],
  "fact": { "tl": "...", "en": "...", "bis": "..." },
  "title": { "tl": "...", "en": "Oxygen From the Air", "bis": "..." },
  "cats": ["human-bodies", "health"]        // ← ADD THIS (1–2 ids)
}
```

Select the work:

```python
import json
pool  = json.load(open('rag/pipeline/cardsPool.app.json'))
cards = pool['cards']
todo  = [c for c in cards if not c.get('cats')]
assert len(todo) == 19564, len(todo)
assert all(c['id'].startswith('ffct-') for c in todo)
```

Domain split of the work: LIVING_THINGS 6,878 · EARTH_SPACE 4,621 · MATTER 4,108 ·
FORCE_MOTION_ENERGY 3,957.

---

## 2. The vocabulary — which ladder, and why it matters

There are TWO category vocabularies in the pool and they must not be mixed:

| vocabulary | file | ids look like | used by |
|---|---|---|---|
| **curated ladder, 108 leaves** | `rag/pipeline/card-taxonomy.json` → `leaves[]` | `mammals`, `marine-animals`, `heat`, `the-moon` | **every categorized `ffct-*` card** (30,573 assignments, 100% of them) |
| DepEd module taxonomy, 335 nodes | `rag/pipeline/deped-taxonomy.json` | `g9-living_things-respiratory-and-circulatory-diseases` | `dcard-*` cards only |

**Use the 108-leaf curated ladder, exactly as `fw-gen-card-titles.py` does.** The `ffct-*` cards you
are filling sit next to 16,968 `ffct-*` siblings that already use it; the Calendar pills group a
topic's cards by these ids, so an `ffct` card on the DepEd vocabulary would never merge with its
siblings. Each leaf has `id`, `parent` (only three roots: `plants`, `human bodies`, `matter types`;
depth ≤ 1), trilingual `label_en/tl/bis`, and `projected_cards`.

Assignment rules (same as the existing 26,857):

- **1 or 2 ids per card**, chosen ONLY from the 108. Existing split is ~49% one id / ~51% two.
- Prefer the most specific leaf that fits; a second id only when the card genuinely straddles
  (a card about a bird's beak adaptation → `birds` + `animal-adaptations`).
- Never invent an id. Out-of-vocabulary strings are dropped at merge time (`assemble-card-titles.py:56-57`)
  and the card would silently stay uncategorized — so validate before you merge.
- The `topic` field is the best single input; include `fact.en[:160]` for disambiguation, as the
  existing prompt does. Do not send `tl`/`bis` text (not needed, and see the AUP note).

---

## 3. The driver — copy the existing stage-2 script

`rag/pipeline/fw-gen-card-titles.py` already does this job for title+cats together. Make a sibling
`rag/pipeline/fw-backfill-card-cats.py` that:

1. Reuses its machinery verbatim: Fireworks call + retry (`call`, `obj_from`), the token-budget
   pacer (`GEN_TPM`), `ThreadPoolExecutor` concurrency (`FW_CONC`), 20 cards per call (`FW_PER_CALL`),
   resumable per-shard JSONL output where a **zero-byte shard counts as unfinished**, and
   **gap-fill by card id, not shard index** (`main()` `FW_MISSING=1` branch — the pool can be
   re-ordered between runs, so index-based resume is unsafe).
2. Selects `todo` as in §1 (cards with no `cats`), not "all cards".
3. Uses the existing `prompt_for()` with the TITLE section removed — ask for **cats only**, output
   `{"out":[{"i":0,"cats":["..."]}]}`. Keep the "Reason briefly, then output ONLY JSON" tail; keep
   `temperature 0.3`; keep the generous `max_tokens` (reasoning model).
4. Writes shards to `rag/pipeline/card-cats/cats-*.jsonl`, one row per card: `{"id": "...", "cats": [...]}`,
   validated against the 108 ids **at write time** (drop invalid, count them in the run stats).

Run it exactly like the precedent:

```bash
cd /Users/luis/Code/hiraia-unified
set -a; source ./.env.local; set +a          # FIREWORKS_API_KEY lives here — never commit it
python3 rag/pipeline/fw-backfill-card-cats.py           # first pass
FW_MISSING=1 python3 rag/pipeline/fw-backfill-card-cats.py   # gap-fill until 0 missing
```

Do a `FW_LIMIT=200` dry run first and eyeball 30 rows (English `topic` vs assigned ids) before
spending on the full 19,564.

---

## 4. Merge — a patch, then the pool

Do **not** write into the pool from the driver. Mirror the titles flow:

1. `rag/pipeline/card-cats-merge.py`: read all `card-cats/cats-*.jsonl`, validate (1–2 ids, all in
   the 108, no duplicates within a card), dedupe by id (last wins, count dupes), and write
   `rag/pipeline/card-cats-patch.json` = `{ "ffct-00001": ["human-bodies", "health"], ... }`.
   `STRICT=1` exits non-zero on any invalid row. Print: rows, unique ids, invalid dropped, coverage
   of the 19,564.
2. Apply to the pool: extend `rag/pipeline/assemble-card-titles.py` (it already folds `cats` from
   the title shards and is idempotent) to ALSO read `card-cats-patch.json`, setting `cats` only on
   cards that have none — or write a tiny `apply-card-cats.py` that does exactly that. Never
   overwrite an existing `cats`.
3. **Durability warning (same as titles):** `gen-cards-pool.py` regenerates the pool from the bank
   and knows nothing about `cats` or titles — a pool regen wipes both until the patches are
   re-applied. Note this at the top of your apply script; the fix for the pipeline (a re-apply hook
   in the regen path) is a separate task, don't do it here.

Then rebuild the shipped artefacts:

```bash
python3 rag/pipeline/build-cards-db.py     # cards.db + cardsIndex.generated.json (carries cats)
cd packages/mobile && ../../node_modules/.bin/tsx scripts/card-harness.mts   # must stay fully green
```

No APK build — the app owner batches builds.

---

## 5. Validation (all deterministic, all in English)

- `python3 -c` over the patched pool: cards with no `cats` → **0. There is no "Other" bucket
  anywhere in the product** (Luis, 2026-09-05): every card must land on a real leaf. If the model
  cannot place a card after the gap-fill pass, do NOT leave it empty — collect those ids in
  `rag/pipeline/card-cats-unplaced.json` with their `topic`/`title_en`, look for the pattern, and
  either (a) assign them yourself from the ladder (they are usually obvious in English) or (b) if a
  genuine cluster has no leaf, ADD a curated leaf to `card-taxonomy.json` (id, parent, trilingual
  labels in the file's style — Cebuano flagged for native review) and assign to it. Report which.
  Cards with >2 or out-of-ladder ids → **0**.
- Distribution sanity: the 19,564 new assignments should roughly follow the existing 16,968 `ffct`
  siblings — no single leaf taking >12% of the new set, and the domain→root pattern holding
  (LIVING_THINGS cards land under `plants`/`human bodies`/animal leaves, MATTER under
  `matter types`/`heat`/`water`…). Print top-20 leaves for old vs new side by side.
- Spot-check 40 random new rows: `topic` + `title_en` + assigned ids. Target ≥ 36/40 clearly right.
  Record the misses in the run report.
- `sqlite3 packages/mobile/assets/data/cards.db "select count(*) from card_text"` unchanged (46,421);
  `cardsIndex.generated.json` rows with `cats` ≥ 46,300.
- No NUL bytes / invalid UTF-8 in any file you wrote (`python3 -c "open(f,'rb').read().count(b'\\x00')"`).

---

## 6. Cost and time

19,564 cards, 20 per call ≈ **980 calls**, ~600 input + ~600 output tokens each (no titles →
lighter than the precedent). On `deepseek-v4-flash` that is a **few dollars**; with the pacer at the
default concurrency the titles job ran at roughly 1,000 cards / 3–4 minutes, so expect **~1 hour**
including the gap-fill pass. Budget one partial re-run for shards that time out.

---

## 7. Definition of done

- `card-cats-patch.json` covers **all 19,564** (after the unplaced-ids pass in §5), validation
  clean; `card-cats-unplaced.json` documents what needed hand placement or a new leaf.
- `cardsPool.app.json` patched (existing `cats` untouched — diff shows only additions);
  `build-cards-db.py` re-run; harness green.
- 40 hand-checked (English only), ≥ 36 right.
- Committed by path: the driver, the merge/apply scripts, the patch file, the pool, and the
  regenerated `cardsIndex.generated.json` — with a one-line note in the commit body of the leaf
  distribution and the spot-check score. `card-cats/` shard dir is scratch: gitignore it.
- Report back: coverage, top-20 leaf distribution old vs new, spot-check misses, cost.
