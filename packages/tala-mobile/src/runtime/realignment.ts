import type {
  CalendarDay,
  TimelineInput,
  RealignmentOption,
  RealignmentPreview,
} from '@hiraia/tala-core/contracts';
import { engine as pacing } from '@hiraia/tala-core/pacing';
/** Every affected grade track is previewed against what the teacher saw, never silently moved. */
export function previewNoClass(
  input: TimelineInput,
  day: CalendarDay,
  option: RealignmentOption = 'absorb'
): RealignmentPreview[] {
  return input.tracks.flatMap((track) => {
    const cls = input.classes.find((c) => c.id === track.classId),
      group = cls?.gradeGroups.find((g) => g.id === track.gradeGroupId),
      term = input.schoolYear.terms.find((t) => t.id === track.termId),
      assignment = input.assignments.find((a) => a.id === track.assignmentId);
    if (
      !group ||
      !term ||
      !assignment ||
      day.date < term.startDate ||
      day.date > term.endDate ||
      (day.classId && day.classId !== track.classId)
    )
      return [];
    const base = {
      track,
      term,
      assignment,
      schoolYear: input.schoolYear,
      calendarDays: input.calendarDays,
      competencies: input.competencies.filter(
        (c) =>
          c.grade === group.grade &&
          c.learningAreaId === assignment.learningAreaId &&
          c.termIndex === term.index
      ),
      checks: input.checks,
      marks: input.marks,
      today: input.today,
      defaults: input.defaults,
      plans: input.plans,
    };
    return [
      pacing.previewRealignment(
        {
          ...base,
          calendarDays: [...base.calendarDays, day],
          baseline: pacing.computePacing(base),
        },
        { option }
      ),
    ];
  });
}

export function hasIncompatibleMoves(previews: RealignmentPreview[]) {
  const dates = new Map<string, string>();
  for (const p of previews)
    for (const m of p.planMoves) {
      const key = `${m.planId}.${m.classId}.${m.from.join(',')}`,
        next = m.to.join(',');
      if (dates.has(key) && dates.get(key) !== next) return true;
      dates.set(key, next);
    }
  return false;
}
