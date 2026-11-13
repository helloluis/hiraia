import type { PacingInput, PacingPlan, RealignmentOption, RealignmentPreview, RealignmentRequest } from '../contracts/curriculum';
import type { CalendarDay, Plan } from '../contracts/records';
import { computePacing } from './compute';
import { enumerateSessions } from './sessions';

/** Provide the last accepted plan for exact pre-disruption allocation and date preservation. */
export type RealignmentInput = PacingInput & { plans: Plan[]; baseline?: PacingPlan };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export function availableRealignments(input: PacingInput): RealignmentOption[] {
  const plan = computePacing(input);
  const options: RealignmentOption[] = plan.bufferSessions.length ? ['absorb', 'shift'] : ['shift'];
  if (plan.items.some(i => !i.pinned && i.sessions.length > plan.effectiveParams.minSessionsPerCompetency)) options.push('compress');
  if (plan.items.filter(i => !i.pinned && !['before_tala', 'deferred', 'taught', 'assumed_taught'].includes(i.state)).length > 1) options.push('merge');
  if (input.assignment.slots.length) options.push('add_time');
  if (plan.items.some(i => !['before_tala', 'deferred', 'taught', 'assumed_taught'].includes(i.state))) options.push('defer');
  return options;
}
export function previewRealignment(input: RealignmentInput, request: RealignmentRequest): RealignmentPreview {
  const before = copy(input.baseline ?? computePacing(input));
  const nextTrack = copy(input.track);
  const newCalendarDays: CalendarDay[] = [];
  const sessions: Record<string, number> = { ...nextTrack.overrides.sessions };
  // Freeze previous allocation: a shift never silently compresses the old proposal.
  for (const item of before.items) if (item.sessions.length && !['before_tala', 'deferred'].includes(item.state)) {
    for (const id of item.competencyIds) sessions[id] = item.sessions.length;
  }
  nextTrack.overrides.sessions = sessions;
  const ids = request.competencyIds ?? [];
  const active = before.items.filter(i => !['before_tala', 'deferred', 'taught', 'assumed_taught'].includes(i.state));
  if (request.option === 'absorb') nextTrack.params.bufferRatio = 0;
  if (request.option === 'compress') {
    const capacity = enumerateSessions(input.schoolYear, input.term, input.assignment, input.calendarDays).filter(s => !nextTrack.startPosition || s.date >= nextTrack.startPosition.date).length;
    let deficit = Math.max(0, before.items.reduce((n, i) => n + i.sessions.length, 0) + before.bufferSessions.length + before.assessmentSessions.length - capacity, Math.ceil(before.sessionsBehind));
    const candidates = [...active].filter(i => !i.pinned).sort((a, b) => {
      const weight = (item: typeof a) => item.competencyIds.reduce((n, id) => n + (nextTrack.overrides.weights?.[id] ?? input.competencies.find(c => c.id === id)?.weight ?? 1), 0);
      return weight(a) - weight(b);
    });
    for (const item of candidates) {
      const count = item.sessions.length;
      const take = Math.min(deficit, Math.max(0, count - before.effectiveParams.minSessionsPerCompetency));
      item.competencyIds.forEach(id => { sessions[id] = count - take; }); deficit -= take;
    }
  }
  if (request.option === 'merge') {
    if (ids.length !== 2 || ids[0] === ids[1]) throw new Error('Choose two adjacent competencies to combine.');
    const positions = ids.map(id => active.findIndex(i => i.competencyIds.includes(id)));
    if (positions.some(i => i < 0) || Math.abs(positions[0]! - positions[1]!) !== 1 || positions.some(i => active[i]!.pinned)) throw new Error('Choose two adjacent, unpinned competencies.');
    const merged = [...new Set(positions.flatMap(i => active[i]!.competencyIds))];
    nextTrack.overrides.merges = [...(nextTrack.overrides.merges ?? []).filter(g => !g.some(id => merged.includes(id))), merged];
    merged.forEach(id => { sessions[id] = 1; });
  }
  if (request.option === 'defer') {
    if (!ids.length || ids.some(id => !active.some(i => i.competencyIds.includes(id)))) throw new Error('Choose remaining competencies to carry into the next term.');
    nextTrack.overrides.deferred = [...new Set([...(nextTrack.overrides.deferred ?? []), ...ids])];
  }
  if (request.option === 'add_time') {
    if (!request.makeupDates?.length) throw new Error('Choose at least one make-up date.');
    for (const date of [...new Set(request.makeupDates)].sort()) {
      if (date < input.term.startDate || date > input.term.endDate) throw new Error('Make-up dates must be within this term.');
      if (input.calendarDays.some(d => d.date === date && d.kind === 'makeup' && d.schoolYearId === input.schoolYear.id && (d.classId === null || d.classId === nextTrack.classId))) continue;
      newCalendarDays.push({ id: `makeup:${nextTrack.classId}:${date}`, schoolYearId: input.schoolYear.id, classId: nextTrack.classId, date, kind: 'makeup', label: 'Make-up class', source: 'teacher', minutesOverride: null, followsWeekday: [...input.assignment.slots].sort((a, b) => a.weekday - b.weekday)[0]?.weekday ?? null, assignmentIds: [input.assignment.id] });
    }
  }
  const after = computePacing({ ...input, track: nextTrack, calendarDays: [...input.calendarDays, ...newCalendarDays] });
  const moved: RealignmentPreview['moved'] = {};
  for (const item of before.items) for (const id of item.competencyIds) {
    const from = item.sessions[0]?.date ?? null;
    const to = after.items.find(i => i.competencyIds.includes(id))?.sessions[0]?.date ?? null;
    if (from !== to) moved[id] = { from, to };
  }
  const planMoves: RealignmentPreview['planMoves'] = [];
  for (const plan of input.plans) {
    const competencyIds = plan.competencies[nextTrack.gradeGroupId] ?? [];
    if (!competencyIds.some(id => moved[id])) continue;
    for (const placement of plan.placements.filter(p => p.classId === nextTrack.classId && (p.assignmentId === null || p.assignmentId === nextTrack.assignmentId))) {
      const to = [...new Set(competencyIds.flatMap(id => after.items.find(i => i.competencyIds.includes(id))?.sessions.map(s => s.date) ?? []))].sort();
      planMoves.push({ planId: plan.id, classId: placement.classId, from: [...placement.dates], to });
    }
  }
  return { option: request.option, before, after, nextTrack, newCalendarDays, moved, dropped: after.atRisk, planMoves };
}
/** Persist this snapshot in the same local transaction as applying the preview; undo restores it. */
export function realignmentUndo(input: RealignmentInput): Pick<RealignmentInput, 'track' | 'calendarDays' | 'plans'> {
  return copy({ track: input.track, calendarDays: input.calendarDays, plans: input.plans });
}
