import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, mondayOf, weekdayOf } from '../../data/ids';
import { termWeekFor } from '../../data/recommend';
import { nextTeachingDate, ordinalInWeek, type SessionTime } from './upnext';
import { nextMakeupDate, outsideSchoolWeek, scheduleWeekdays, weekSpan } from './weekdays';

const MON = '2026-11-23'; // Monday 23 … Sunday 29 November 2026
const span = (scheduleWeekdays: number[], sessionDates: string[] = [], schoolWeekdays?: number[]) =>
  weekSpan(MON, { scheduleWeekdays, sessionDates, schoolWeekdays });

test('the week header names Monday to Friday for a weekday-only teacher, exactly as before', () => {
  for (const days of [[1, 2, 3, 4, 5], [1, 3, 5], [2, 4], [5], []])
    assert.deepEqual(
      span(
        days,
        days.map((d) => addDays(MON, d - 1))
      ),
      { start: MON, end: '2026-11-27' }
    );
  // No timetable and no sessions at all: still the school week.
  assert.deepEqual(span([]), { start: MON, end: '2026-11-27' });
});

test('the week header reaches Saturday or Sunday for weekend classes, and only covers the weekend for a weekend school', () => {
  assert.deepEqual(span([1, 3, 6]), { start: MON, end: '2026-11-28' });
  assert.deepEqual(span([1, 7]), { start: MON, end: '2026-11-29' });
  assert.deepEqual(span([6, 7]), { start: '2026-11-28', end: '2026-11-29' });
  assert.deepEqual(span([7]), { start: '2026-11-29', end: '2026-11-29' });
  // A weekday-only teacher with a Saturday make-up that week sees Monday to Saturday; the next week is back to Friday.
  assert.deepEqual(span([1, 2, 3, 4, 5], ['2026-11-28']), { start: MON, end: '2026-11-28' });
  assert.deepEqual(
    weekSpan('2026-11-30', { scheduleWeekdays: [1, 2, 3, 4, 5], sessionDates: ['2026-11-28'] }),
    { start: '2026-11-30', end: '2026-12-04' }
  );
  // A weekend school with a Wednesday make-up meets in the school week too: Monday to Sunday that week.
  assert.deepEqual(span([6, 7], ['2026-11-25']), { start: MON, end: '2026-11-29' });
  // A school year whose own week is Monday to Saturday.
  assert.deepEqual(span([1, 2], [], [1, 2, 3, 4, 5, 6]), { start: MON, end: '2026-11-28' });
});

test('the timetable is read from the active classes only', () => {
  const ws = {
    classes: [{ id: 'c1' }],
    assignments: [
      { classId: 'c1', slots: [{ weekday: 6 }, { weekday: 1 }, { weekday: 6 }] },
      { classId: 'archived', slots: [{ weekday: 7 }] },
    ],
  };
  assert.deepEqual(scheduleWeekdays(ws), [1, 6]);
});

test('Saturday and Sunday classes are outside the school week; weekdays are not', () => {
  assert.deepEqual(
    ['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30'].map((d) => outsideSchoolWeek(d)),
    [false, true, true, false]
  );
  assert.equal(outsideSchoolWeek('2026-11-28', [1, 2, 3, 4, 5, 6]), false);
  assert.equal(outsideSchoolWeek('2026-11-28', []), true); // an empty list means the default school week
});

test('the make-up date starts on the next Saturday unless the subject already meets then', () => {
  // Weekday-only subjects: the next Saturday from every day of the week, exactly as before.
  for (let i = 0; i < 7; i++) {
    const today = addDays(MON, i);
    const date = nextMakeupDate(today, [1, 2, 3, 4, 5]);
    assert.equal(weekdayOf(date), 6);
    assert.ok(date > today && date <= addDays(today, 7));
  }
  assert.equal(nextMakeupDate('2026-11-28', [1, 3, 5]), '2026-12-05'); // on a Saturday: the one after
  assert.equal(nextMakeupDate('2026-11-24', [1, 3, 6]), '2026-11-29'); // Saturday is a class: Sunday
  assert.equal(nextMakeupDate('2026-11-24', [6, 7]), '2026-11-25'); // a weekend school: the next free weekday
  assert.equal(nextMakeupDate('2026-11-28', [6, 7]), '2026-11-30');
  assert.equal(nextMakeupDate('2026-11-24', [1, 2, 3, 4, 5, 6, 7]), '2026-11-28'); // no free day: Saturday
});

test('Up next lands on a Saturday or Sunday class and turns over from Sunday to Monday', () => {
  const at = (date: string, hhmm: string) => ({
    date,
    minutes: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)),
  });
  const s = (date: string, startTime: string | null): SessionTime => ({
    date,
    startTime,
    minutes: 60,
  });
  // Mon/Wed/Sat Science and a Sunday class.
  const sessions = [
    s('2026-11-23', '08:00'),
    s('2026-11-25', '08:00'),
    s('2026-11-28', '07:30'),
    s('2026-11-29', '13:00'),
    s('2026-11-30', '08:00'),
  ];
  assert.equal(nextTeachingDate(sessions, at('2026-11-27', '15:00')), '2026-11-28'); // Friday: tomorrow is Saturday
  assert.equal(nextTeachingDate(sessions, at('2026-11-28', '07:00')), '2026-11-28');
  assert.equal(nextTeachingDate(sessions, at('2026-11-28', '09:00')), '2026-11-29'); // after Saturday's class
  assert.equal(nextTeachingDate(sessions, at('2026-11-29', '14:30')), '2026-11-30'); // after Sunday's class
  // This Week opens on the week of that day: Saturday and Sunday are in the week of the Monday before them.
  assert.equal(mondayOf('2026-11-28'), MON);
  assert.equal(mondayOf('2026-11-29'), MON);
  assert.equal(mondayOf('2026-11-30'), '2026-11-30');
  // A Saturday is the third Science class of a Mon/Wed/Sat week; Monday starts the count again.
  const timed = sessions.map((x, i) => ({
    date: x.date,
    startTime: x.startTime,
    assignmentId: 'sci',
    slotId: `s${i}`,
  }));
  assert.equal(ordinalInWeek(timed, { date: '2026-11-28', assignmentId: 'sci', slotId: 's2' }), 3);
  assert.equal(ordinalInWeek(timed, { date: '2026-11-29', assignmentId: 'sci', slotId: 's3' }), 4);
  assert.equal(ordinalInWeek(timed, { date: '2026-11-30', assignmentId: 'sci', slotId: 's4' }), 1);
});

test('a weekend class is in the term week of the Monday before it, across a term boundary', () => {
  const year = {
    terms: [
      { index: 2, startDate: '2026-09-14', endDate: '2026-11-28' }, // ends on a Saturday
      { index: 3, startDate: '2026-11-29', endDate: '2027-02-27' }, // starts on a Sunday
    ],
  };
  assert.deepEqual(termWeekFor(year, '2026-11-23'), { term: 2, week: 11 });
  assert.deepEqual(termWeekFor(year, '2026-11-28'), { term: 2, week: 11 });
  assert.deepEqual(termWeekFor(year, '2026-11-29'), { term: 3, week: 1 });
  assert.deepEqual(termWeekFor(year, '2026-11-30'), { term: 3, week: 2 });
  // The header for that week starts in Term 2 and, for a weekend school, still names Term 2 (its Saturday).
  const weekend = weekSpan(MON, { scheduleWeekdays: [6, 7], sessionDates: [] });
  assert.deepEqual(termWeekFor(year, weekend.start), { term: 2, week: 11 });
});

test('dates and weekdays do not move with the device time zone', () => {
  const saved = process.env.TZ;
  try {
    for (const zone of ['Asia/Manila', 'UTC', 'America/Los_Angeles', 'Pacific/Honolulu']) {
      process.env.TZ = zone;
      assert.deepEqual(['2026-11-28', '2026-11-29', '2026-11-30'].map(weekdayOf), [6, 7, 1], zone);
      assert.equal(mondayOf('2026-11-29'), MON, zone);
      assert.equal(addDays('2026-12-31', 3), '2027-01-03', zone);
      assert.deepEqual(span([6, 7]), { start: '2026-11-28', end: '2026-11-29' }, zone);
      assert.equal(nextMakeupDate('2026-11-24', [1, 3, 6]), '2026-11-29', zone);
    }
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});
