import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PacingTrack } from '@hiraia/tala-core/contracts';
import { meetingDays, slotsForDays, tracksToRepace } from './timetable';

const science = {
  id: 'sci',
  slots: [
    { id: 'sci-1', weekday: 1, startTime: '08:00', minutes: 50, rotation: null },
    {
      id: 'legacy-wed',
      weekday: 3,
      startTime: '08:00',
      minutes: 50,
      rotation: { everyWeeks: 2, week: 1 },
    },
  ],
};
const track = (id: string, assignmentId: string, accepted: boolean): PacingTrack => ({
  id,
  classId: 'c4',
  assignmentId,
  gradeGroupId: 'g4',
  termId: 't2',
  curriculumVersion: 'science-bow-2026',
  startPosition: { competencyId: 'x', date: '2026-11-09', estimated: true },
  allocation: accepted
    ? [{ competencyIds: ['x'], sessions: [{ date: '2026-11-09', slotId: 'sci-1' }] }]
    : null,
  params: { bufferRatio: 0.2 },
  overrides: { sessions: { x: 3 } },
});

test('adding Saturday and Sunday keeps the existing days’ slots and adds a slot per new day', () => {
  assert.deepEqual(meetingDays(science), [1, 3]);
  const slots = slotsForDays(science, [7, 1, 3, 6], 60, '07:30');
  assert.deepEqual(
    slots.map((s) => [s.id, s.weekday, s.minutes, s.startTime]),
    [
      ['sci-1', 1, 60, '07:30'],
      ['legacy-wed', 3, 60, '07:30'],
      ['sci-6', 6, 60, '07:30'],
      ['sci-7', 7, 60, '07:30'],
    ]
  );
  assert.deepEqual(slots[1]!.rotation, { everyWeeks: 2, week: 1 });
  assert.equal(slots[2]!.rotation, null);
  // No start time is fine ("Science is Saturday, 60 minutes").
  assert.deepEqual(
    slotsForDays(science, [6], 60, '').map((s) => [s.id, s.startTime]),
    [['sci-6', null]]
  );
  // A day picked twice is still one class period.
  assert.equal(slotsForDays(science, [6, 6], 60, '').length, 1);
});

test('a change of days re-proposes only this subject’s tracks that kept accepted placements', () => {
  const tracks = [
    track('accepted', 'sci', true),
    track('fresh', 'sci', false),
    track('math', 'math', true),
  ];
  assert.deepEqual(tracksToRepace(tracks, science, [1, 3]), []);
  assert.deepEqual(tracksToRepace(tracks, science, [3, 1]), []);
  const changed = tracksToRepace(tracks, science, [1, 3, 6]);
  assert.deepEqual(
    changed.map((t) => [t.id, t.allocation]),
    [['accepted', null]]
  );
  // Everything the teacher set stays: start position, parameters and overrides.
  assert.deepEqual(changed[0]!.startPosition, tracks[0]!.startPosition);
  assert.deepEqual(changed[0]!.params, { bufferRatio: 0.2 });
  assert.deepEqual(changed[0]!.overrides, { sessions: { x: 3 } });
  assert.equal(tracksToRepace(tracks, science, [1]).length, 1); // removing a day re-proposes too
});
