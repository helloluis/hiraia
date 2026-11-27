/**
 * Saturday and Sunday classes end to end on This Week: records → the shared pacing engine (as data/timeline.ts calls
 * it) → the session cards, the header and "Up next". A weekday-only teacher's week is checked alongside.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engine } from '@hiraia/tala-core/pacing';
import {
  ClassRecord,
  Competency,
  DEFAULT_PACING_PARAMS,
  PacingTrack,
  SchoolYear,
  TeachingAssignment,
  type TimelineEntry,
} from '@hiraia/tala-core/contracts';
import { buildSessions } from './sessions';
import { nextTeachingDate } from './upnext';
import { scheduleWeekdays, weekSpan } from './weekdays';

const year = SchoolYear.parse({
  id: 'sy2026',
  label: '2026-2027',
  startDate: '2026-06-15',
  endDate: '2027-04-10',
  terms: [
    { id: 't2', index: 2, name: 'Quarter 2', startDate: '2026-09-14', endDate: '2026-12-18' },
    { id: 't3', index: 3, name: 'Quarter 3', startDate: '2027-01-04', endDate: '2027-03-26' },
  ],
});
const competencies = Array.from({ length: 12 }, (_, i) =>
  Competency.parse({
    id: `science-bow-2026.science.g4.t2.${i + 1}`,
    code: null,
    learningAreaId: 'science',
    grade: '4',
    termIndex: 2,
    sequence: i,
    text: `SAMPLE DATA: Grade 4 Science competency ${i + 1}`,
    textLang: 'en',
    contentStandard: null,
    performanceStandard: null,
    domain: 'Force, Motion and Energy',
    shortTitle: `Topic ${i + 1}`,
    weekFrom: i + 1,
    weekTo: i + 1,
    weight: null,
    weightSource: 'estimated',
    source: { document: 'Synthetic test fixture', edition: null, page: null, url: null },
  })
);

function teacher(weekdays: number[]) {
  const cls = ClassRecord.parse({
    id: 'c4',
    schoolYearId: year.id,
    name: 'Grade 4 – Sampaguita',
    gradeGroups: [{ id: 'g4', grade: '4' }],
  });
  const assignment = TeachingAssignment.parse({
    id: 'sci',
    classId: cls.id,
    learningAreaId: 'science',
    subjectName: 'Science',
    gradeGroupIds: ['g4'],
    slots: weekdays.map((weekday) => ({
      id: `sci-${weekday}`,
      weekday,
      startTime: '08:00',
      minutes: 50,
    })),
  });
  const track = PacingTrack.parse({
    id: 'track',
    classId: cls.id,
    assignmentId: assignment.id,
    gradeGroupId: 'g4',
    termId: 't2',
    curriculumVersion: 'science-bow-2026',
  });
  const ws = { activeYear: year, classes: [cls], assignments: [assignment], plans: [] };
  const entries: TimelineEntry[] = engine.buildTimeline({
    from: '2026-11-23',
    to: '2026-11-30',
    today: '2026-11-27',
    schoolYear: year,
    classes: [cls],
    assignments: [assignment],
    tracks: [track],
    calendarDays: [],
    competencies,
    checks: [],
    marks: [],
    plans: [],
    pairingOverrides: [],
    defaults: DEFAULT_PACING_PARAMS,
  });
  const sessions = buildSessions(
    { entries, ws: ws as never, competencyById: new Map(competencies.map((c) => [c.id, c])) },
    null,
    'en',
    { date: '2026-11-27', minutes: 15 * 60 } // Friday afternoon, after class
  );
  // The week on screen is Monday 23 to Sunday 29 November; Monday 30 is there for "Up next".
  return { ws, entries, sessions, week: sessions.filter((s) => s.date <= '2026-11-29') };
}

test('Mon/Wed/Sat Science: Saturday is on This Week with its topic, labelled as Tala’s suggestion, and is Up next', () => {
  const { ws, sessions, week } = teacher([1, 3, 6]);
  assert.deepEqual(
    week.map((s) => [s.date, s.weekend]),
    [
      ['2026-11-23', false],
      ['2026-11-25', false],
      ['2026-11-28', true],
    ]
  );
  const saturday = week[2]!;
  assert.equal(saturday.kind, 'lesson');
  assert.equal(saturday.hasTopic, true);
  assert.match(saturday.topics[0]!.title, /^Topic \d+$/);
  assert.equal(saturday.state, 'none');
  assert.equal(
    saturday.href,
    '/lessons/new?classId=c4&assignmentId=sci&date=2026-11-28&slotId=sci-6'
  );
  // Friday after class: the next teaching day is tomorrow, Saturday, and the header runs Monday to Saturday.
  assert.equal(nextTeachingDate(sessions, { date: '2026-11-27', minutes: 15 * 60 }), '2026-11-28');
  // Saturday after class: Monday 30 November, the next week.
  assert.equal(nextTeachingDate(sessions, { date: '2026-11-28', minutes: 9 * 60 }), '2026-11-30');
  assert.deepEqual(
    weekSpan('2026-11-23', {
      schoolWeekdays: year.teachingWeekdays,
      scheduleWeekdays: scheduleWeekdays(ws),
      sessionDates: week.map((s) => s.date),
    }),
    { start: '2026-11-23', end: '2026-11-28' }
  );
});

test('a Saturday-and-Sunday school: both days carry lessons and the header names just the weekend', () => {
  const { ws, sessions, week } = teacher([6, 7]);
  assert.deepEqual(
    week.map((s) => [s.date, s.kind, s.weekend, s.hasTopic]),
    [
      ['2026-11-28', 'lesson', true, true],
      ['2026-11-29', 'lesson', true, true],
    ]
  );
  // Friday: the next teaching day is Saturday; nothing on Monday 30 November for a weekend school.
  assert.equal(nextTeachingDate(sessions, { date: '2026-11-27', minutes: 15 * 60 }), '2026-11-28');
  assert.ok(!sessions.some((s) => s.date === '2026-11-30'));
  assert.deepEqual(
    weekSpan('2026-11-23', {
      schoolWeekdays: year.teachingWeekdays,
      scheduleWeekdays: scheduleWeekdays(ws),
      sessionDates: week.map((s) => s.date),
    }),
    { start: '2026-11-28', end: '2026-11-29' }
  );
});

test('a weekday-only teacher’s week is unchanged: no weekend card, no suggestion label, Monday to Friday', () => {
  const { ws, sessions, week } = teacher([1, 2, 3, 4, 5]);
  assert.deepEqual(
    week.map((s) => s.date),
    ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']
  );
  assert.ok(sessions.every((s) => !s.weekend));
  // Friday after class: Up next rolls past the weekend to Monday.
  assert.equal(nextTeachingDate(sessions, { date: '2026-11-27', minutes: 15 * 60 }), '2026-11-30');
  assert.deepEqual(
    weekSpan('2026-11-23', {
      schoolWeekdays: year.teachingWeekdays,
      scheduleWeekdays: scheduleWeekdays(ws),
      sessionDates: week.map((s) => s.date),
    }),
    { start: '2026-11-23', end: '2026-11-27' }
  );
});
