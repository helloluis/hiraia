# Pacing contract requests

Resolved by orchestrator and adopted: `previewRealignment` optional `baseline`,
`CalendarDay.followsWeekday`/`assignmentIds`, `PairingOverride.slotId`.

Remaining:

1. `SessionMark` needs optional `slotId: Id | null` (default null). Currently two
   sessions of the same assignment/group on a date cannot be distinguished. A
   date-scoped mark applies to both; the engine must not pretend it knows which
   period was missed.
2. `TimelineEntry` needs `byGroupKind` and `byGroupMark` (or equivalent) if groups
   can have different buffer/assessment/mark states in one slot. Current `kind`
   is lesson when any group has competencies; `mark` is the least-complete group.
3. `LearningArea.stage` is singular but Science spans elementary and JHS. Current
   index carries two entries with the same area id and disjoint grade lists.
   Prefer `stages: [...]` or grade-to-stage mapping; consumers should key by id+stage
   until resolved.
4. For exact persisted session placement (two slots/day, disruption without silent
   redistribution), a track should store an accepted session allocation keyed by
   competency + slot, or reference an accepted baseline snapshot. Current overrides
   preserve counts and first dates, but date-only pins cannot represent two separate
   same-day start slots. `baseline` solves preview comparison, not snapshot persistence.

The engine takes defaults as already resolved Hiraia/teacher settings. The existing
record contract has no teacher-level PacingParams; clients can pass their merged
defaults, or request a profile.pacingParams field for cross-device persistence.
