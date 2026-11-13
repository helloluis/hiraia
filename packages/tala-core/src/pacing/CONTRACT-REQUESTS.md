# Pacing contract requests

Resolved by orchestrator and adopted, with tests:

- `previewRealignment` optional `baseline`.
- `CalendarDay.followsWeekday` and `assignmentIds`.
- `PairingOverride.slotId` and `SessionMark.slotId`.
- `PacingTrack.allocation`: persisted exact competency/date/slot placements.
- `TimelineEntry.byGroupKind` / `byGroupMark`.
- `LearningArea.stages`: one index entry per learning area, primary stage retained.
- API route path literals: temporary route-param casts have been removed.

One remaining product-contract gap: §7.3 says parameters have teacher-level
settings as well as Hiraia defaults and per-track overrides. Add
`TeacherProfile.pacingParams: PacingParams.partial().default({})` (or an equivalent
synced settings record). The engine already accepts resolved Hiraia+teacher values
through `PacingInput.defaults`; no engine change is needed when this is persisted.

No other adapter is required. Extra pure helpers (allocationFromPlan,
applyRealignment, realignmentUndo, previewRealignments, carryDeferredToTrack) are
exported from the pacing folder without changing the PacingEngine interface.
