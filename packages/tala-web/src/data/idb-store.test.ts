import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import type { LocalRecord } from '@hiraia/tala-core/contracts';
import { createIdbStore } from './idb-store';

const rec = (entity: 'class' | 'plan', id: string, extra: Partial<LocalRecord> = {}): LocalRecord =>
  ({
    entity,
    id,
    rev: 0,
    updatedAt: '2026-11-16T00:00:00.000Z',
    deletedAt: null,
    data: { id } as never,
    dirty: true,
    base: null,
    conflict: null,
    ...extra,
  }) as LocalRecord;

test('commit writes records, outbox and meta atomically and reads them back', async () => {
  const store = createIdbStore({ name: 'test-' + Math.random(), factory: new IDBFactory() });
  await store.commit({
    put: [rec('class', 'c1'), rec('plan', 'p1')],
    outboxAdd: [
      {
        mutationId: 'm1',
        entity: 'class',
        id: 'c1',
        op: 'upsert',
        baseRev: 0,
        createdAt: '2026-11-16T00:00:01.000Z',
        attempts: 0,
      },
    ],
    meta: { 'sync.cursor': '42', 'sync.mutation.m1': '{"x":1}' },
  });
  assert.equal((await store.get('class', 'c1'))?.id, 'c1');
  assert.equal((await store.list('plan')).length, 1);
  assert.equal((await store.outbox())[0]?.mutationId, 'm1');
  assert.equal(await store.getMeta('sync.cursor'), '42');
  assert.equal(await store.getMeta('sync.mutation.m1'), '{"x":1}');
  assert.equal(await store.getMeta('missing'), null);
});

test('list hides tombstones unless asked; remove purges rows; meta null deletes', async () => {
  const store = createIdbStore({ name: 'test-' + Math.random(), factory: new IDBFactory() });
  await store.commit({
    put: [rec('class', 'a'), rec('class', 'b', { deletedAt: '2026-11-16T00:00:00.000Z' })],
    meta: { k: 'v' },
  });
  assert.deepEqual(
    (await store.list('class')).map((r) => r.id),
    ['a']
  );
  assert.deepEqual((await store.list('class', { includeDeleted: true })).map((r) => r.id).sort(), [
    'a',
    'b',
  ]);
  await store.commit({ remove: [{ entity: 'class', id: 'b' }], meta: { k: null } });
  assert.deepEqual(
    (await store.list('class', { includeDeleted: true })).map((r) => r.id),
    ['a']
  );
  assert.equal(await store.getMeta('k'), null);
  await store.commit({
    outboxAdd: [
      {
        mutationId: 'm2',
        entity: 'class',
        id: 'a',
        op: 'delete',
        baseRev: 1,
        createdAt: 'x',
        attempts: 0,
      },
    ],
  });
  await store.commit({ outboxRemove: ['m2'] });
  assert.equal((await store.outbox()).length, 0);
  await store.clear();
  assert.equal((await store.list('class', { includeDeleted: true })).length, 0);
});

test('a failed put leaves nothing of the batch behind', async () => {
  const store = createIdbStore({ name: 'test-' + Math.random(), factory: new IDBFactory() });
  const bad = { ...rec('class', 'x'), data: { fn: () => 1 } as never }; // functions cannot be structured-cloned
  await assert.rejects(
    store.commit({ put: [rec('class', 'ok'), bad], meta: { 'sync.cursor': '1' } })
  );
  assert.equal(await store.get('class', 'ok'), null);
  assert.equal(await store.getMeta('sync.cursor'), null);
});
