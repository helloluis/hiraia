import { compareText } from '../curriculum';
import type { PacingEngine, TeachingSession } from '../contracts/curriculum';
import { NON_TEACHING_KINDS } from '../contracts/records';
import { datesBetween, ordinal, weekday } from './dates';

export const enumerateSessions: PacingEngine['enumerateSessions'] = (
  year,
  term,
  assignment,
  days
) => {
  const result: TeachingSession[] = [];
  const from = term.startDate > year.startDate ? term.startDate : year.startDate;
  const to = term.endDate < year.endDate ? term.endDate : year.endDate;
  const relevant = days.filter(
    (d) => d.schoolYearId === year.id && (d.classId === null || d.classId === assignment.classId)
  );
  // Weeks are anchored to Monday of the school year's first week, not device locale.
  const anchor = ordinal(year.startDate) - ((weekday(year.startDate) + 6) % 7);
  for (const date of datesBetween(from, to)) {
    const events = relevant.filter(
      (d) =>
        d.date === date &&
        (!['makeup', 'shortened'].includes(d.kind) ||
          !d.assignmentIds ||
          d.assignmentIds.includes(assignment.id))
    );
    const makeup = events.some((d) => d.kind === 'makeup');
    if (
      !makeup &&
      (events.some((d) => NON_TEACHING_KINDS.includes(d.kind)) ||
        !year.teachingWeekdays.includes(weekday(date)))
    )
      continue;
    const week = Math.floor((ordinal(date) - anchor) / 7);
    const follows =
      events.filter((d) => d.kind === 'makeup').sort((a, b) => compareText(a.id, b.id))[0]
        ?.followsWeekday ?? weekday(date);
    const slots = assignment.slots.filter(
      (s) =>
        s.weekday === follows &&
        (makeup || !s.rotation || week % s.rotation.everyWeeks === s.rotation.week - 1)
    );
    for (const slot of slots.sort(
      (a, b) => compareText(a.startTime ?? '', b.startTime ?? '') || compareText(a.id, b.id)
    )) {
      const caps = events
        .filter((d) => d.kind === 'shortened' && d.minutesOverride !== null)
        .map((d) => d.minutesOverride!);
      const minutes = Math.min(slot.minutes, ...caps);
      if (minutes > 0)
        result.push({
          date,
          assignmentId: assignment.id,
          slotId: slot.id,
          minutes,
          termId: term.id,
        });
    }
  }
  return result;
};
