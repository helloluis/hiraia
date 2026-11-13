import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialConditions, transition, retryDelay } from './ladder';
import { syncWindow, createScheduler } from './scheduler';
import type { SyncEngine } from '@hiraia/tala-core/contracts';
test('all four rungs recover without dropping work; storage/session/format override connection', () => {
  let state = transition(initialConditions, {});
  assert.equal(state.rung, 'full');
  state = transition(state.conditions, { dataSaver: true });
  assert.equal(state.rung, 'low-bandwidth');
  assert.equal(state.downloadAttachments, false);
  state = transition(state.conditions, { connected: false });
  assert.equal(state.rung, 'offline-cache');
  assert.equal(state.canWrite, true);
  state = transition(state.conditions, { storageFull: true });
  assert.equal(state.rung, 'read-only-offline');
  assert.equal(state.canWrite, false);
  state = transition(state.conditions, { storageFull: false, connected: true, dataSaver: false });
  assert.equal(state.rung, 'full');
  for (const flag of ['sessionExpired', 'formatBlocked'] as const)
    assert.equal(transition(initialConditions, { [flag]: true }).canWrite, false);
  assert.equal(transition(initialConditions, { serverDown: true }).rung, 'offline-cache');
  assert.equal(transition(initialConditions, { lowMemory: true }).downloadAttachments, false);
  assert.equal(transition(initialConditions, { lowStorage: true }).canWrite, true);
});
test('backoff is bounded and randomised; full offline window and Sunday light window are correct', () => {
  assert.equal(
    retryDelay(0, () => 1),
    1000
  );
  assert.equal(
    retryDelay(1, () => 1),
    2000
  );
  assert.equal(
    retryDelay(10, () => 1),
    60000
  );
  assert.equal(
    retryDelay(1, () => 0),
    1000
  );
  assert.deepEqual(syncWindow(new Date('2026-11-15T12:00:00Z'), true), {
    windowFrom: '2026-11-09',
    windowTo: '2026-11-15',
  });
  assert.deepEqual(syncWindow(new Date('2026-11-13T12:00:00Z'), false), {
    windowFrom: '2026-10-16',
    windowTo: '2027-01-08',
  });
});
test('opportunistic scheduler is single-flight and cancels pending retries', async () => {
  let calls = 0,
    release: () => void = () => {};
  const engine = {
    sync: async () => {
      calls++;
      await new Promise<void>((r) => {
        release = r;
      });
      return { ok: false, error: 'offline' };
    },
  } as unknown as SyncEngine;
  const scheduler = createScheduler(engine, {
    online: () => true,
    light: () => true,
    changed: () => {},
    delay: () => 10000,
  });
  scheduler.kick();
  scheduler.kick();
  assert.equal(calls, 1);
  scheduler.stop();
  release();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
});
