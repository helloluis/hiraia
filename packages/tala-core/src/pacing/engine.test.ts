import test from 'node:test';
import assert from 'node:assert/strict';
import { Competency, DEFAULT_PACING_PARAMS } from '../contracts/curriculum';
import type { PacingInput, TimelineInput, RealignmentOption } from '../contracts/curriculum';
import { ClassRecord, PacingTrack, SchoolYear, TeachingAssignment, CalendarDay, Plan, SessionMark } from '../contracts/records';
import { engine, previewRealignment, realignmentUndo } from './index';
import { allocate } from './compute';
import { civil, ordinal, weekday } from './dates';

export function fixture(): PacingInput {
  const schoolYear = SchoolYear.parse({ id: 'year0001', label: 'fixture', startDate: '2026-11-02', endDate: '2026-11-27', terms: [{ id: 'term0001', index: 1, name: 'Term', startDate: '2026-11-02', endDate: '2026-11-27' }] });
  const assignment = TeachingAssignment.parse({ id: 'assignment', classId: 'class001', learningAreaId: 'science', subjectName: 'Science', gradeGroupIds: ['group001'], slots: [1, 2, 3, 4, 5].map(weekday => ({ id: `slot000${weekday}`, weekday, minutes: 50 })) });
  const track = PacingTrack.parse({ id: 'track001', classId: 'class001', assignmentId: 'assignment', gradeGroupId: 'group001', termId: 'term0001', curriculumVersion: 'fixture-v1' });
  const competencies = Array.from({ length: 4 }, (_, i) => Competency.parse({ id: `fixture-v1.science.g4.t1.${i}`, code: null, learningAreaId: 'science', grade: '4', termIndex: 1, sequence: i, text: `SAMPLE DATA: competency ${i}`, textLang: 'en', contentStandard: null, performanceStandard: null, domain: i % 2 ? 'Life' : 'Matter', weight: null, weightSource: 'estimated', source: { document: 'Synthetic test fixture', edition: null, page: null, url: null } }));
  return { schoolYear, term: schoolYear.terms[0]!, assignment, track, competencies, calendarDays: [], marks: [], checks: [], today: '2026-11-02', defaults: DEFAULT_PACING_PARAMS };
}

test('civil dates roundtrip and weekdays include leap years without timezone APIs', () => {
  assert.equal(weekday('2026-11-02'), 1);
  for (let n = ordinal('1999-01-01'); n < ordinal('2030-01-01'); n += 17) assert.equal(ordinal(civil(n)), n);
  assert.throws(() => ordinal('2026-02-29'));
});
test('allocation is deterministic, conservative and minimum constrained over varied budgets', () => {
  for (let size = 1; size < 15; size++) for (let budget = 0; budget < 100; budget++) {
    const weights = Array.from({ length: size }, (_, i) => i + 1), counts = allocate(weights, budget, 1);
    assert.deepEqual(counts, allocate(weights, budget, 1));
    assert.equal(counts.reduce((a, b) => a + b, 0), budget);
    assert.ok(counts.every(n => Number.isInteger(n) && n >= 0));
    if (budget >= size) assert.ok(counts.every(n => n >= 1));
  }
});
test('determinism, no input mutation, reservations and no double booking', () => {
  const input = fixture(), saved = JSON.stringify(input);
  const first = engine.computePacing(input);
  assert.deepEqual(engine.computePacing(input), first);
  assert.equal(JSON.stringify(input), saved);
  assert.equal(first.bufferSessions.length, 2); assert.equal(first.assessmentSessions.length, 2);
  const sessions = [...first.items.flatMap(i => i.sessions), ...first.bufferSessions, ...first.assessmentSessions];
  assert.equal(sessions.length, 20); assert.equal(new Set(sessions.map(s => `${s.date}|${s.slotId}`)).size, 20);
});
test('mid-year proposal and covered-before-Tala never create a deficit', () => {
  const input = fixture(); input.today = '2026-11-16';
  const proposal = engine.proposeStartPosition(input)!;
  assert.equal(proposal.estimated, true); input.track.startPosition = proposal;
  const plan = engine.computePacing(input);
  assert.ok(plan.items.some(i => i.state === 'before_tala'));
  assert.ok(plan.items.flatMap(i => i.sessions).every(s => s.date >= input.today));
  assert.equal(plan.sessionsBehind, 0);
});
test('rotation, shortened days, class scope and Saturday make-up', () => {
  const input = fixture(); input.assignment.slots = [input.assignment.slots[0]!]; input.assignment.slots[0]!.rotation = { everyWeeks: 2, week: 1 };
  input.calendarDays = [CalendarDay.parse({ id: 'short001', schoolYearId: 'year0001', date: '2026-11-02', kind: 'shortened', minutesOverride: 25 }), CalendarDay.parse({ id: 'other001', schoolYearId: 'year0001', classId: 'other001', date: '2026-11-16', kind: 'suspension' }), CalendarDay.parse({ id: 'makeup01', schoolYearId: 'year0001', date: '2026-11-07', kind: 'makeup', followsWeekday: 1 })];
  const sessions = engine.enumerateSessions(input.schoolYear, input.term, input.assignment, input.calendarDays);
  assert.deepEqual(sessions.map(s => s.date), ['2026-11-02', '2026-11-07', '2026-11-16']); assert.equal(sessions[0]!.minutes, 25);
});
test('term that does not fit exposes risk; pins, weights, order, merges and deferrals survive', () => {
  const input = fixture(); input.track.startPosition = { competencyId: input.competencies[0]!.id, date: '2026-11-27', estimated: false };
  assert.equal(engine.computePacing(input).atRisk.length, 4);
  input.track.startPosition = null;
  const ids = input.competencies.map(c => c.id);
  input.track.overrides = { order: [...ids].reverse(), weights: { [ids[0]!]: 5 }, sessions: { [ids[0]!]: 2 }, pins: { [ids[0]!]: '2026-11-09' }, merges: [[ids[1]!, ids[2]!]], deferred: [ids[3]!] };
  const plan = engine.computePacing(input);
  assert.equal(plan.items.find(i => i.competencyIds.includes(ids[0]!))!.sessions[0]!.date, '2026-11-09');
  assert.equal(plan.items.find(i => i.competencyIds.includes(ids[0]!))!.weightSource, 'teacher');
  assert.ok(plan.items.some(i => i.competencyIds.length === 2)); assert.ok(plan.items.some(i => i.state === 'deferred'));
});
test('assumed teaching and explicit partial/not-taught marks affect pace', () => {
  const input = fixture(); input.today = '2026-11-09';
  assert.equal(engine.computePacing(input).sessionsBehind, 0);
  input.marks = [SessionMark.parse({ id: 'mark0001', classId: 'class001', assignmentId: 'assignment', gradeGroupId: 'group001', date: '2026-11-02', competencyIds: [input.competencies[0]!.id], status: 'partial' })];
  assert.equal(engine.computePacing(input).sessionsBehind, 0.5);
  input.marks[0]!.status = 'not_taught'; assert.equal(engine.computePacing(input).sessionsBehind, 1);
});
test('typhoon-week shift retains allocation and moves locked plan dates without mutation', () => {
  const input = fixture(), baseline = engine.computePacing(input);
  input.calendarDays = ['02', '03', '04', '05', '06'].map(d => CalendarDay.parse({ id: `event0${d}`, schoolYearId: 'year0001', date: `2026-11-${d}`, kind: 'suspension' }));
  const plan = Plan.parse({ id: 'locked01', templateId: 'template', language: 'en', grades: ['4'], durationMinutes: 50, state: 'locked', lock: { lockedAt: '2026-11-01T00:00:00Z', revisionCode: 'R1', revision: 1 }, competencies: { group001: [input.competencies[0]!.id] }, placements: [{ classId: 'class001', assignmentId: 'assignment', dates: ['2026-11-02'] }] });
  const saved = JSON.stringify(plan);
  const preview = previewRealignment({ ...input, plans: [plan], baseline: baseline }, { option: 'shift' });
  assert.ok(preview.dropped.length); assert.equal(preview.planMoves[0]!.to[0], '2026-11-09'); assert.equal(JSON.stringify(plan), saved);
});
test('all six realignment options are pure and their full snapshot restores the original state', () => {
  for (const option of ['shift', 'absorb', 'compress', 'merge', 'add_time', 'defer'] as RealignmentOption[]) {
    const input = { ...fixture(), plans: [] }, undo = realignmentUndo(input), before = engine.computePacing(input);
    previewRealignment(input, { option, competencyIds: input.competencies.slice(0, 2).map(c => c.id), makeupDates: ['2026-11-07'] });
    assert.deepEqual(engine.computePacing({ ...input, ...undo }), before); assert.deepEqual(input.track, undo.track);
  }
});
test('four grade groups pair shared themes, including a theme shared by only some groups', () => {
  const base = fixture();
  const groups = ['2', '3', '4', '5'].map(grade => ({ id: `group00${grade}`, grade }));
  const cls = ClassRecord.parse({ id: 'class001', schoolYearId: 'year0001', name: 'Sample', gradeGroups: groups });
  const assignment = { ...base.assignment, gradeGroupIds: groups.map(g => g.id) };
  const tracks = groups.map(g => ({ ...base.track, id: `track${g.id}`, gradeGroupId: g.id }));
  const competencies = groups.flatMap((g, j) => base.competencies.map((c, i) => ({ ...c, grade: g.grade as typeof c.grade, id: `fixture-v1.science.g${g.grade}.t1.${i}`, domain: j < 3 ? (i % 2 ? 'Life' : 'Matter') : 'Different' })));
  const input: TimelineInput = { ...base, from: '2026-11-02', to: '2026-11-27', classes: [cls], assignments: [assignment], tracks, competencies, plans: [], pairingOverrides: [] };
  const timeline = engine.buildTimeline(input);
  assert.equal(Object.keys(timeline[0]!.byGroup).length, 4); assert.equal(timeline[0]!.pairing!.groupIds.length, 3);
  assignment.gradeGroupIds = ['group003', 'group004'];
  assert.deepEqual(Object.keys(engine.buildTimeline(input)[0]!.byGroup), ['group003', 'group004']);
});

test('Sunday uses ISO weekday 7, and a make-up day only affects selected assignments', () => {
  const input = fixture(); assert.equal(weekday('2026-11-08'), 7);
  input.calendarDays = [CalendarDay.parse({ id: 'makeup02', schoolYearId: 'year0001', date: '2026-11-08', kind: 'makeup', followsWeekday: 1, assignmentIds: ['different'] })];
  assert.equal(engine.enumerateSessions(input.schoolYear, input.term, input.assignment, input.calendarDays).length, 20);
  input.calendarDays[0]!.assignmentIds = [input.assignment.id];
  assert.equal(engine.enumerateSessions(input.schoolYear, input.term, input.assignment, input.calendarDays).length, 21);
});
test('re-teaching closes a formerly not-taught competency', () => {
  const input = fixture(); input.today = '2026-11-10'; input.track.overrides.sessions = { [input.competencies[0]!.id]: 1 };
  const common = { classId: 'class001', assignmentId: 'assignment', gradeGroupId: 'group001', competencyIds: [input.competencies[0]!.id] };
  input.marks = [SessionMark.parse({ ...common, id: 'missed01', date: '2026-11-02', status: 'not_taught' }), SessionMark.parse({ ...common, id: 'retaught', date: '2026-11-09', status: 'taught' })];
  assert.equal(engine.computePacing(input).items[0]!.state, 'taught');
});
test('not-taught mark shifts the affected lesson after the missed date and can be persisted', () => {
  const input = fixture(); input.today = '2026-11-03';
  input.marks = [SessionMark.parse({ id: 'missed01', classId: 'class001', assignmentId: 'assignment', gradeGroupId: 'group001', date: '2026-11-02', competencyIds: [input.competencies[0]!.id], status: 'not_taught' })];
  const preview = engine.previewRealignment({ ...input, plans: [] }, { option: 'shift' });
  assert.equal(preview.after.items[0]!.sessions[0]!.date, '2026-11-03');
  const persisted = engine.computePacing({ ...input, track: preview.nextTrack, calendarDays: [...input.calendarDays, ...preview.newCalendarDays] });
  assert.equal(persisted.items[0]!.sessions[0]!.date, '2026-11-03');
});
