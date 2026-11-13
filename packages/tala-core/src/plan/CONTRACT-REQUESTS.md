# Worker H contract requests — addressed

The orchestrator added `section_revision` and `Plan.lock.lockedBy` in `3c9978d27`.
Helpers now return the shared `SectionRevision` records, which callers sync through
`SyncEngine.put('section_revision', revision)`. Persist previous revisions before
writing replacement sections; do not acknowledge a multi-section generation until
all its records are durable. `sectionRevision` snapshots manual edits/restores too.
`boundSectionHistory` consumes newest-first server-ordered history; keep unsent
revisions outside pruning. The default bound is 20 per section.

Accepted orchestrator policy: the helper uses configurable 50% lexical-newness and
requires at least half the original length, rejecting deletion, case-only changes,
and reordering as rewrite evidence. This is conservative evidence, not semantic
judgment. Preserve the earliest AI baseline separately if bounded history would
otherwise remove it; missing history must never clear the AI-drafted label.
