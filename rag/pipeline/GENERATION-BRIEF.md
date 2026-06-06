# Fact-generation brief (Phase 1 → 5,000)

The reusable spec for every generator — whether a `/loop` iteration or a workflow
agent. The job: turn a **concept** (from `worklist.jsonl`) into one or more
**verified, trilingual, on-schema science facts** for the Hiraia bank.

## The product this serves
Hiraia is a kid's science **companion** — it should *know*, not say "I don't know."
But it must never **invent**. Every fact must be accurate (the model speaks ONLY
from this bank). Distill from authoritative open sources; do not free-associate.

## Grounding sources (in priority order)
1. `rag/sources/frameworks/` — NRC Framework (`nrc-text/`), AAAS Benchmarks
   (`aaas-text/`), Harlen Big Ideas. The factual backbone.
2. `rag/sources/curriculum-guides/` — DepEd MATATAG Science CG (grade-banding + PH framing).
3. For long-tail curiosity concepts not in the frameworks (a specific animal,
   dinosaur, planet, element): write only **consensus, encyclopedia-stable** facts
   a children's reference would state plainly. If a claim is uncertain or contested,
   omit it. Prefer fewer, rock-solid facts over more, shaky ones.

## Schema (one JSON object per fact, matches `rag/bank/science-facts.jsonl`)
```json
{
  "id": "kebab-case-unique-slug-gN",        // unique; suffix the primary grade
  "domain": "MATTER|LIVING_THINGS|FORCE_MOTION_ENERGY|EARTH_SPACE",
  "topic": "short english topic phrase",     // retrieval-weighted highest
  "grades": [4, 5, 6],                        // DepEd grade band where it fits
  "terms": ["...TL...","...BIS...","...EN..."],// SEE retrieval rule below — REQUIRED
  "fact": {
    "tl": "<one clear sentence, Tagalog>",
    "en": "<one clear sentence, English>",
    "bis": "<one clear sentence, Cebuano/Bisaya>"
  },
  "source": "NRC PS1.A; DepEd G5 Q1",        // where it's grounded
  "generator": "claude",
  "reviewed": false
}
```

## Hard rules
- **All three languages, always.** No fact ships without tl + en + bis. Translate
  faithfully; keep it one short, grade-appropriate sentence each. No English-only.
- **Retrieval `terms` (the #1 known issue):** pack the distinctive **Tagalog AND
  Bisaya AND English** content words a kid would query with — including inflection
  variants where they differ (`gumagawa`/`ginagawa`, `gibuhat`/`buhaton`). Retrieval
  is now language-scoped (`RagStore`), so each language's query words must appear in
  `terms` or that language's body. Skipping vernacular terms = the fact is unfindable
  in that language.
- **One concept, the right number of facts.** A rich concept (a planet, a body
  system) may yield 2–5 facts (distinct sub-claims); a narrow one yields 1. Don't
  pad; don't merge unrelated claims into one fact.
- **Grade-band honestly.** Match vocabulary + depth to `grades`. A grade-3 fact and
  a grade-9 fact on the same topic are different facts.
- **No invention.** No number, mechanism, or name not supported by a source or
  encyclopedia-stable consensus. When unsure, omit.
- **Dedup.** Don't regenerate a concept already in the bank (check id/topic). The
  worklist is pre-filtered, but verify before writing.
- **PH-relevant where natural** (local examples, PAGASA/PHIVOLCS, native species) —
  a Filipino tutor should feel local.

## Pipeline stages (scripts)
1. `build-worklist.py` → `worklist.jsonl` (concepts to cover; done).
2. **generate** → append on-schema facts to `rag/bank/science-facts.jsonl`
   (this brief; loop or workflow).
3. `validate.py` → schema + unique ids + all-3-languages + terms-have-vernacular.
4. `rag/scripts/export-facts-ts.py` → `packages/shared/src/rag/facts.generated.ts`
   (the bundled artifact the app ships).
5. **Phase-1 exit:** `retrieval-stress.mts` — scored precision eval across the
   bigger bank (hit-rate@k per language + morphology variants). This is what 5,000
   exists to stress-test before we commit to five digits.
