import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine, createMemoryStore } from '@hiraia/tala-core/sync';
import { PlanSection } from '@hiraia/tala-core/contracts';
import type { SyncTransport, TimelineEntry } from '@hiraia/tala-core/contracts';
import { sectionHistory } from './history';
import { markSession } from './session';
const transport: SyncTransport = {
  push: async () => {
    throw Error('offline');
  },
  pull: async () => {
    throw Error('offline');
  },
};
function fixture() {
  let n = 0;
  const newId = () => `fixture-${String(++n).padStart(5, '0')}`;
  return {
    newId,
    engine: createSyncEngine({
      store: createMemoryStore(),
      transport,
      deviceId: 'device-0001',
      newId,
      now: () => new Date('2026-11-13T12:00:00Z'),
    }),
  };
}
test('history preserves original formatting once per edit session and retains unsent versions', async () => {
  const { engine, newId } = fixture();
  const section = PlanSection.parse({
    id: 'section-001',
    planId: 'plan-0001',
    key: 'objectives',
    content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'ñ', b: true }] }] },
  });
  const history = sectionHistory(engine, newId, () => new Date('2026-11-13T12:00:00Z'));
  await history.beforeEdit(section);
  await history.beforeEdit(section);
  assert.equal((await engine.list('section_revision')).length, 1);
  for (let i = 0; i < 12; i++) {
    history.reset();
    await history.beforeEdit(section);
  }
  const revisions = await engine.list('section_revision');
  assert.equal(revisions.length, 13);
  assert.deepEqual(revisions[0]!.data.content, section.content);
});
test('marking a multi-grade session covers every group and Undo removes new marks', async () => {
  const { engine, newId } = fixture();
  const e: TimelineEntry = {
    date: '2026-11-13',
    classId: 'class-001',
    assignmentId: 'assign-001',
    slotId: 'slot-0001',
    minutes: 50,
    subjectName: 'Science',
    byGroup: { 'group-001': ['competency-1'], 'group-002': ['competency-2'] },
    kind: 'lesson',
    planId: null,
    planState: 'none',
    mark: null,
    pairing: null,
  };
  const undo = await markSession(engine, e, 'partial', newId);
  const marks = await engine.list('session_mark');
  assert.equal(marks.length, 2);
  assert.ok(marks.every((m) => m.data.status === 'partial'));
  await undo();
  assert.equal((await engine.list('session_mark')).length, 0);
});
