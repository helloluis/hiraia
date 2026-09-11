# Parallel handoff: remaining Hiraia card recovery

## Work already underway

Worktree: `/Users/luis/Code/hiraia-unified`, branch `unified`.
First recovery pass is committed as `56364dcf8`; assessment as `7da4a360b`. It reviewed the original9,429 priority facts (plus3 initial out-of-queue cards), recovered4,199, and raised distinct chronological reach to24,385. The second pass targets the frozen12,245 previously unreviewed facts in `tools/curriculum-recovery/second-pass-inventory.json`.

The first screening only searched the competencies previously assigned to each fact. This pass searches **all grades3–10 and exact competencies**, finding correct destinations for misassigned content. Keyword matches are leads only. Many are irrelevant substrings.

The local coordinator has three child reviewers plus a small parent packet. See `second-pass-state.json` for current assignments and validated totals; do not infer ownership from conversation examples. Local work stops by2026-09-10 21:57UTC (September11 05:57 Manila), or earlier at completion. The external agent has no obligation to adopt a new schedule without its user's instruction.

## Ownership and collision prevention

Four disjoint sets cover the frozen12,245 fact IDs:

| Owner | Total facts | Packet numbers | Handoff |
|---|---:|---|---|
| Local coordinator |3,737|100–9999|Current run|
| External A |2,836|10000–19999|RECOVERY-SET-A.md|
| External B |2,836|20000–29999|RECOVERY-SET-B.md|
| External C |2,836|30000–39999|RECOVERY-SET-C.md|

Local includes900 facts already reviewed or reserved at the split, plus2,837 unassigned facts. Each external set contains2,836 previously unassigned facts. No external run has been launched by this coordinator.

`tools/curriculum-recovery/second-pass-partitions.json` is authoritative. Use only your owner's IDs. Old two-way `external` allocation and `external-second-pass-state.json` are superseded; do not use them.

Export sequentially with `second-pass-batch.py --owner external_a --limit 96 --out tools/curriculum-recovery/batch-10000.packet.json`, replacing owner and number with your set. The exporter enforces partition membership, numbered range, and reservations across all packets/reviews. Resume unfinished packets before exporting new ones. Only each set's coordinator exports for its reviewers.

Each external coordinator owns its packet/review/notes files and its `external_a-second-pass-state.json`, `external_b-second-pass-state.json`, or `external_c-second-pass-state.json` ledger. Save assignments before launching reviewers. Do not edit another owner's ledger, local `second-pass-state.json`, shared checkpoints or partition inventory. Ready reviews can be integrated by the local coordinator on a subsequent wake.

## Review method

1. Read `SECOND-PASS.md`, `README.md`, `apply.py`, and the packet under `tools/curriculum-recovery/`.
2. Read full English, exact current competency text, current authored facets, and proposed translations. Do not merely accept the old grade or assignedReviews. Find exact competency wording in prior screening evidence or curriculum source files; authoring files alone supply facet patterns, not the complete curriculum requirement.
3. Search `rag/pipeline/gradeN-lessons.authoring.json` across all grades. Consider whether the card adds a sound teaching component; it need not perform an entire class activity. Never credit a diagram/table/investigation facet unless it genuinely teaches that component. Check **every facet the chosen code will admit**, not just the desired one.
4. Inspect both `rag/pipeline/cardsPool.app.json` and `cardsPool.merged.json`, every card ID sharing the stable fact ID, and all EN/TL/BIS wording for approval. The compiler can select another variant; unresolved identity/wording differences must be held.
5. Verify uncertain factual claims using primary sources. Hold unresolved factual/translation/age-level issues with a precise reason and potential correct destination. Also hold sound content requiring a new or repaired facet: describe the needed repair rather than silently loosening filters.
6. Save one decision per actually reviewed packet fact using the established schema, atomically after the complete packet is reviewed. Do not mark unseen cards reviewed. Preserve stable IDs, hash and previous exclusion. Run `python3 tools/curriculum-recovery/apply.py PATH_TO_REVIEW` **without `--apply`**.

Schema: `factId`, `id`, `textHash`, `previousExclusion`, `reviewedAt` (UTC ISO), `reviewer`, `disposition` (`recover_core` or `hold`), `codes`, `reason`, `evidence` (objects with exact `lesson`, `unit`, English `quote`), `translationsChecked`. Include source URLs and specific issues in the reason. Holds normally have empty codes/evidence and retain a potential destination in reason. Do not rewrite source copy in this pass.

## Centralized integration — local coordinator only

**External reviewers/coordinator must not apply recoveries, change tags/authoring/generated data, run mutating compilers, update shared checkpoints, commit, push, build or deploy.** There are unrelated agents editing website/images/content; preserve their files.

The local coordinator validates full packet identity and disjointness, reviews proposed decisions, applies sequentially with rollback, regenerates all eight manifests and curriculum tags, audits reach, and verifies no previous cardIds/relatedCardIds are lost. It runs70 recovery/grade/calendar/quiz regression tests plus mobile type-check. Reviewed proposals are pending until this succeeds. Shared cumulative counts include both partitions after integration; ownership and per-partition totals remain separate.

## Report back

Report packet filenames, reviewed/proposed-recovery/hold counts, dry-run result, factual or translation issues, duplicate variants, and any blocked packets. Maintain external assignment/progress state in its own file. No direct messaging of students or other people. No paid external-model API calls. Stop when external IDs are exhausted, or at your separately configured time/rate limit, saving truthful unfinished counts.
