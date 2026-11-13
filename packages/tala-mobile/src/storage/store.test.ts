import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteStore, type Database } from './store';
import { createSyncEngine } from '@hiraia/tala-core/sync';
import type { LocalRecord, SyncTransport } from '@hiraia/tala-core/contracts';
function database(path: string) {
  const sql = new DatabaseSync(path);
  const db: Database = {
    async execAsync(s) {
      sql.exec(s);
    },
    async runAsync(s, ...p) {
      sql.prepare(s).run(...p);
    },
    async getFirstAsync<T>(s: string, ...p: (string | number | null)[]) {
      return (sql.prepare(s).get(...p) as T) ?? null;
    },
    async getAllAsync<T>(s: string, ...p: (string | number | null)[]) {
      return sql.prepare(s).all(...p) as T[];
    },
    async withExclusiveTransactionAsync(fn) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        await fn(db);
        sql.exec('COMMIT');
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db, close: () => sql.close() };
}
const record: LocalRecord<'day_note'> = {
  entity: 'day_note',
  id: 'note-0001',
  rev: 0,
  updatedAt: '2026-11-13T00:00:00Z',
  deletedAt: null,
  data: { id: 'note-0001', classId: 'class-001', date: '2026-11-13', text: 'ñ — saved' },
  dirty: true,
  base: null,
  conflict: null,
};
test('records, outbox, cursor survive reopen; failed batch rolls back all writes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tala-store-'));
  const path = join(dir, 'test.db');
  let sql = database(path);
  let store = await createSqliteStore(sql.db);
  await store.commit({
    put: [record],
    outboxAdd: [
      {
        mutationId: 'mutation-001',
        entity: 'day_note',
        id: record.id,
        op: 'upsert',
        baseRev: 0,
        createdAt: record.updatedAt,
        attempts: 0,
      },
    ],
    meta: { cursor: 'page-1' },
  });
  sql.close();
  sql = database(path);
  store = await createSqliteStore(sql.db);
  assert.equal(
    (await store.get('day_note', record.id))?.data &&
      ((await store.get('day_note', record.id))!.data as typeof record.data).text,
    'ñ — saved'
  );
  assert.equal((await store.outbox()).length, 1);
  assert.equal(await store.getMeta('cursor'), 'page-1');
  await assert.rejects(
    store.commit({
      put: [{ ...record, data: { ...record.data, text: 'must rollback' } }],
      remove: [{ entity: 'day_note', id: record.id }],
      outboxAdd: [{ mutationId: null } as never],
      meta: { cursor: 'page-2' },
    })
  );
  assert.equal(
    ((await store.get('day_note', record.id))!.data as typeof record.data).text,
    'ñ — saved'
  );
  assert.equal(await store.getMeta('cursor'), 'page-1');
  await store.commit({
    put: [{ ...record, deletedAt: record.updatedAt }],
    outboxRemove: ['mutation-001'],
    meta: { cursor: null },
  });
  assert.equal((await store.list('day_note')).length, 0);
  assert.equal((await store.list('day_note', { includeDeleted: true })).length, 1);
  await store.clear();
  assert.equal((await store.outbox()).length, 0);
  assert.equal(await store.getMeta('cursor'), null);
  sql.close();
  rmSync(dir, { recursive: true });
});
test('shared sync wiring resumes durable outbox with same mutation identifier after lost response', async () => {
  const sql = database(':memory:');
  const store = await createSqliteStore(sql.db);
  let online = false;
  const ids: string[] = [];
  const transport: SyncTransport = {
    async push(body) {
      ids.push(body.mutations[0]!.mutationId);
      if (!online) throw new Error('lost response');
      return {
        results: body.mutations.map((m) => ({
          mutationId: m.mutationId,
          status: 'applied',
          record: {
            entity: m.entity,
            id: m.id,
            rev: 1,
            updatedAt: record.updatedAt,
            deletedAt: null,
            data: m.data,
          },
        })),
      };
    },
    async pull() {
      return { records: [], cursor: 'finished', hasMore: false, serverTime: record.updatedAt };
    },
  };
  let id = 0;
  const deps = {
    store,
    transport,
    deviceId: 'device-001',
    newId: () => `mutation-${++id}`,
    now: () => new Date(record.updatedAt),
  };
  let engine = createSyncEngine(deps);
  await engine.put('day_note', record.data);
  assert.equal((await store.outbox()).length, 1);
  assert.equal((await engine.sync()).ok, false);
  engine = createSyncEngine(deps);
  online = true;
  assert.equal((await engine.sync()).ok, true);
  assert.equal(ids[0], ids[1]);
  assert.equal((await store.outbox()).length, 0);
  assert.equal((await engine.get('day_note', record.id))?.dirty, false);
  sql.close();
});

test('physical purges remove private rows atomically with cursor metadata', async () => {
  const sql = database(':memory:');
  const store = await createSqliteStore(sql.db);
  await store.commit({ put: [record] });
  await store.commit({
    remove: [{ entity: record.entity, id: record.id }],
    meta: { cursor: 'after-purge' },
  });
  assert.equal(await store.get('day_note', record.id), null);
  assert.equal((await store.list('day_note', { includeDeleted: true })).length, 0);
  assert.equal(await store.getMeta('cursor'), 'after-purge');
  sql.close();
});
