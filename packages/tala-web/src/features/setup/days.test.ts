import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekdayOf } from '../../data/ids';
import { DEFAULT_DAYS, WEEKDAYS, hasWeekend, toggleDay, weekdayReference } from './days';

test('all seven days can be chosen, Saturday and Sunday included; a new subject starts Monday to Friday', () => {
  assert.deepEqual([...WEEKDAYS], [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([...DEFAULT_DAYS], [1, 2, 3, 4, 5]);
  assert.equal(hasWeekend(DEFAULT_DAYS), false);
  assert.equal(hasWeekend([1, 3, 6]), true);
  assert.equal(hasWeekend([7]), true);
});

test('toggling keeps distinct days in Monday-to-Sunday order', () => {
  assert.deepEqual(toggleDay([1, 3], 6), [1, 3, 6]);
  assert.deepEqual(toggleDay([6], 7), [6, 7]);
  assert.deepEqual(toggleDay([7], 1), [1, 7]);
  assert.deepEqual(toggleDay([1, 3, 6], 3), [1, 6]);
  assert.deepEqual(toggleDay([1, 1, 7], 2), [1, 2, 7]);
  assert.deepEqual(toggleDay([6], 6), []);
});

test('each day button is named from a date of that weekday, the same in every time zone the app supports', () => {
  // The picker names a day with formatDate, which reads the date at UTC noon. The old buttons read UTC midnight,
  // which a device west of UTC showed as the day before (Monday's button said "Sun").
  const name = (locale: string, d: number) =>
    new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(
      new Date(`${weekdayReference(d)}T12:00:00Z`)
    );
  const saved = process.env.TZ;
  try {
    for (const zone of ['Asia/Manila', 'UTC', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      assert.deepEqual(
        WEEKDAYS.map((d) => weekdayOf(weekdayReference(d))),
        [...WEEKDAYS]
      );
      assert.deepEqual(
        WEEKDAYS.map((d) => name('en-PH', d)),
        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        zone
      );
      assert.deepEqual(
        WEEKDAYS.map((d) => name('fil-PH', d)),
        ['Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado', 'Linggo'],
        zone
      );
    }
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});
