# Hiraia science fact bank

The curated, distilled grounding corpus for the on-device tutor — tight, grade-level
**Tagalog** science facts (the experiment-validated grounding format; see
[`../sources/GROUNDING.md`](../sources/GROUNDING.md)).

## Source of truth: `science-facts.jsonl`
One **atomic fact per line**. Edit this; never hand-edit the built `.db`.

```jsonc
{
  "id": "matter-states-particles-g3",
  "domain": "MATTER",            // one of rag/config.js SCIENCE_DOMAINS:
                                 // MATTER | LIVING_THINGS | FORCE_MOTION_ENERGY | EARTH_SPACE
  "topic": "states of matter",
  "grades": [3,4,5],             // grade band (from AAAS/NRC grade-band endpoints)
  "terms": ["solid","liquid","gas","particle"],  // English sci terms (retrieval + linking)
  "fact": { "tl": "...", "en": "..." },           // distilled grade-level fact, bilingual
  "source": "NRC PS1.A; AAAS BSL Ch.4",           // provenance (which open framework)
  "generator": "claude",
  "reviewed": false              // human review deferred until funded; facts ship AS-IS for now
}
```

> ⚠️ **No human verification yet.** Facts are distilled by frontier Claude from authoritative
> open frameworks (NRC / AAAS / Harlen) and ship **as-is** (`reviewed: false`). Human reviewers
> are a later, funded step. The `reviewed` flag + `source` make a later audit pass straightforward.

## Build: `science-facts.jsonl` → `science.db`
```bash
python3 rag/scripts/build-bank.py                 # build the SQLite/FTS5 db
python3 rag/scripts/build-bank.py "ano ang photosynthesis"   # build + test retrieval
```
`science.db` is a **build artifact** (gitignored): a SQLite database with an **FTS5** table over
`fact.tl + topic + terms`, giving **BM25 retrieval** (`bm25()` ranking) on-device with **no
embedding model** — the lean path for a 4 GB phone. The app ships the `.db`; retrieval is
`WHERE facts_fts MATCH ? ORDER BY bm25(facts_fts)`, optionally pre-filtered by `domain`/`grades`.

(Same record convention as `packages/factoids` — bilingual text, grades, source, review gate.)
