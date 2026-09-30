# Assessment bank evaluation

This is analysis tooling, not the assessment feature. It reads the **newer merged
bank** designated by Luis: `rag/bank/quiz-bank-v2.jsonl`. It does not regenerate
questions, cards.db, application indexes, or Tala's catalog.

Run from the repository root:

```sh
python3 tools/assessment-evaluation/audit-bank.py --out /tmp/hiraia-assessment-audit
```

The dated report under `reports/2026-09-28/` contains:

- `summary.json`: source hashes, inventory, structural checks, coverage and simple answer-length baselines.
- `competencies.csv`: candidate counts for all 324 internal curriculum codes.
- `subcategories.csv`: candidate counts for all 335 grade-specific taxonomy leaves.
- `lesson-units.csv`: candidate counts for all 1,035 authored lesson units.
- `structural-flags.json`: exact duplicate-option flags in the projected current-card set.
- `sample.json`: deterministic sample of 32 v2 questions, one per grade/quarter, linked to lesson units and source cards.
- `sample-review.csv`: exploratory assistant review of that sample. These are selection leads and holds, not teacher approvals, a native-language review, or a measured bank-wide defect rate.
- `rotation-capacity.json`: optimistic capacity probe: 12 forms of 12 questions per grade, three per domain, without repeating exact English stems. It ignores actual exposure and date restrictions and does not establish equivalent difficulty.

`bank_matching_core_cards` preserves the bank as it stands. The separate projection
applies the same lesson supplement precedence used in `lessonSupplement.ts` and
`cards.ts`; this is not an inspection of a released APK. Generated question files
and local SQLite contents are not substituted for the user's specified bank.

The three-option coverage columns are a **candidate shortlist scenario**, not a
claim that four-option questions are unusable. All-option counts are provided
alongside them. Structural validity does not imply factual quality. Exact stem
deduplication does not imply independent concepts; one question can be linked to
multiple grades or competencies. Do not sum overlapping coverage as unique items.

The twelve-stem threshold illustrates a small rotation budget (three questions
from one subcategory across four check-ins); it is not a DepEd standard or a
psychometric validation threshold. A shortfall can come from missing mappings,
missing variants, or genuinely missing content. Review those in that order.

Sources are hashed before and after each run; changing content during a run causes
failure. The script uses exact text comparisons: no punctuation stripping, case
folding, or operator normalization. Answer-length scores break longest-option ties
uniformly and exclude structurally flagged items. Slight differences from earlier
exploratory figures reflect that exclusion.

See the [evaluation and implementation plan](../../docs/ASSESSMENT-EVALUATION-AND-PLAN-20260928.md).
