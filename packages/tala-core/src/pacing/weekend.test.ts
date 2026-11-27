/**
 * Saturday and Sunday classes (Luis, 27 Nov 2026): "some schools don't have a choice when they will hold their
 * classes". A weekend slot in the teacher's timetable is a real class day: it gets sessions, competencies, buffers,
 * marks and realignment exactly like a weekday slot. A timetable with only school weekdays is unchanged: the
 * snapshots in the first test were taken from the engine before weekend slots were honoured.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Competency, DEFAULT_PACING_PARAMS } from '../contracts/curriculum';
import type {
  PacingInput,
  PacingPlan,
  TeachingSession,
  TimelineEntry,
  TimelineInput,
} from '../contracts/curriculum';
import {
  CalendarDay,
  ClassRecord,
  PacingTrack,
  SchoolYear,
  SessionMark,
  TeachingAssignment,
  type TimetableSlot,
} from '../contracts/records';
import { engine, previewRealignment } from './index';
import { weekday } from './dates';

/** Science for one Grade 4 group, 2–29 Nov 2026 (Monday 2 Nov to Sunday 29 Nov), four competencies. */
function input(
  weekdays: number[],
  term: { startDate: string; endDate: string } = { startDate: '2026-11-02', endDate: '2026-11-29' }
): PacingInput {
  const schoolYear = SchoolYear.parse({
    id: 'year0001',
    label: 'weekend',
    startDate: '2026-11-02',
    endDate: '2026-11-29',
    terms: [{ id: 'term0001', index: 1, name: 'Term', ...term }],
  });
  const assignment = TeachingAssignment.parse({
    id: 'assignment',
    classId: 'class001',
    learningAreaId: 'science',
    subjectName: 'Science',
    gradeGroupIds: ['group001'],
    slots: weekdays.map((weekday) => ({ id: `slot000${weekday}`, weekday, minutes: 50 })),
  });
  return {
    schoolYear,
    term: schoolYear.terms[0]!,
    assignment,
    track: PacingTrack.parse({
      id: 'track001',
      classId: 'class001',
      assignmentId: 'assignment',
      gradeGroupId: 'group001',
      termId: 'term0001',
      curriculumVersion: 'fixture-v1',
    }),
    competencies: Array.from({ length: 4 }, (_, i) =>
      Competency.parse({
        id: `fixture-v1.science.g4.t1.${i}`,
        code: null,
        learningAreaId: 'science',
        grade: '4',
        termIndex: 1,
        sequence: i,
        text: `SAMPLE DATA: competency ${i}`,
        textLang: 'en',
        contentStandard: null,
        performanceStandard: null,
        domain: i % 2 ? 'Life' : 'Matter',
        weight: null,
        weightSource: 'estimated',
        source: { document: 'Synthetic test fixture', edition: null, page: null, url: null },
      })
    ),
    calendarDays: [],
    marks: [],
    checks: [],
    today: '2026-11-02',
    defaults: DEFAULT_PACING_PARAMS,
  };
}
const sessionsOf = (i: PacingInput) =>
  engine.enumerateSessions(i.schoolYear, i.term, i.assignment, i.calendarDays);
const day = (date: string, kind: CalendarDay['kind'], more: Partial<CalendarDay> = {}) =>
  CalendarDay.parse({
    id: `${kind.slice(0, 6)}${date.slice(5).replace('-', '')}`,
    schoolYearId: 'year0001',
    date,
    kind,
    ...more,
  });
const mark = (
  date: string,
  status: SessionMark['status'],
  id = `mark${date.slice(5).replace('-', '')}`
) =>
  SessionMark.parse({
    id,
    classId: 'class001',
    assignmentId: 'assignment',
    gradeGroupId: 'group001',
    date,
    status,
  });
const isWeekend = (date: string) => weekday(date) >= 6;

/* Digests used by the weekday-only regression snapshots. */
const short = (id: string) => id.split('.').slice(-3).join('.');
const sessionsDigest = (list: TeachingSession[]) =>
  list.map((s) => `${s.date.slice(5)}/${s.slotId}/${s.minutes}`).join(' ');
const planDigest = (p: PacingPlan) =>
  [
    ...p.items.map(
      (i) =>
        `${i.competencyIds.map(short).join('+')} ${i.state} ${i.sessions.map((s) => `${s.date.slice(5)}/${s.slotId}`).join(',')}`
    ),
    `buffer ${p.bufferSessions.map((s) => `${s.date.slice(5)}/${s.slotId}`).join(',')}`,
    `assessment ${p.assessmentSessions.map((s) => `${s.date.slice(5)}/${s.slotId}`).join(',')}`,
    `behind ${p.sessionsBehind} risk ${p.atRisk.map(short).join(',')}`,
  ].join('\n');
const timelineDigest = (t: TimelineEntry[]) =>
  t
    .map(
      (e) =>
        `${e.date.slice(5)}|${e.slotId}|${e.kind}|${e.mark}|${Object.entries(e.byGroup)
          .map(([g, ids]) => `${g}=${ids.map(short).join('+')}`)
          .join(';')}`
    )
    .join('\n');

test('weekday-only timetables are unchanged: sessions, pacing and timeline match the engine before weekend classes', () => {
  // S1: Monday to Friday, 2–27 Nov.
  const s1 = input([1, 2, 3, 4, 5], { startDate: '2026-11-02', endDate: '2026-11-27' });
  s1.schoolYear.endDate = '2026-11-27';
  assert.equal(
    sessionsDigest(sessionsOf(s1)),
    '11-02/slot0001/50 11-03/slot0002/50 11-04/slot0003/50 11-05/slot0004/50 11-06/slot0005/50 11-09/slot0001/50 11-10/slot0002/50 11-11/slot0003/50 11-12/slot0004/50 11-13/slot0005/50 11-16/slot0001/50 11-17/slot0002/50 11-18/slot0003/50 11-19/slot0004/50 11-20/slot0005/50 11-23/slot0001/50 11-24/slot0002/50 11-25/slot0003/50 11-26/slot0004/50 11-27/slot0005/50'
  );
  assert.equal(
    planDigest(engine.computePacing(s1)),
    [
      'g4.t1.0 scheduled 11-02/slot0001,11-03/slot0002,11-04/slot0003,11-05/slot0004',
      'g4.t1.1 scheduled 11-06/slot0005,11-09/slot0001,11-10/slot0002,11-11/slot0003',
      'g4.t1.2 scheduled 11-12/slot0004,11-13/slot0005,11-16/slot0001,11-17/slot0002',
      'g4.t1.3 scheduled 11-18/slot0003,11-19/slot0004,11-20/slot0005,11-23/slot0001',
      'buffer 11-24/slot0002,11-25/slot0003',
      'assessment 11-26/slot0004,11-27/slot0005',
      'behind 0 risk ',
    ].join('\n')
  );

  // S2: MWF with a rotating Wednesday, a holiday, a shortened day, a Saturday make-up that follows Monday, a
  // make-up Saturday with no Saturday slot, a Sunday suspension, a mid-term start and two marks.
  const s2 = input([1, 3, 5], { startDate: '2026-11-02', endDate: '2026-11-27' });
  s2.schoolYear.endDate = '2026-11-27';
  s2.assignment.slots = [
    { id: 'slot0001', weekday: 1, startTime: '08:00', minutes: 50, rotation: null },
    {
      id: 'slot0003',
      weekday: 3,
      startTime: '08:00',
      minutes: 50,
      rotation: { everyWeeks: 2, week: 2 },
    },
    { id: 'slot0005', weekday: 5, startTime: '10:00', minutes: 40, rotation: null },
  ];
  s2.calendarDays = [
    day('2026-11-16', 'national_holiday'),
    day('2026-11-06', 'shortened', { minutesOverride: 20 }),
    day('2026-11-14', 'makeup', { followsWeekday: 1 }),
    day('2026-11-22', 'suspension'),
    day('2026-11-21', 'makeup', { id: 'makeup02', followsWeekday: null }),
  ];
  s2.today = '2026-11-18';
  s2.track.startPosition = {
    competencyId: s2.competencies[1]!.id,
    date: '2026-11-09',
    estimated: true,
  };
  s2.marks = [mark('2026-11-11', 'partial'), mark('2026-11-13', 'taught')];
  assert.equal(
    sessionsDigest(sessionsOf(s2)),
    '11-02/slot0001/50 11-06/slot0005/20 11-09/slot0001/50 11-11/slot0003/50 11-13/slot0005/40 11-14/slot0001/50 11-20/slot0005/40 11-23/slot0001/50 11-25/slot0003/50 11-27/slot0005/40'
  );
  assert.equal(
    planDigest(engine.computePacing(s2)),
    [
      'g4.t1.0 before_tala ',
      'g4.t1.1 partial 11-09/slot0001,11-11/slot0003',
      'g4.t1.2 taught 11-13/slot0005,11-14/slot0001',
      'g4.t1.3 scheduled 11-20/slot0005,11-23/slot0001',
      'buffer ',
      'assessment 11-25/slot0003,11-27/slot0005',
      'behind 0.5 risk ',
    ].join('\n')
  );

  // S3: a two-grade multigrade timeline on Tuesday and Thursday with the S2 calendar, shown through Sunday 29 Nov.
  const base = input([2, 4], { startDate: '2026-11-02', endDate: '2026-11-27' });
  base.schoolYear.endDate = '2026-11-27';
  const cls = ClassRecord.parse({
    id: 'class001',
    schoolYearId: 'year0001',
    name: 'Mixed',
    gradeGroups: [
      { id: 'group001', grade: '4' },
      { id: 'group002', grade: '5' },
    ],
  });
  const assignment = {
    ...base.assignment,
    gradeGroupIds: ['group001', 'group002'],
    slots: base.assignment.slots.map((s) => ({ ...s, minutes: 45 })),
  };
  const second = base.competencies.map((c, i) => ({
    ...c,
    id: c.id.replace('.g4.', '.g5.'),
    grade: '5' as const,
    domain: i % 2 ? 'Matter' : 'Life',
  }));
  const s3: TimelineInput = {
    ...base,
    today: '2026-11-18',
    from: '2026-11-02',
    to: '2026-11-29',
    classes: [cls],
    assignments: [assignment],
    tracks: [base.track, { ...base.track, id: 'track002', gradeGroupId: 'group002' }],
    competencies: [...base.competencies, ...second],
    calendarDays: s2.calendarDays,
    plans: [],
    pairingOverrides: [],
  };
  assert.equal(
    timelineDigest(engine.buildTimeline(s3)),
    [
      '11-03|slot0002|lesson|assumed_taught|group001=g4.t1.0;group002=g5.t1.1',
      '11-05|slot0004|lesson|assumed_taught|group001=g4.t1.0;group002=g5.t1.1',
      '11-10|slot0002|lesson|assumed_taught|group001=g4.t1.1;group002=g5.t1.0',
      '11-12|slot0004|lesson|assumed_taught|group001=g4.t1.1;group002=g5.t1.0',
      '11-17|slot0002|lesson|assumed_taught|group001=g4.t1.2;group002=g5.t1.3',
      '11-19|slot0004|lesson|null|group001=g4.t1.3;group002=g5.t1.2',
      '11-24|slot0002|assessment|null|',
      '11-26|slot0004|assessment|null|',
    ].join('\n')
  );
});

test('a Saturday in the timetable is a class day: Mon/Wed/Sat gets Saturday sessions with competencies', () => {
  const i = input([1, 3, 6]);
  const sessions = sessionsOf(i);
  assert.deepEqual(
    sessions.map((s) => s.date.slice(5)),
    [
      '11-02',
      '11-04',
      '11-07',
      '11-09',
      '11-11',
      '11-14',
      '11-16',
      '11-18',
      '11-21',
      '11-23',
      '11-25',
      '11-28',
    ]
  );
  assert.deepEqual(
    sessions.filter((s) => isWeekend(s.date)).map((s) => s.slotId),
    ['slot0006', 'slot0006', 'slot0006', 'slot0006']
  );
  const plan = engine.computePacing(i);
  const placed = [
    ...plan.items.flatMap((x) => x.sessions),
    ...plan.bufferSessions,
    ...plan.assessmentSessions,
  ];
  // Every session is used exactly once, and Saturdays carry competencies like any other class day.
  assert.equal(placed.length, sessions.length);
  assert.equal(new Set(placed.map((s) => `${s.date}|${s.slotId}`)).size, sessions.length);
  const saturdayTopics = plan.items.filter((x) => x.sessions.some((s) => isWeekend(s.date)));
  assert.ok(saturdayTopics.length >= 2);
  assert.ok(plan.items.every((x) => x.sessions.length >= 1));
  assert.deepEqual(plan.atRisk, []);
});

test('weekend-only classes (Saturday and Sunday) are paced over the weekends alone', () => {
  const i = input([6, 7]);
  const sessions = sessionsOf(i);
  assert.deepEqual(
    sessions.map((s) => s.date.slice(5)),
    ['11-07', '11-08', '11-14', '11-15', '11-21', '11-22', '11-28', '11-29']
  );
  const plan = engine.computePacing(i);
  assert.ok(plan.items.flatMap((x) => x.sessions).every((s) => isWeekend(s.date)));
  // Same proportional rule as a weekday class: eight sessions, two kept for assessment, none for buffer (10 % of
  // 8 rounds down), so four equal competencies share six sessions 2/2/1/1 (ties go to the earlier competency).
  assert.deepEqual(
    plan.items.map((x) => x.sessions.map((s) => s.date.slice(5))),
    [['11-07', '11-08'], ['11-14', '11-15'], ['11-21'], ['11-22']]
  );
  assert.deepEqual(
    plan.assessmentSessions.map((s) => s.date.slice(5)),
    ['11-28', '11-29']
  );
  assert.equal(plan.sessionsBehind, 0);
});

test('Sunday ends its week: rotation weeks and published week hints turn over on Monday', () => {
  // Rotation weeks are anchored to Monday 2 Nov. Sunday 8 Nov is still week 1; Monday 9 Nov starts week 2.
  const i = input([]);
  i.assignment.slots = [
    { id: 'sunA', weekday: 7, startTime: null, minutes: 50, rotation: { everyWeeks: 2, week: 1 } },
    { id: 'monB', weekday: 1, startTime: null, minutes: 50, rotation: { everyWeeks: 2, week: 2 } },
  ];
  assert.deepEqual(
    sessionsOf(i).map((s) => `${s.date.slice(5)}/${s.slotId}`),
    ['11-08/sunA', '11-09/monB', '11-22/sunA', '11-23/monB']
  );
  // Published weeks count from the term's Monday: week 1 is 2–8 Nov, so its competency takes Saturday 7 and
  // Sunday 8; the week-2 competency starts on Monday 9 Nov and takes that week's Saturday (it has two sessions).
  const hinted = input([1, 6, 7]);
  hinted.competencies = hinted.competencies.map((c, n) => ({
    ...c,
    weekFrom: n + 1,
    weekTo: n + 1,
  }));
  const plan = engine.computePacing(hinted);
  const of = (n: number) =>
    plan.items.find((x) => x.competencyIds[0] === hinted.competencies[n]!.id)!;
  assert.deepEqual(
    of(0).sessions.map((s) => s.date.slice(5)),
    ['11-02', '11-07', '11-08']
  );
  assert.deepEqual(
    of(1).sessions.map((s) => s.date.slice(5)),
    ['11-09', '11-14']
  );
  assert.equal(of(1).weightSource, 'official');
});

test('term start and end on or next to a weekend bound the weekend sessions', () => {
  // A term that starts on Saturday 7 Nov has no session on the weekend before; one that ends Sunday 29 Nov keeps it.
  assert.deepEqual(
    sessionsOf(input([1, 6, 7], { startDate: '2026-11-07', endDate: '2026-11-29' }))
      .map((s) => s.date.slice(5))
      .slice(0, 3),
    ['11-07', '11-08', '11-09']
  );
  assert.equal(
    sessionsOf(input([6, 7], { startDate: '2026-11-07', endDate: '2026-11-29' })).at(-1)!.date,
    '2026-11-29'
  );
  // A term that ends on Friday 27 Nov drops the weekend after it; so does a school year that ends on Saturday 28 Nov.
  assert.equal(
    sessionsOf(input([5, 6, 7], { startDate: '2026-11-02', endDate: '2026-11-27' })).at(-1)!.date,
    '2026-11-27'
  );
  const yearEnd = input([5, 6, 7]);
  yearEnd.schoolYear.endDate = '2026-11-28';
  assert.equal(sessionsOf(yearEnd).at(-1)!.date, '2026-11-28');
  // Between two terms (Friday 13 Nov / Monday 16 Nov) the weekend belongs to neither term.
  const year = SchoolYear.parse({
    id: 'year0001',
    label: 'two terms',
    startDate: '2026-11-02',
    endDate: '2026-11-29',
    terms: [
      { id: 'term0001', index: 1, name: 'Term 1', startDate: '2026-11-02', endDate: '2026-11-13' },
      { id: 'term0002', index: 2, name: 'Term 2', startDate: '2026-11-16', endDate: '2026-11-29' },
    ],
  });
  const a = input([6, 7]).assignment;
  const both = year.terms.flatMap((t) => engine.enumerateSessions(year, t, a, []));
  assert.deepEqual(
    both.map((s) => `${s.termId}:${s.date.slice(5)}`),
    [
      'term0001:11-07',
      'term0001:11-08',
      'term0002:11-21',
      'term0002:11-22',
      'term0002:11-28',
      'term0002:11-29',
    ]
  );
  assert.equal(engine.termForDate(year, '2026-11-14'), null);
});

test('holidays, suspensions, make-ups and duplicates on weekend class days', () => {
  const i = input([1, 6, 7]);
  i.calendarDays = [
    day('2026-11-07', 'national_holiday'), // a Saturday holiday removes the Saturday class
    day('2026-11-08', 'suspension', { classId: 'other001' }), // another class's suspension does not
    day('2026-11-14', 'makeup', { followsWeekday: null }), // a make-up on a day that already has class: no duplicate
    day('2026-11-15', 'makeup', { id: 'makeupA', followsWeekday: null }),
    day('2026-11-15', 'makeup', { id: 'makeupB', followsWeekday: null }), // two make-up records, one session
    day('2026-11-21', 'makeup', { followsWeekday: 1 }), // a Saturday that follows Monday uses Monday's period
    day('2026-11-22', 'makeup', { followsWeekday: 1, assignmentIds: ['different'] }), // another subject's make-up
    day('2026-11-28', 'shortened', { minutesOverride: 30 }),
    day('2026-11-29', 'shortened', { minutesOverride: 0 }), // a zero-minute Sunday is no class
  ];
  assert.deepEqual(
    sessionsOf(i)
      .filter((s) => isWeekend(s.date))
      .map((s) => `${s.date.slice(5)}/${s.slotId}/${s.minutes}`),
    [
      '11-08/slot0007/50',
      '11-14/slot0006/50',
      '11-15/slot0007/50',
      '11-21/slot0001/50',
      '11-22/slot0007/50',
      '11-28/slot0006/30',
    ]
  );
  // A weekday-only class still gets an explicit Saturday make-up, and only that.
  const weekdays = input([1, 2, 3, 4, 5]);
  weekdays.calendarDays = [day('2026-11-14', 'makeup', { followsWeekday: 2 })];
  assert.deepEqual(
    sessionsOf(weekdays)
      .filter((s) => isWeekend(s.date))
      .map((s) => `${s.date.slice(5)}/${s.slotId}`),
    ['11-14/slot0002']
  );
});

test('history carries into weekend classes: covered-before-Tala, marks and the proposed start', () => {
  const i = input([1, 3, 6]);
  // Onboarding on Saturday 14 Nov: the proposal is the competency due that day, and earlier sessions are history.
  i.today = '2026-11-14';
  const proposal = engine.proposeStartPosition(i)!;
  const stock = engine.computePacing(input([1, 3, 6]));
  const due = stock.items.find((x) => x.sessions.some((s) => s.date === '2026-11-14'))!;
  assert.equal(proposal.competencyId, due.competencyIds[0]);
  assert.equal(proposal.date, '2026-11-14');
  i.track.startPosition = proposal;
  // A Saturday taught as planned and a Monday not taught: the missed Monday is behind, the Saturday is not.
  i.today = '2026-11-24';
  i.marks = [mark('2026-11-21', 'taught'), mark('2026-11-23', 'not_taught')];
  const plan = engine.computePacing(i);
  assert.ok(
    plan.items.filter((x) => x.state === 'before_tala').every((x) => x.sessions.length === 0)
  );
  assert.ok(plan.items.flatMap((x) => x.sessions).every((s) => s.date >= '2026-11-14'));
  assert.equal(plan.sessionsBehind, 1);
  const timeline = engine.buildTimeline({
    ...i,
    from: '2026-11-02',
    to: '2026-11-29',
    classes: [
      ClassRecord.parse({
        id: 'class001',
        schoolYearId: 'year0001',
        name: 'Grade 4',
        gradeGroups: [{ id: 'group001', grade: '4' }],
      }),
    ],
    assignments: [i.assignment],
    tracks: [i.track],
    plans: [],
    pairingOverrides: [],
  });
  const at = (date: string) => timeline.find((e) => e.date === date)!;
  assert.equal(at('2026-11-07').kind, 'before_tala');
  assert.equal(at('2026-11-21').mark, 'taught');
  assert.equal(at('2026-11-23').mark, 'not_taught');
  assert.ok(at('2026-11-21').byGroup.group001!.length > 0);
});

test('the timeline shows weekend classes on their dates with each grade group’s competencies', () => {
  const base = input([1, 3, 6]);
  const cls = ClassRecord.parse({
    id: 'class001',
    schoolYearId: 'year0001',
    name: 'Mixed',
    gradeGroups: [
      { id: 'group001', grade: '4' },
      { id: 'group002', grade: '5' },
    ],
  });
  const second = base.competencies.map((c) => ({
    ...c,
    id: c.id.replace('.g4.', '.g5.'),
    grade: '5' as const,
  }));
  const timeline = engine.buildTimeline({
    ...base,
    from: '2026-11-02',
    to: '2026-11-29',
    classes: [cls],
    assignments: [{ ...base.assignment, gradeGroupIds: ['group001', 'group002'] }],
    tracks: [base.track, { ...base.track, id: 'track002', gradeGroupId: 'group002' }],
    competencies: [...base.competencies, ...second],
    plans: [],
    pairingOverrides: [],
  });
  const saturdays = timeline.filter((e) => isWeekend(e.date));
  assert.deepEqual(
    saturdays.map((e) => e.date.slice(5)),
    ['11-07', '11-14', '11-21', '11-28']
  );
  const lessons = saturdays.filter((e) => e.kind === 'lesson');
  assert.ok(lessons.length >= 2);
  for (const e of lessons) {
    assert.equal(e.byGroup.group001!.length, 1);
    assert.equal(e.byGroup.group002!.length, 1);
  }
  // One entry per class period: no Saturday appears twice.
  assert.equal(new Set(timeline.map((e) => `${e.date}|${e.slotId}`)).size, timeline.length);
});

test('a no-class Saturday realigns like any class day, and a weekend make-up adds a period', () => {
  const i = input([1, 3, 6]);
  i.today = '2026-11-09';
  const baseline = engine.computePacing(i);
  const typhoon = day('2026-11-14', 'suspension');
  const shifted = previewRealignment(
    { ...i, calendarDays: [typhoon], plans: [], baseline },
    { option: 'shift' }
  );
  assert.ok(!shifted.after.items.some((x) => x.sessions.some((s) => s.date === '2026-11-14')));
  assert.ok(Object.keys(shifted.moved).length > 0);
  const added = previewRealignment(
    { ...i, calendarDays: [typhoon], plans: [], baseline },
    { option: 'add_time', makeupDates: ['2026-11-15'] }
  );
  // The make-up follows the subject's first weekday (Monday), on Sunday 15 Nov.
  assert.equal(added.newCalendarDays[0]!.date, '2026-11-15');
  assert.equal(added.newCalendarDays[0]!.followsWeekday, 1);
  const sunday = [
    ...added.after.items.flatMap((x) => x.sessions),
    ...added.after.bufferSessions,
    ...added.after.assessmentSessions,
  ].find((s) => s.date === '2026-11-15');
  assert.equal(sunday?.slotId, 'slot0001');
});

test('Saturday is 6 and Sunday 7 across month and year ends, and weekend slots are valid synced records', () => {
  assert.deepEqual(
    ['2026-11-28', '2026-11-29', '2026-11-30', '2027-01-02', '2027-01-03', '2027-01-04'].map(
      weekday
    ),
    [6, 7, 1, 6, 7, 1]
  );
  const slots: TimetableSlot[] = [6, 7].map((weekday) => ({
    id: `s${weekday}`,
    weekday,
    startTime: '07:30',
    minutes: 60,
    rotation: null,
  }));
  const saved = TeachingAssignment.parse({ ...input([]).assignment, slots });
  assert.deepEqual(
    saved.slots.map((s) => s.weekday),
    [6, 7]
  );
});
