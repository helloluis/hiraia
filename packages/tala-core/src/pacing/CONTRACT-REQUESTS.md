# Pacing contract requests

Resolved by orchestrator and adopted, with tests:

- `previewRealignment` optional `baseline`.
- `CalendarDay.followsWeekday` and `assignmentIds`.
- `PairingOverride.slotId` and `SessionMark.slotId`.
- `PacingTrack.allocation`: persisted exact competency/date/slot placements.
- `TimelineEntry.byGroupKind` / `byGroupMark`.
- `LearningArea.stages`: one index entry per learning area, primary stage retained.
- API route path literals: temporary route-param casts have been removed.

Also resolved: `TeacherProfile.pacingParams` (partial, default {}). Clients pass
`{ ...publishedDefaults, ...profile.pacingParams }` as `input.defaults`.
There are no outstanding contract change requests.

No other adapter is required. Extra pure helpers (allocationFromPlan,
applyRealignment, realignmentUndo, previewRealignments, carryDeferredToTrack) are
exported from the pacing folder without changing the PacingEngine interface.
