/** Integration coverage owned by H: actual kernel, typed client and SQLite record store. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRecordData } from '@hiraia/tala-core';
import { createMemoryStore, createSyncEngine } from '@hiraia/tala-core/sync';
import { createTestServer } from '@hiraia/tala-server/testing';

test('targeted fetch hydrates older plan, section and paginated history without changing normal cursor', async (context) => {
  const t = createTestServer();
  context.after(() => t.close());
  const user = await t.registerUser();
  const plan = parseRecordData('plan', {
    id: 'older-plan',
    title: 'Older lesson',
    templateId: 'tpl.dlp.v1',
    language: 'en',
    grades: ['4'],
    durationMinutes: 50,
    placements: [{ classId: 'class1', assignmentId: null, dates: ['2020-01-01'] }],
  });
  const section = parseRecordData('plan_section', {
    id: 'older-section',
    planId: plan.id,
    key: 'content',
    content: { type: 'text', blocks: [] },
  });
  t.services.records.put(user.id, 'plan', plan);
  t.services.records.put(user.id, 'plan_section', section);
  for (let i = 0; i < 110; i++)
    t.services.records.put(
      user.id,
      'section_revision',
      parseRecordData('section_revision', {
        id: `history-${i}`,
        planId: plan.id,
        sectionId: section.id,
        key: section.key,
        content: section.content,
        origin: 'manual',
        reason: 'edit',
        savedAt: t.clock.now().toISOString(),
      })
    );
  let n = 0;
  const store = createMemoryStore();
  const engine = createSyncEngine({
    store,
    transport: t.client(user.token).syncTransport,
    deviceId: 'fetch-device',
    now: t.clock.now,
    newId: () => `fetch-${++n}`,
  });
  assert.equal((await engine.sync({ windowFrom: '2026-11-01', windowTo: '2026-12-01' })).ok, true);
  assert.equal(await engine.get('plan', plan.id), null);
  const cursor = await store.getMeta('sync.cursor');
  const report = await engine.fetchPlans!([plan.id]);
  assert.equal(report.ok, true);
  assert.equal(report.pulled, 112);
  assert.ok(await engine.get('plan', plan.id));
  assert.ok(await engine.get('plan_section', section.id));
  assert.equal((await engine.list('section_revision')).length, 110);
  assert.equal(await store.getMeta('sync.cursor'), cursor);
  // Atomic offline generation/setup bundle becomes a normal real server push.
  await engine.batch!([
    { op: 'put', entity: 'plan', data: { ...plan, id: 'new-plan' } },
    {
      op: 'put',
      entity: 'plan_section',
      data: { ...section, id: 'new-section', planId: 'new-plan' },
    },
  ]);
  assert.equal((await engine.sync()).ok, true);
  assert.equal(t.services.records.planSnapshot(user.id, 'new-plan')?.sections.length, 1);
  const other = await t.registerUser();
  const outsider = createSyncEngine({
    store: createMemoryStore(),
    transport: t.client(other.token).syncTransport,
    deviceId: 'other-device',
    now: t.clock.now,
    newId: () => `other-${++n}`,
  });
  assert.equal((await outsider.fetchPlans!([plan.id])).pulled, 0);
  assert.equal(await outsider.get('plan', plan.id), null);
  assert.deepEqual(t.errors, []);
});
