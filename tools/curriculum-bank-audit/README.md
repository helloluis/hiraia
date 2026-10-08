# Card-bank curriculum admission

Count actual card IDs. The main bank and supplemental lesson cards are separate denominators;
source-fact counts never stand in for card counts. The reproducible inventory is:

```sh
python3 tools/curriculum-bank-audit/audit.py --out build/curriculum-bank-inventory
python3 tools/curriculum-bank-audit/audit.py --out build/curriculum-bank-inventory --check
```

`cards.tsv` assigns every main-bank card to required curriculum, reviewed examples, an
explicit hold, or pending current-text review. `summary.json` binds its inputs and ledger
hash. This is classification, not a claim to have scientifically reviewed the entire bank.

The October 8 calibration rejected wholesale reuse of September tag-audit decisions.
The historical review was about placement and missed science and translation defects.
A positive tag, matching category, or unchanged English body cannot approve a card.
The completed 59-card calibration is recorded in `calibration-final-20261008.json`;
the earlier partial summary and decisions remain as history. Only the final
`reviews/20261008-calibration-002.jsonl` is an admission input.

Fresh decisions in `reviews/` read the current English, Tagalog and Cebuano titles and
bodies, check exact lesson relevance, and preserve uncertainty as a hold. Each acceptance
pins the complete current copy (including emphasis) and an individual lesson rationale.
`rag/pipeline/lesson_examples.py` checks these records before compilation, preserving
global/grade exclusions and required teaching units. A source reference supports only the
specific claim examined; it is not native-language certification.

Optional science collections use admitted lesson cards only. They provide additional ways
to read those cards; their counts cannot be added to curriculum counts as if they were new
cards. Review queues and proposed placements must never be described as learner coverage.

The completed October 8 batch reviewed 509 distinct current copies, admitted 273 cards
in 328 lesson placements, and preserved 236 holds. `reviews/20261008-inputs.json` pins the
four effective input files, the original reviews and correction evidence. The resulting
curriculum uses 7,962 of 49,155 main-bank cards (16.20%), plus 165 supplemental lesson cards.
See [the completion report](../../docs/card-bank-expansion-20261008.json) for per-grade and
per-topic counts. The 25,207 pending cards and 15,986 explicit holds remain outside the
curriculum; the disposition ledger is not a substitute for their full current-copy review.

To prepare the next bounded batch from the current bank:

```sh
python3 tools/curriculum-bank-audit/prepare_review.py --grades 3 4 --limit 150 --out build/next-review/grades3-4.json
python3 tools/curriculum-bank-audit/prepare_review.py --grades 5 6 --limit 150 --exclude-packet build/next-review/grades3-4.json --out build/next-review/grades5-6.json
```

Packets prioritize smaller lesson pools, preserve full trilingual copy and lesson objectives,
exclude admitted/held cards, and bind all source files. Use `--exclude-packet` for every other
concurrent packet so two reviewers do not inspect the same ID. Proposed mappings are not
approvals; old tags can be wrong. Verify each accepted placement independently.

Save one JSONL decision per card under `reviews/`, with `id`, `copySha256`, `decision`
(`accept` or `hold`), `reviewedFor` (lesson key to individual rationale; empty for holds),
`reason`, `references` and `checkedLanguages` (`en`, `tl`, `bis`). Preserve original decisions
and later corrections; integrate a separately pinned effective file once they are reconciled.

```sh
python3 tools/curriculum-bank-audit/integrate.py --review tools/curriculum-bank-audit/reviews/NEW-DECISIONS.jsonl --out build/next-review/integration-check
```

Inspect that candidate and its validation before invoking the same reviewed inputs with
`--apply` and a new output directory. Regenerate all eight lesson manifests, lesson similarity,
content reach and website curriculum artifacts. Check the original core audit, all compilers,
review and navigation tests, both TypeScript targets, exact database copy and the final
per-card inventory. Keep the required teaching units and their quiz assignments unchanged.
