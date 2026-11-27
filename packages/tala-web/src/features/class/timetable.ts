/**
 * Editing the days, minutes and start time of one subject on the class screen (pure: no React, no I/O). Any of the
 * seven days can be chosen, Saturday and Sunday included (Luis, 27 Nov 2026).
 */
import type { PacingTrack, TeachingAssignment, TimetableSlot } from '@hiraia/tala-core/contracts';

const ordered = (days: Iterable<number>): number[] => [...new Set(days)].sort((a, b) => a - b);

/** The distinct days a subject meets, Monday to Sunday. */
export const meetingDays = (assignment: Pick<TeachingAssignment, 'slots'>): number[] =>
  ordered(assignment.slots.map((s) => s.weekday));

/**
 * The subject's slots after the teacher picks its days. A day it already met on keeps that slot's id (marks and
 * accepted placements refer to it) and rotation; a new day gets the id `<assignment id>-<weekday>`.
 */
export function slotsForDays(
  assignment: Pick<TeachingAssignment, 'id' | 'slots'>,
  days: readonly number[],
  minutes: number,
  startTime: string
): TimetableSlot[] {
  return ordered(days).map((weekday) => {
    const existing = assignment.slots.find((s) => s.weekday === weekday);
    return {
      id: existing?.id ?? `${assignment.id}-${weekday}`,
      weekday,
      startTime: /^\d{2}:\d{2}$/.test(startTime) ? startTime : null,
      minutes,
      rotation: existing?.rotation ?? null,
    };
  });
}

/**
 * The subject's tracks to save with the new days. A track keeps exact placements once a realignment was applied
 * (`allocation`); those were made for the old days, so a newly added Saturday would get no lesson at all. When the
 * days change, the placements are cleared, as Advanced pacing does for a changed parameter, and the engine proposes
 * the new timetable. Start positions, marks and the teacher's overrides stay. Unchanged days touch no track.
 */
export function tracksToRepace(
  tracks: readonly PacingTrack[],
  assignment: Pick<TeachingAssignment, 'id' | 'slots'>,
  days: readonly number[]
): PacingTrack[] {
  const before = meetingDays(assignment);
  const after = ordered(days);
  if (before.length === after.length && before.every((d, i) => d === after[i])) return [];
  return tracks
    .filter((t) => t.assignmentId === assignment.id && t.allocation !== null)
    .map((t) => ({ ...t, allocation: null }));
}
