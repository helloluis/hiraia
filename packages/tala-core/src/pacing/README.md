# Pacing integration

Import `engine` from `@hiraia/tala-core/pacing` (or `pacing.engine` from the root).
All production functions are pure: no I/O, Date, random identifiers, timezone or
locale-sensitive sorting. Supply a local school date as `today`. ISO weekdays
are Monday=1 through Sunday=7. Rotation weeks start on the Monday of the school
year's opening week. A make-up day uses `followsWeekday` (null means its real
weekday), ignores rotation for that explicit make-up, and only touches the given
assignmentIds when set. Zero-minute shortened periods are omitted.

Class days: a date can hold class when its weekday is one of the school year's
`teachingWeekdays` (normally Monday to Friday) or the assignment's own timetable
has a slot on that weekday. A Saturday or Sunday class the teacher put in the
timetable is therefore a real class day: it gets sessions, competencies, buffer,
assessment, marks and realignment like any weekday. The rule is per assignment,
so it adds no session to another subject, and a timetable with only school
weekdays is unchanged (`weekend.test.ts` keeps snapshots taken before the rule).
No school-year record is rewritten. A weekend session sits in the seven-day
published-week bin of its date (in a term that starts on a Monday, Saturday and
Sunday belong to the week of the Monday before them); there are no official
weekend week or day codes, so which competency lands on a weekend session is
the engine's proposal, and clients label it as Tala's suggestion.

## Setup and ordinary computation

1. Resolve the teacher/Hiraia defaults before passing `defaults`; track.params wins.
2. Pass only the signed-in teacher's checks and records. Corrections are scoped to
   curriculumVersion and applied without mutating published competencies.
3. For mid-year setup, `proposeStartPosition` returns a labelled estimate. Confirm
   or change it, put it on the track, then compute the remaining term.
4. After confirmation, persist `track.allocation = allocationFromPlan(plan)`.
   Accepted exact date/slot placements stay in place on calendar changes; cancelled
   placements become at-risk and unfulfilled past sessions add to sessionsBehind.
   This is the no-silent-rescheduling guarantee. A null allocation is a fresh proposal.
5. For an explicit teacher edit to order/count/weight/pins/merges, clear allocation
   **on the preview copy**, compute, then store the newly accepted allocation.
   Existing overrides are preserved unless the teacher explicitly resets them.

Counts use minimum-constrained proportional allocation and stable largest
remainders. Explicit session counts are fixed. A merged item defaults to one
session. Pins reserve periods before unpinned items; an impossible pin is at-risk,
never silently moved. Assessments and buffers are reserved at the end of the term.
Shortened periods retain their actual minutes; allocation is by session count as
specified, not by invented fractional competencies.

A null SessionMark.slotId applies to the first period of that assignment/date.
Slot-specific marks affect only that period. Partial teaching counts as half a
session for the pace indicator and keeps the competency open. Explicit teaching
before a scheduled date can show a negative (ahead) sessionsBehind value.

## Realignment and undo

Keep the accepted PacingPlan as `baseline` when previewing a disruption. Then call
`previewRealignment({ ...input, baseline, plans }, request)`. Nothing is persisted
by the engine. Shift preserves old session counts; absorb spends only the needed
buffer; compress reduces later low-weight counts without crossing the minimum;
merge requires two adjacent unpinned competencies; add_time produces targeted
make-up CalendarDay records; defer flags the named competencies.

Before confirmation save `realignmentUndo(input)`. On confirmation,
`applyRealignment(input, preview)` returns the next track, calendar records and
plans to persist together. Undo restores the saved track, calendar and plans in
one transaction. Plan moves change placements only, preserving content and lock.
For defer, also use `carryDeferredToTrack(preview.nextTrack, nextTermTrack)` and
persist that receiving track in the transaction; provide the moved competencies
when computing it. The client is responsible for selecting the actual next term.

For all-class disruptions, `previewRealignments(inputs, request)` returns one batch
with deduplicated calendar additions and plan moves. If a multi-group plan would
move to incompatible dates it returns `conflictingPlanIds`, omitting those moves
until the teacher resolves the pairing. Do not apply a conflicting batch silently.

## Timeline

Build the range once across classes/assignments. Each participating group keeps
its own pacing. Theme pairing follows domain first, then sequence; explicit order,
start position and accepted allocation remain authoritative. PairingOverride can
replace one slot or every slot on a date. `pairing.groupIds` says exactly which
subset shares a theme. `byGroupKind`/`byGroupMark` keep mixed lesson, buffer and
assessment states separate. Groups outside the assignment have kind
`other_subject`; the client chooses their subject/independent work. Missing packs
and curriculum:none still produce the timetable and dated plan links.

## Limits that remain outside this module

UI confirmation/undo transactions, notifications, sample roster/plans, device
storage, PDF regeneration and sync are the app/other workers' integration work.
The core provides payloads, not persistence. Official curriculum breadth, policy
applicability and calendar verification are tracked in the server data README.
Teacher-level defaults are synced as profile.pacingParams. Pass
`{ ...publishedDefaults, ...profile.pacingParams }` as defaults; track.params then
overrides those values.


Sessions before a track's startPosition.date are emitted as `before_tala` in
kind/mark and per-group kind/mark, with empty competency IDs and no plan link.
They fill the onboarding week without inventing historical competency mappings.
Do not offer create-plan or missed-session actions for those groups. In a mixed
entry, active groups determine the entry summary and still need their normal plans.
Covered history never contributes to sessionsBehind, even with assumeTaught off.

### Published week hints

`weekFrom`/`weekTo` guide new allocations. Week 1 starts at the term's start date;
subsequent weeks are seven-day bins, even across suspensions. A shared range's
inclusive week count is divided among its competencies for proportional weighting
(`official` source, equal division is an engine heuristic). Explicit published
weights, teacher weights/session counts, pins and accepted allocations take
precedence. Teacher ordering disables date hints. Hints reserve available periods
inside their windows first; remaining sessions fill available space, so a short or
disrupted term may spill outside the published window. No accepted dates move
without a realignment being accepted. Fixture packs have no invented week data.
