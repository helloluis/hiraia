import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { build } from 'esbuild';
const mobile =
  process.env.PILOT_MOBILE_PATH ||
  path.resolve(import.meta.dirname, '../../../hiraia-unified/packages/mobile');
const temp = mkdtempSync(path.join(tmpdir(), 'hiraia-outbox-'));
const bundle = path.join(temp, 'repository.cjs');
await build({
  entryPoints: [path.join(mobile, 'src/telemetry/repository.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias: { 'expo-sqlite': path.join(import.meta.dirname, 'sqlite-shim.ts') },
});
const { openRepository } = createRequire(import.meta.url)(bundle);
let connections: Database.Database[] = [];
(globalThis as any).__telemetryOpen = (name: string) => {
  const db = new Database(path.join(temp, name));
  connections.push(db);
  const adapter = {
    async execAsync(sql: string) {
      db.exec(sql);
    },
    async runAsync(sql: string, ...args: any[]) {
      return db.prepare(sql).run(...args);
    },
    async getFirstAsync(sql: string, ...args: any[]) {
      return db.prepare(sql).get(...args);
    },
    async getAllAsync(sql: string, ...args: any[]) {
      return db.prepare(sql).all(...args);
    },
    async withExclusiveTransactionAsync(fn: any) {
      db.exec('BEGIN IMMEDIATE');
      try {
        await fn(adapter);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return adapter;
};
process.on('exit', () => {
  connections.forEach((db) => db.open && db.close());
  rmSync(temp, { recursive: true, force: true });
});
const event = (n: number, name = 'session_started') => ({
  id: 'event_01234567890_' + n,
  name,
  occurred_at: Date.now(),
  session_id: 'session_01234567890',
  props: { language: 'english' },
});

test('real SQLite: first launch is atomic, pending events and identity survive a fresh connection', async () => {
  const repo = await openRepository(event(1));
  const id = repo.installationId;
  assert.deepEqual(
    (await repo.list(50)).map((e: any) => e.name),
    ['first_open', 'session_started']
  );
  await repo.append([event(2, 'card_viewed')]);
  connections.forEach((db) => db.close());
  connections = [];
  const reopened = await openRepository(event(3));
  assert.equal(reopened.installationId, id);
  const events = await reopened.list(50);
  assert.equal(events.filter((e: any) => e.name === 'first_open').length, 1);
  assert.ok(events.some((e: any) => e.id === event(2).id));
  await reopened.acknowledge([event(2).id]);
  assert.equal(
    (await reopened.list(50)).some((e: any) => e.id === event(2).id),
    false
  );
});
test('real SQLite: storage cap evicts oldest events and emits a cumulative loss report', async () => {
  const repo = await openRepository(event(4));
  await repo.append(Array.from({ length: 10005 }, (_, n) => event(100 + n, 'card_viewed')));
  const db = connections.at(-1)!;
  assert.equal((db.prepare('SELECT count(*) n FROM outbox').get() as any).n, 10000);
  const report = JSON.parse(
    (db.prepare('SELECT event FROM outbox ORDER BY seq DESC LIMIT 1').get() as any).event
  );
  assert.equal(report.name, 'queue_dropped');
  assert.ok(report.props.count >= 6);
  await repo.append([event(20000, 'card_viewed')]);
  const next = JSON.parse(
    (db.prepare('SELECT event FROM outbox ORDER BY seq DESC LIMIT 1').get() as any).event
  );
  assert.ok(next.props.count > report.props.count);
});
test('real SQLite: opt-out deletes unsent data and persists across process restart', async () => {
  const repo = await openRepository(event(20001));
  await repo.setEnabled(false);
  await repo.append([event(20002)]);
  assert.deepEqual(await repo.list(50), []);
  connections.forEach((db) => db.close());
  connections = [];
  const reopened = await openRepository(event(20003));
  assert.equal(await reopened.isEnabled(), false);
  assert.deepEqual(await reopened.list(50), []);
  await reopened.setEnabled(true);
  await reopened.append([event(20004)]);
  assert.equal((await reopened.list(50)).length, 1);
});
test('real SQLite: corrupt queued JSON is discarded without blocking valid events', async () => {
  const repo = await openRepository(event(20005));
  const db = connections.at(-1)!;
  db.prepare('INSERT INTO outbox(id,queued_at,event) VALUES(?,?,?)').run(
    'corrupt_0123456789',
    Date.now(),
    '{broken'
  );
  await repo.append([event(20006, 'card_viewed')]);
  assert.ok((await repo.list(50)).some((e: any) => e.id === event(20006).id));
  assert.equal(
    (db.prepare("SELECT count(*) n FROM outbox WHERE id='corrupt_0123456789'").get() as any).n,
    0
  );
});
