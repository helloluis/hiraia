import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ingest, openTelemetry, validEvent } from '../../packages/web/src/lib/telemetry/store.ts';
import { POST } from '../../packages/web/src/app/api/telemetry/batch/route.ts';
const mobile =
  process.env.PILOT_MOBILE_PATH ||
  path.resolve(import.meta.dirname, '../../../hiraia-unified/packages/mobile');
const { Outbox } = await import(pathToFileURL(path.join(mobile, 'src/telemetry/core.ts')).href);
const installation_id = 'installation_0123456789';
const session_id = 'session_01234567890123';
const event = (n = 1) => ({
  id: 'event_01234567890_' + n,
  name: 'card_viewed',
  occurred_at: Date.now() - 10 * 86400000,
  session_id,
  props: { source: 'curated', language: 'tagalog', card_id: 'fct-12' },
});
const temp = mkdtempSync(path.join(tmpdir(), 'hiraia-telemetry-'));
process.env.HIRAIA_TELEMETRY_DB_PATH = path.join(temp, 'route.db');
process.on('exit', () => rmSync(temp, { recursive: true, force: true }));

test('late events retain their original date and retries are acknowledged without double counting', () => {
  const db = openTelemetry(path.join(temp, 'late.db'));
  const body = { schema: 1, installation_id, events: [event()] };
  assert.deepEqual(ingest(db, body), { acknowledged: [event().id], rejected: [] });
  ingest(db, body);
  const row = db
    .prepare('SELECT count(*) n, occurred_at,received_at FROM telemetry_events')
    .get() as any;
  assert.equal(row.n, 1);
  assert.equal(row.occurred_at, body.events[0].occurred_at);
  assert.ok(row.received_at - row.occurred_at >= 10 * 86400000);
  db.close();
});
test('unexpected child text is rejected without blocking valid records in the batch', () => {
  const db = openTelemetry(path.join(temp, 'validation.db'));
  for (const key of ['query', 'answer', 'email', 'latitude', 'device_id']) {
    assert.equal(validEvent({ ...event(), props: { [key]: 'private text' } }), false);
  }
  for (const bad of [
    { ...event(), name: 'arbitrary' },
    { ...event(), props: { correct: 'yes' } },
    { ...event(), props: { duration_ms: -1 } },
    { ...event(), occurred_at: NaN },
  ]) {
    const result = ingest(db, { schema: 1, installation_id, events: [event(2), bad] });
    assert.deepEqual(result.rejected, [bad.id]);
    assert.deepEqual(result.acknowledged, [event(2).id]);
  }
  assert.equal((db.prepare('SELECT count(*) n FROM telemetry_events').get() as any).n, 1);
  db.close();
});
test('HTTP boundary rejects oversized bodies even without Content-Length and rejects non-JSON', async () => {
  assert.equal(
    (await POST(new Request('https://local/api', { method: 'POST', body: 'x' }))).status,
    415
  );
  const oversized = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('x'.repeat(100001)));
      c.close();
    },
  });
  const request = new Request('https://local/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: oversized,
    duplex: 'half',
  } as any);
  assert.equal((await POST(request)).status, 413);
  const valid = new Request('https://local/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: 1, installation_id, events: [event()] }),
  });
  assert.equal((await POST(valid)).status, 200);
});
function memoryRepo() {
  const saved = new Map<string, any>();
  let next = 0;
  return {
    installationId: installation_id,
    saved,
    async append(events: any[]) {
      for (const e of events) saved.set(e.id, e);
    },
    async list(n: number) {
      return [...saved.values()].slice(0, n);
    },
    async acknowledge(ids: string[]) {
      ids.forEach((id) => saved.delete(id));
    },
    async retryAt() {
      return next;
    },
    async setRetryAt(t: number) {
      next = t;
    },
  };
}
test('offline -> process restart -> server commits but response lost -> retry delivers exactly once', async () => {
  const repo = memoryRepo();
  const db = openTelemetry(path.join(temp, 'retry.db'));
  let now = Date.now(),
    calls = 0,
    online = false,
    loseReply = true;
  const send = async (body: object) => {
    calls++;
    if (!online) throw Error('offline');
    const result = ingest(db, body, now);
    if (loseReply) {
      loseReply = false;
      throw Error('connection lost after commit');
    }
    return { ok: true, ...result };
  };
  let queue = new Outbox(
    async () => repo,
    send,
    () => now,
    () => 0.5
  );
  queue.enqueue([event(1), event(2)]);
  await queue.drainWrites();
  await queue.flush();
  assert.equal(repo.saved.size, 2);
  queue = new Outbox(
    async () => repo,
    send,
    () => now,
    () => 0.5
  );
  await queue.flush();
  assert.equal(calls, 1, 'persisted retry time honored across restart');
  now += 86400000;
  online = true;
  await queue.flush();
  assert.equal(repo.saved.size, 2, 'lost acknowledgement retains data');
  now += 86400000;
  await queue.flush();
  assert.equal(repo.saved.size, 0);
  assert.equal((db.prepare('SELECT count(*) n FROM telemetry_events').get() as any).n, 2);
  db.close();
});
test('unrelated acknowledgement cannot delete queued events; Retry-After is honored', async () => {
  const repo = memoryRepo();
  let now = Date.now(),
    calls = 0;
  const queue = new Outbox(
    async () => repo,
    async () => {
      calls++;
      return { ok: true, acknowledged: ['someone_else'], retryAfterMs: 120000 };
    },
    () => now
  );
  queue.enqueue([event()]);
  await queue.flush();
  assert.equal(repo.saved.size, 1);
  now += 60000;
  await queue.flush();
  assert.equal(calls, 1);
  now += 61000;
  await queue.flush();
  assert.equal(calls, 2);
});
test('disk failures never reject event recording or flush', async () => {
  const queue = new Outbox(
    async () => {
      throw Error('disk full');
    },
    async () => {
      throw Error('unexpected network');
    }
  );
  queue.enqueue([event()]);
  await queue.drainWrites();
  await queue.flush();
});

test('permanent rejection removes only rejected records and reports the loss without stranding the queue', async () => {
  const repo = memoryRepo();
  const queue = new Outbox(
    async () => repo,
    async (body: any) => ({
      ok: true,
      acknowledged: body.events.filter((e: any) => e.id !== event(1).id).map((e: any) => e.id),
      rejected: body.events.filter((e: any) => e.id === event(1).id).map((e: any) => e.id),
    })
  );
  let loss = 0;
  const append = repo.append;
  repo.append = async (events) => {
    for (const e of events) if (e.name === 'queue_dropped') loss += e.props.count;
    await append(events);
  };
  queue.enqueue([event(1), event(2)]);
  await queue.flush();
  assert.equal(repo.saved.size, 0);
  assert.equal(loss, 1);
});
