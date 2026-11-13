import type { PacingInput, TimelineInput, TimelineEntry } from '../contracts/curriculum';
import { applyChecks, domainKey } from '../curriculum';
import { computePacing, orderedCompetencies } from './compute';
import { enumerateSessions } from './sessions';

export function buildTimeline(input: TimelineInput): TimelineEntry[] {
  const entries = new Map<string, TimelineEntry>();
  const competencyMap = new Map(input.competencies.map(c => [c.id, c]));
  const key = (date: string, assignmentId: string, slotId: string) => `${date}|${assignmentId}|${slotId}`;
  for (const assignment of [...input.assignments].sort((a, b) => a.id.localeCompare(b.id))) {
    const cls = input.classes.find(c => c.id === assignment.classId && c.schoolYearId === input.schoolYear.id && !c.archived);
    if (!cls) continue;
    for (const term of input.schoolYear.terms) {
      if (term.startDate > input.to || term.endDate < input.from) continue;
      const sessions = enumerateSessions(input.schoolYear, term, assignment, input.calendarDays);
      const ensure = (s: typeof sessions[number]): TimelineEntry => {
        const id = key(s.date, assignment.id, s.slotId);
        let e = entries.get(id);
        if (!e) {
          e = { date: s.date, classId: cls.id, assignmentId: assignment.id, slotId: s.slotId, minutes: s.minutes, subjectName: assignment.subjectName, byGroup: {}, kind: 'lesson', planId: null, planState: 'none', mark: null, pairing: null };
          entries.set(id, e);
        }
        return e;
      };
      let anchorDomains: (string | null)[] | null = null;
      for (const groupId of assignment.gradeGroupIds) {
        const group = cls.gradeGroups.find(g => g.id === groupId);
        const track = input.tracks.find(t => t.assignmentId === assignment.id && t.gradeGroupId === groupId && t.termId === term.id && t.classId === cls.id);
        if (!group || !track || cls.curriculum === 'none') continue;
        const pacing: PacingInput = { track, assignment, schoolYear: input.schoolYear, term, competencies: input.competencies.filter(c => c.grade === group.grade && c.learningAreaId === assignment.learningAreaId && (track.curriculumVersion === null || c.id.startsWith(`${track.curriculumVersion}.`))), checks: input.checks, calendarDays: input.calendarDays, marks: input.marks, today: input.today, defaults: input.defaults };
        const corrected = applyChecks(pacing.competencies, input.checks, track.curriculumVersion);
        corrected.forEach(c => competencyMap.set(c.id, c));
        const ordered = orderedCompetencies(pacing);
        if (anchorDomains && !track.overrides.order && !track.startPosition && (track.params.pairingRule ?? input.defaults.pairingRule) === 'theme_then_sequence') {
          const pending = [...ordered];
          const order: string[] = [];
          for (const domain of anchorDomains) {
            const match = domain ? pending.findIndex(c => domainKey(c.domain) === domain && !track.overrides.pins?.[c.id]) : -1;
            const next = pending.splice(match < 0 ? 0 : match, 1)[0];
            if (next) order.push(next.id);
          }
          order.push(...pending.map(c => c.id));
          pacing.track = { ...track, overrides: { ...track.overrides, order } };
        }
        if (!anchorDomains) anchorDomains = ordered.map(c => domainKey(c.domain));
        const plan = computePacing(pacing);
        for (const item of plan.items) for (const s of item.sessions) ensure(s).byGroup[groupId] = [...item.competencyIds];
        for (const s of plan.bufferSessions) { const e = ensure(s); if (!Object.keys(e.byGroup).length) e.kind = 'buffer'; }
        for (const s of plan.assessmentSessions) { const e = ensure(s); if (!Object.keys(e.byGroup).length) e.kind = 'assessment'; }
      }
      // Blank/custom-curriculum tracks still have a usable timetable and plan placements.
      if (cls.curriculum === 'none' || !input.tracks.some(t => t.assignmentId === assignment.id && t.termId === term.id)) for (const s of sessions) ensure(s);
    }
  }
  for (const e of entries.values()) {
    const override = input.pairingOverrides.find(o => o.classId === e.classId && o.assignmentId === e.assignmentId && o.date === e.date && (o.slotId === null || o.slotId === e.slotId));
    const assignment = input.assignments.find(a => a.id === e.assignmentId)!;
    if (override) {
      for (const [group, ids] of Object.entries(override.byGroup)) if (assignment.gradeGroupIds.includes(group)) e.byGroup[group] = [...ids];
    }
    const groups = Object.keys(e.byGroup);
    if (groups.length > 1) {
      const domains = new Map<string, string[]>();
      for (const group of groups) {
        const keys = new Set(e.byGroup[group]!.map(id => domainKey(competencyMap.get(id)?.domain ?? null)).filter((k): k is string => k !== null));
        for (const d of keys) domains.set(d, [...(domains.get(d) ?? []), group]);
      }
      const shared = [...domains.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0]?.[1] ?? [];
      e.pairing = { shared: shared.length > 1, groupIds: shared.length > 1 ? shared : [], overridden: !!override };
    }
    if (groups.length) e.kind = 'lesson';
    const plan = input.plans.filter(p => p.state !== 'archived').find(p => p.placements.some(x => x.classId === e.classId && (x.assignmentId === null || x.assignmentId === e.assignmentId) && x.dates.includes(e.date)));
    if (plan) { e.planId = plan.id; e.planState = plan.state === 'locked' ? 'locked' : 'draft'; }
    const marks = input.marks.filter(m => m.classId === e.classId && m.assignmentId === e.assignmentId && m.date === e.date && groups.includes(m.gradeGroupId));
    const states = groups.map(group => {
      const mark = marks.find(m => m.gradeGroupId === group && (!m.competencyIds.length || m.competencyIds.some(id => e.byGroup[group]!.includes(id))));
      if (mark) return mark.status;
      const track = input.tracks.find(t => t.assignmentId === e.assignmentId && t.gradeGroupId === group && input.schoolYear.terms.some(term => term.id === t.termId && term.startDate <= e.date && term.endDate >= e.date));
      return e.date < input.today && (track?.params.assumeTaught ?? input.defaults.assumeTaught) ? 'assumed_taught' : null;
    });
    e.mark = states.includes('not_taught') ? 'not_taught' : states.includes('partial') ? 'partial' : states.length && states.every(s => s === 'taught') ? 'taught' : states.length && states.every(s => s === 'taught' || s === 'assumed_taught') ? 'assumed_taught' : null;
  }
  return [...entries.values()].filter(e => e.date >= input.from && e.date <= input.to).sort((a, b) => a.date.localeCompare(b.date) || a.classId.localeCompare(b.classId) || a.assignmentId.localeCompare(b.assignmentId) || a.slotId.localeCompare(b.slotId));
}
