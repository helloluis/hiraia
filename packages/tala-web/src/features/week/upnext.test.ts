import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockOf, dayRelation, formatClock, nextTeachingDate, ordinalInWeek, sessionOver, type SessionTime } from './upnext';

const at = (date: string, hhmm: string) => ({ date, minutes: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) });
const s = (date: string, startTime: string | null, minutes = 45): SessionTime => ({ date, startTime, minutes });
// Thu 19 Nov 2026 … a normal Mon–Fri week, then a Monday holiday the week after.
const week: SessionTime[] = [
  s('2026-11-16', '08:00'), s('2026-11-17', '08:00'), s('2026-11-18', '08:00'),
  s('2026-11-19', '08:00'), s('2026-11-19', '10:15'),
  s('2026-11-20', '08:00'), s('2026-11-20', '10:15'),
  s('2026-11-24', '08:00'), // Monday 23 is a holiday: no sessions on the timeline
];

test('a session is over once its time has passed; without a start time it counts all day', () => {
  assert.equal(sessionOver(s('2026-11-19', '08:00'), at('2026-11-19', '08:44')), false);
  assert.equal(sessionOver(s('2026-11-19', '08:00'), at('2026-11-19', '08:45')), true);
  assert.equal(sessionOver(s('2026-11-19', null), at('2026-11-19', '23:59')), false);
  assert.equal(sessionOver(s('2026-11-18', null), at('2026-11-19', '00:00')), true);
  assert.equal(sessionOver(s('2026-11-20', '08:00'), at('2026-11-19', '23:59')), false);
});

test('today is the next teaching day while a lesson is still to come or still running', () => {
  assert.equal(nextTeachingDate(week, at('2026-11-19', '06:30')), '2026-11-19');
  assert.equal(nextTeachingDate(week, at('2026-11-19', '09:00')), '2026-11-19'); // first is over, 10:15 is not
  assert.equal(nextTeachingDate(week, at('2026-11-19', '10:59')), '2026-11-19'); // 10:15 + 45 min still running
});

test('after the last lesson of the day, the next teaching day is tomorrow', () => {
  assert.equal(nextTeachingDate(week, at('2026-11-19', '11:00')), '2026-11-20');
  assert.equal(nextTeachingDate(week, at('2026-11-19', '20:30')), '2026-11-20');
});

test('weekends and a no-class Monday roll forward to the real next teaching day', () => {
  assert.equal(nextTeachingDate(week, at('2026-11-20', '11:00')), '2026-11-24'); // Friday after class
  assert.equal(nextTeachingDate(week, at('2026-11-21', '09:00')), '2026-11-24'); // Saturday
  assert.equal(nextTeachingDate(week, at('2026-11-23', '09:00')), '2026-11-24'); // the holiday itself
});

test('the search looks three weeks ahead; nothing in that window answers null (long break, end of the year)', () => {
  assert.equal(nextTeachingDate(week, at('2026-11-24', '09:00')), null);
  assert.equal(nextTeachingDate([s('2027-01-04', '08:00')], at('2026-12-19', '08:00')), '2027-01-04'); // 16 days ahead: found
  assert.equal(nextTeachingDate([s('2027-01-04', '08:00')], at('2026-12-10', '08:00')), null); // 25 days ahead: outside
  assert.equal(nextTeachingDate([], at('2026-11-19', '08:00')), null);
});

test('a class without a start time keeps today as the teaching day until midnight', () => {
  assert.equal(nextTeachingDate([s('2026-11-19', null), s('2026-11-20', null)], at('2026-11-19', '22:00')), '2026-11-19');
});

test('today / tomorrow / later / past', () => {
  assert.equal(dayRelation('2026-11-19', '2026-11-19'), 'today');
  assert.equal(dayRelation('2026-11-20', '2026-11-19'), 'tomorrow');
  assert.equal(dayRelation('2026-11-23', '2026-11-19'), 'later');
  assert.equal(dayRelation('2026-11-18', '2026-11-19'), 'past');
  assert.equal(dayRelation('2026-12-01', '2026-11-30'), 'tomorrow'); // month boundary
});

test('ordinal of a lesson among its subject\'s lessons in the week', () => {
  const all = [
    { date: '2026-11-16', assignmentId: 'sci', slotId: 'a', startTime: '08:00' },
    { date: '2026-11-17', assignmentId: 'sci', slotId: 'b', startTime: '08:00' },
    { date: '2026-11-17', assignmentId: 'math', slotId: 'm', startTime: '09:00' },
    { date: '2026-11-19', assignmentId: 'sci', slotId: 'd', startTime: '08:00' },
    { date: '2026-11-20', assignmentId: 'sci', slotId: 'e', startTime: '08:00' },
    { date: '2026-11-23', assignmentId: 'sci', slotId: 'a', startTime: '08:00' },
  ];
  assert.equal(ordinalInWeek(all, { date: '2026-11-16', assignmentId: 'sci', slotId: 'a' }), 1);
  assert.equal(ordinalInWeek(all, { date: '2026-11-19', assignmentId: 'sci', slotId: 'd' }), 3); // Wednesday had no class
  assert.equal(ordinalInWeek(all, { date: '2026-11-20', assignmentId: 'sci', slotId: 'e' }), 4);
  assert.equal(ordinalInWeek(all, { date: '2026-11-23', assignmentId: 'sci', slotId: 'a' }), 1); // a new week starts again
  assert.equal(ordinalInWeek(all, { date: '2026-11-17', assignmentId: 'math', slotId: 'm' }), 1);
});

test('class times read on a 12-hour clock', () => {
  assert.equal(formatClock('08:00'), '8:00 AM');
  assert.equal(formatClock('12:05'), '12:05 PM');
  assert.equal(formatClock('13:30'), '1:30 PM');
  assert.equal(formatClock('00:15'), '12:15 AM');
});

test('clockOf reads the device clock', () => {
  const c = clockOf(new Date(2026, 10, 19, 20, 30));
  assert.deepEqual(c, { date: '2026-11-19', minutes: 20 * 60 + 30 });
});
