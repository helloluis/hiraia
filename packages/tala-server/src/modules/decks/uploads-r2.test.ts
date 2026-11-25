/**
 * Teachers' uploaded files in object storage (r2.ts), against the fake S3 server (fake-s3.ts): settings, the
 * credentials file, the object client, and the uploads module's routes, background work and failure cases.
 * Real R2 is checked separately in a rehearsal (deploy/r2/README.md), with synthetic files only.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UPLOAD_LIMITS } from '@hiraia/tala-core/contracts';
import { syntheticDeckParts } from '@hiraia/tala-core/pptx/testing';
import { createTestServer, type TestServer, type TestUser } from '../../testing';
import { startFakeS3, type FakeKey, type FakeS3 } from './fake-s3';
import { createDecksModule } from './index';
import { credentialsFile, objectStore, parseCredentials, storageSettingFromEnv, StoreError, uploadObjectKey, type ObjectStore, type R2Settings } from './r2';
import { writeZip } from './zip';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const PREFIX = 'tala/test/';
const KEY1: FakeKey = { accessKeyId: 'TALATESTKEYONE1', secretAccessKey: 'test-secret-one-0123456789abcdef', sessionToken: 'dG9rZW4tb25l', prefix: PREFIX };
const KEY2: FakeKey = { accessKeyId: 'TALATESTKEYTWO2', secretAccessKey: 'test-secret-two-0123456789abcdef', sessionToken: 'dG9rZW4tdHdv', prefix: PREFIX };

function pptx(photoBytes = 0): Uint8Array {
  const parts = syntheticDeckParts(photoBytes ? { 'ppt/media/photo.png': new Uint8Array(randomBytes(photoBytes)) } : {});
  return writeZip(Object.entries(parts).map(([name, data]) => ({ name, data })));
}
const reason = (r: { error: { details?: unknown } | null }) => (r.error?.details as { reason?: string } | undefined)?.reason;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, cond: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for: ${what}`);
    await sleep(15);
  }
}

/** A credentials file in a folder of its own, replaced the way the renewal does it: a new file renamed over it. */
function keysFile(dir: string, key: FakeKey, extra: Record<string, unknown> = {}): string {
  const path = join(dir, 'r2-credentials.json');
  const next = join(dir, `.next-${randomBytes(4).toString('hex')}`);
  writeFileSync(next, JSON.stringify({ accessKeyId: key.accessKeyId, secretAccessKey: key.secretAccessKey, ...(key.sessionToken ? { sessionToken: key.sessionToken } : {}), ...extra }), { mode: 0o600 });
  renameSync(next, path);
  return path;
}

interface World {
  fake: FakeS3;
  dir: string;
  creds: string;
  settings: R2Settings;
  store: ObjectStore;
  server(dbPath?: string): TestServer;
  done(): Promise<void>;
}
async function world(options: { keys?: FakeKey[] } = {}): Promise<World> {
  const fake = await startFakeS3({ bucket: 'tala-test', keys: options.keys ?? [{ ...KEY1 }, { ...KEY2 }] });
  const dir = mkdtempSync(join(tmpdir(), 'tala-r2-test-'));
  const creds = keysFile(dir, KEY1);
  const settings: R2Settings = { endpoint: fake.endpoint, bucket: fake.bucket, prefix: PREFIX, region: 'auto', credentialsFile: creds };
  // Short rests and time limits, so that outages in a test last milliseconds.
  const store = objectStore(settings, { credentials: credentialsFile(creds, { checkEveryMs: 0 }), restMs: [20, 80], baseTimeoutMs: 1500, msPerMiB: 200 });
  const servers: TestServer[] = [];
  return {
    fake,
    dir,
    creds,
    settings,
    store,
    server(dbPath) {
      const t = createTestServer({
        ...(dbPath ? { config: { dbPath } } : {}),
        modules: [createDecksModule({ uploads: { renderer: null, storage: { kind: 'r2', settings, store }, storageTickMs: 25 } })],
      });
      servers.push(t);
      return t;
    },
    async done() {
      for (const t of servers) {
        try {
          t.close();
        } catch {
          /* closed already */
        }
      }
      await fake.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function upload(t: TestServer, user: TestUser, file: Uint8Array, fileName = 'Plants.pptx') {
  const session = await t.ok('decks.uploads.begin', { body: { fileName, bytes: file.length, sha256: sha(file) }, token: user.token });
  const count = Math.ceil(file.length / UPLOAD_LIMITS.chunkBytes);
  for (let i = 0; i < count; i++) {
    const piece = file.subarray(i * UPLOAD_LIMITS.chunkBytes, (i + 1) * UPLOAD_LIMITS.chunkBytes);
    await t.ok('decks.uploads.chunk', { params: { sessionId: session.sessionId, index: String(i) }, body: { data: Buffer.from(piece).toString('base64') }, token: user.token });
  }
  return { sessionId: session.sessionId, finish: () => t.call('decks.uploads.finish', { params: { sessionId: session.sessionId }, token: user.token }) };
}
async function uploaded(t: TestServer, user: TestUser, file: Uint8Array) {
  const r = await (await upload(t, user, file)).finish();
  assert.ok(r.ok, JSON.stringify(r.error));
  return r.data;
}
const original = async (t: TestServer, user: TestUser, uploadId: string) => new Uint8Array(await t.ok('decks.uploads.original', { params: { uploadId }, token: user.token }));
const row = (t: TestServer, id: string) => t.db.prepare('SELECT object_key FROM decks_uploads WHERE id = ?').get(id) as { object_key: string | null } | undefined;
const intents = (t: TestServer) => t.db.prepare('SELECT key, state, uncertain FROM decks_upload_objects ORDER BY key').all() as Array<{ key: string; state: string; uncertain: number }>;
const pieces = (t: TestServer) => (t.db.prepare('SELECT COUNT(*) AS n FROM decks_upload_file_pieces').get() as { n: number }).n;

/* ---------------- settings and keys ---------------- */

test('settings: nothing set is the database on a developer machine and OFF in staging and production; partial or unusable settings are off everywhere', () => {
  const ok = { TALA_R2_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', TALA_R2_BUCKET: 'hiraia-archive', TALA_R2_PREFIX: 'tala/production/', TALA_R2_CREDENTIALS_FILE: '/etc/tala/r2-credentials.json' };
  assert.deepEqual(storageSettingFromEnv({}), { kind: 'database' });
  assert.equal(storageSettingFromEnv({ TALA_ENV: 'production' }).kind, 'off');
  assert.equal(storageSettingFromEnv({ TALA_ENV: 'staging' }).kind, 'off');
  assert.deepEqual(storageSettingFromEnv({ TALA_ENV: 'production', ...ok }), { kind: 'r2', settings: { endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'hiraia-archive', prefix: 'tala/production/', region: 'auto', credentialsFile: '/etc/tala/r2-credentials.json' } });
  const problems = (env: Record<string, string>) => {
    const s = storageSettingFromEnv(env);
    return s.kind === 'off' ? s.problems.join(' | ') : `not off: ${s.kind}`;
  };
  // Some set and some not: off, also locally (never the database instead).
  assert.match(problems({ TALA_R2_BUCKET: 'hiraia-archive' }), /TALA_R2_ENDPOINT is not set/);
  assert.match(problems({ TALA_ENV: 'production', ...ok, TALA_R2_PREFIX: '' }), /TALA_R2_PREFIX is not set/);
  assert.match(problems({ TALA_ENV: 'production', ...ok, TALA_R2_PREFIX: 'tala/production' }), /ending in '\/'/);
  assert.match(problems({ TALA_ENV: 'production', ...ok, TALA_R2_PREFIX: '../etc/' }), /folder names/);
  assert.match(problems({ TALA_ENV: 'production', ...ok, TALA_R2_ENDPOINT: 'http://acc.r2.cloudflarestorage.com' }), /https/);
  assert.match(problems({ TALA_ENV: 'production', ...ok, TALA_R2_ENDPOINT: 'https://acc.r2.cloudflarestorage.com/bucket' }), /no path/);
  assert.match(problems({ TALA_ENV: 'production', ...ok, TALA_R2_ENDPOINT: 'https://u:p@acc.r2.cloudflarestorage.com' }), /user name/);
  assert.match(problems({ TALA_ENV: 'production', ...ok, TALA_R2_CREDENTIALS_FILE: 'r2.json' }), /absolute/);
  assert.match(problems({ TALA_ENV: 'production', ...ok, TALA_R2_BUCKET: 'Not_A_Bucket' }), /bucket name/);
  // A local store on this machine may be plain http; an empty prefix is allowed only on a developer machine.
  assert.equal(storageSettingFromEnv({ ...ok, TALA_R2_ENDPOINT: 'http://127.0.0.1:9000', TALA_R2_PREFIX: '' }).kind, 'r2');
  // Problems name settings, never a value.
  assert.ok(!problems({ TALA_ENV: 'production', ...ok, TALA_R2_ENDPOINT: 'http://secret-account.example' }).includes('secret-account'));
  assert.equal(uploadObjectKey('tala/production/', 'u-1', 'up_2'), 'tala/production/teachers/u-1/uploads/up_2/original');
  assert.throws(() => uploadObjectKey('tala/production/', '../x', 'u'), /id/);
});

test('credentials file: strict fields, never readable by every user, read again after a rename and before its keys end', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tala-r2-keys-'));
  try {
    assert.throws(() => parseCredentials('{"accessKeyId":"TALATESTKEYONE1","secretAccessKey":"x"}'), /secretAccessKey/);
    assert.throws(() => parseCredentials('{"accessKeyId":"TALATESTKEYONE1","secretAccessKey":"test-secret-one-0123456789abcdef","sessiontoken":"t"}'), /fields this server does not know/);
    assert.throws(() => parseCredentials('[1]'), /one JSON object/);
    assert.deepEqual(parseCredentials('{"accessKeyId":"TALATESTKEYONE1","secretAccessKey":"test-secret-one-0123456789abcdef","expiresAt":"2026-11-25T10:58:44Z"}').expiresAt, Date.parse('2026-11-25T10:58:44Z'));
    let clock = Date.parse('2026-11-25T10:00:00Z');
    const path = keysFile(dir, KEY1, { expiresAt: '2026-11-25T10:30:00Z' });
    const logged: string[] = [];
    const log = { info: (e: string) => logged.push(e), warn: (e: string) => logged.push(e), error: (e: string) => logged.push(e), debug: () => {} };
    const keys = credentialsFile(path, { checkEveryMs: 60_000, now: () => clock, log: () => log as never });
    assert.equal(keys.current().accessKeyId, KEY1.accessKeyId);
    // A new file is not looked at before `checkEveryMs`, unless the store refused the keys (reload) …
    keysFile(dir, KEY2, { expiresAt: '2026-11-25T16:00:00Z' });
    assert.equal(keys.current().accessKeyId, KEY1.accessKeyId);
    assert.equal(keys.reload(), true);
    assert.equal(keys.current().accessKeyId, KEY2.accessKeyId);
    assert.equal(keys.reload(), false, 'the same keys again are not worth another try');
    // … or the keys it holds are a minute from their end.
    keysFile(dir, KEY1, { expiresAt: '2026-11-25T22:00:00Z' });
    clock = Date.parse('2026-11-25T15:59:30Z');
    assert.equal(keys.current().accessKeyId, KEY1.accessKeyId);
    // Readable by every user: refused, and the keys read before are dropped too.
    chmodSync(path, 0o644);
    clock += 120_000;
    assert.throws(() => keys.current(), (e: unknown) => e instanceof StoreError && e.kind === 'refused');
    chmodSync(path, 0o640);
    assert.equal(keys.reload(), true);
    assert.equal(keys.current().accessKeyId, KEY1.accessKeyId);
    // A broken file keeps the keys it had, and says so once.
    writeFileSync(path, 'not json', { mode: 0o600 });
    clock += 120_000;
    assert.equal(keys.current().accessKeyId, KEY1.accessKeyId);
    assert.ok(logged.includes('deck_upload_storage_keys_unusable'));
    assert.ok(!JSON.stringify(logged).includes(KEY1.secretAccessKey));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------------- the object client ---------------- */

test('object client: new names only, read back whole or in ranges, removal, a key for one prefix, and plain errors', async () => {
  const w = await world();
  try {
    const bytes = new Uint8Array(randomBytes(70_000));
    const key = `${PREFIX}teachers/a/uploads/b/original`;
    await w.store.putNew(key, bytes, sha(bytes));
    assert.deepEqual(w.fake.objects.get(key), bytes);
    await assert.rejects(w.store.putNew(key, new Uint8Array([1, 2, 3]), sha(new Uint8Array([1, 2, 3]))), (e: unknown) => e instanceof StoreError && e.kind === 'exists');
    assert.deepEqual(w.fake.objects.get(key), bytes, 'nothing is overwritten');
    assert.deepEqual(await w.store.readWhole(key, bytes.length, sha(bytes)), bytes);
    await w.store.verify(key, bytes.length, sha(bytes));
    assert.deepEqual(await w.store.readRange(key, 10, 19), bytes.subarray(10, 20));
    await assert.rejects(w.store.readWhole(key, bytes.length, 'f'.repeat(64)), (e: unknown) => e instanceof StoreError && e.kind === 'damaged');
    await assert.rejects(w.store.readWhole(key, bytes.length + 1, sha(bytes)), (e: unknown) => e instanceof StoreError && e.kind === 'damaged');
    await assert.rejects(w.store.readWhole(`${PREFIX}nothing`, 1, sha(bytes)), (e: unknown) => e instanceof StoreError && e.kind === 'missing');
    // Outside the key's prefix: refused (403), not "unavailable", and the store is not counted as down.
    await assert.rejects(w.store.putNew('elsewhere/x', bytes, sha(bytes)), (e: unknown) => e instanceof StoreError && e.kind === 'refused' && e.status === 403);
    assert.equal(w.store.health().down, false);
    await w.store.remove(key);
    await w.store.remove(key); // a name already gone counts as removed
    assert.equal(w.fake.objects.has(key), false);
    // The store does not answer: unavailable at once, and the next request rests instead of waiting again.
    w.fake.fault({ kind: 'drop', times: Infinity });
    await assert.rejects(w.store.putNew(key, bytes, sha(bytes)), (e: unknown) => e instanceof StoreError && e.kind === 'unavailable');
    await assert.rejects(w.store.readRange(key, 0, 1), (e: unknown) => e instanceof StoreError && e.code === 'resting');
    assert.equal(w.store.health().down, true);
    w.fake.clearFaults();
    await sleep(40);
    await w.store.putNew(key, bytes, sha(bytes));
    assert.equal(w.store.health().down, false);
    // A store that hangs is given up on at the time limit.
    w.fake.fault({ kind: 'hang' });
    const started = Date.now();
    await assert.rejects(w.store.readRange(key, 0, 9), (e: unknown) => e instanceof StoreError && e.kind === 'unavailable' && e.code === 'timeout');
    assert.ok(Date.now() - started < 4000);
    // 5xx is unavailable; a body that comes back changed or short is damaged, never taken.
    await sleep(40);
    w.fake.fault({ kind: 'status', status: 503 });
    await assert.rejects(w.store.readRange(key, 0, 9), (e: unknown) => e instanceof StoreError && e.kind === 'unavailable' && e.status === 503);
    await sleep(40);
    w.fake.fault({ kind: 'corrupt', method: 'GET' });
    await assert.rejects(w.store.readWhole(key, bytes.length, sha(bytes)), (e: unknown) => e instanceof StoreError && e.kind === 'damaged');
    w.fake.fault({ kind: 'truncate', method: 'GET' });
    await assert.rejects(w.store.readWhole(key, bytes.length, sha(bytes)), (e: unknown) => e instanceof StoreError && (e.kind === 'damaged' || e.kind === 'unavailable'));
  } finally {
    await w.done();
  }
});

test('object client: an expired key is refused like a wrong one; the renewed file is read and the request tried once more', async () => {
  const w = await world();
  try {
    const bytes = new Uint8Array(randomBytes(5000));
    const key = `${PREFIX}teachers/a/uploads/c/original`;
    await w.store.putNew(key, bytes, sha(bytes));
    w.fake.keys.find((k) => k.accessKeyId === KEY1.accessKeyId)!.expiresAt = Date.now() - 1;
    // Not renewed yet: refused (once each way), nothing else.
    await assert.rejects(w.store.readRange(key, 0, 9), (e: unknown) => e instanceof StoreError && e.kind === 'refused' && e.code === 'SignatureDoesNotMatch');
    keysFile(w.dir, KEY2);
    const before = w.fake.requests.length;
    assert.deepEqual(await w.store.readRange(key, 0, 9), bytes.subarray(0, 10));
    assert.deepEqual(w.fake.requests.slice(before).map((r) => r.status), [206], 'the new keys were read before asking (the file had changed)');
    // Expired while the file still holds the expired keys, then renewed between the refusal and the retry.
    w.fake.keys.find((k) => k.accessKeyId === KEY2.accessKeyId)!.expiresAt = Date.now() - 1;
    w.fake.keys.find((k) => k.accessKeyId === KEY1.accessKeyId)!.expiresAt = undefined;
    const reloads: number[] = [];
    const store = objectStore(w.settings, {
      credentials: (() => {
        const real = credentialsFile(w.creds, { checkEveryMs: 60_000 });
        return {
          current: () => real.current(),
          reload: () => {
            reloads.push(1);
            keysFile(w.dir, KEY1);
            return real.reload();
          },
        };
      })(),
      restMs: [20, 80],
    });
    const at = w.fake.requests.length;
    await store.remove(key);
    assert.deepEqual(w.fake.requests.slice(at).map((r) => r.status), [403, 204]);
    assert.equal(reloads.length, 1);
  } finally {
    await w.done();
  }
});

/* ---------------- the module ---------------- */

test("uploads in object storage: one object under the teacher's own name, nothing in the database, the same bytes back, private", async () => {
  const w = await world();
  const t = w.server();
  try {
    const ana = await t.registerUser();
    const ben = await t.registerUser();
    const file = pptx(1_100_000); // three pieces of 512 KiB
    const deck = await uploaded(t, ana, file);
    const key = `${PREFIX}teachers/${ana.id}/uploads/${deck.id}/original`;
    assert.deepEqual([...w.fake.objects.keys()], [key]);
    assert.equal(sha(w.fake.objects.get(key)!), sha(file));
    assert.equal(row(t, deck.id)?.object_key, key);
    assert.equal(pieces(t), 0, 'no copy of the file is kept in the database');
    assert.deepEqual(intents(t), [{ key, state: 'stored', uncertain: 0 }]);
    assert.equal((t.db.prepare('SELECT COUNT(*) AS n FROM decks_upload_chunks').get() as { n: number }).n, 0, 'the arriving pieces are gone once the object is checked');
    // "The file I uploaded", in pieces from the bucket: the same bytes.
    assert.equal(sha(await original(t, ana, deck.id)), sha(file));
    // The edited file is written from the object.
    const slides = deck.base.slides.map((s) => ({ id: s.id, source: s.id }));
    slides.reverse();
    await t.ok('decks.uploads.save', { params: { uploadId: deck.id }, body: { baseRev: deck.rev, slides }, token: ana.token });
    const edited = new Uint8Array(await t.ok('decks.uploads.pptx', { params: { uploadId: deck.id }, token: ana.token }));
    assert.ok(edited.length > 1000);
    assert.notEqual(sha(edited), sha(file));
    // Another teacher: not found, everywhere, exactly like an id that does not exist.
    for (const route of ['decks.uploads.get', 'decks.uploads.original', 'decks.uploads.pptx', 'decks.uploads.delete'] as const) {
      const r = await t.call(route, { params: { uploadId: deck.id }, token: ben.token });
      assert.equal(r.status, 404, route);
    }
    assert.deepEqual((await t.ok('decks.uploads.list', { token: ben.token })).decks, []);
    // No link to the bucket is ever handed out, and the endpoint and keys are never logged.
    const logged = JSON.stringify(t.logs);
    assert.ok(!logged.includes(w.fake.endpoint) && !logged.includes(KEY1.secretAccessKey) && !logged.includes(KEY1.sessionToken!));
    assert.ok(!JSON.stringify(await t.ok('decks.uploads.get', { params: { uploadId: deck.id }, token: ana.token })).includes(PREFIX));
    assert.deepEqual(t.errors, []);
  } finally {
    await w.done();
  }
});

test('deleting an upload or an account removes its objects; nothing else removes anything', async () => {
  const w = await world();
  const t = w.server();
  try {
    const ana = await t.registerUser();
    const ben = await t.registerUser();
    const one = await uploaded(t, ana, pptx(1000));
    const two = await uploaded(t, ana, pptx(2000));
    const bens = await uploaded(t, ben, pptx(3000));
    // Somebody else's object in the same bucket: never touched.
    w.fake.objects.set('objects/sha256/ab/cd', new Uint8Array([1]));
    assert.equal(w.fake.objects.size, 4);
    await t.ok('decks.uploads.delete', { params: { uploadId: one.id }, token: ana.token });
    await until('the deleted upload object is gone', () => !w.fake.objects.has(`${PREFIX}teachers/${ana.id}/uploads/${one.id}/original`));
    await until('its record of removal is done', () => intents(t).length === 2);
    // Time passes and the background work runs many times: nothing else goes (no automatic expiry).
    t.clock.advance({ days: 400 });
    await sleep(150);
    assert.equal(w.fake.objects.size, 3);
    const back = await t.ok('auth.login', { body: { email: ana.email, password: ana.password, deviceLabel: '' } });
    const del = await t.call('account.delete', { token: back.token, body: { confirm: 'DELETE', password: ana.password } });
    assert.ok(del.ok, JSON.stringify(del.error));
    await until("the deleted account's objects are gone", () => !w.fake.objects.has(`${PREFIX}teachers/${ana.id}/uploads/${two.id}/original`));
    assert.deepEqual([...w.fake.objects.keys()].sort(), [`${PREFIX}teachers/${ben.id}/uploads/${bens.id}/original`, 'objects/sha256/ab/cd'].sort());
    const benBack = await t.ok('auth.login', { body: { email: ben.email, password: ben.password, deviceLabel: '' } });
    assert.equal(sha(await original(t, { ...ben, token: benBack.token }, bens.id)), sha(w.fake.objects.get(`${PREFIX}teachers/${ben.id}/uploads/${bens.id}/original`)!));
    assert.deepEqual(t.errors, []);
  } finally {
    await w.done();
  }
});

test('the store fails while an upload is finished: nothing is lost, nothing is left behind, finishing again works', async () => {
  const w = await world();
  const t = w.server();
  try {
    const ana = await t.registerUser();
    const file = pptx(600_000);
    const up = await upload(t, ana, file);
    // Unreachable: a plain "try again"; her pieces stay.
    w.fake.fault({ kind: 'drop', times: Infinity });
    const down = await up.finish();
    assert.deepEqual([down.status, reason(down)], [503, 'upload_storage_unavailable']);
    const again = await t.ok('decks.uploads.begin', { body: { fileName: 'Plants.pptx', bytes: file.length, sha256: sha(file) }, token: ana.token });
    assert.deepEqual([again.sessionId, again.received], [up.sessionId, [0, 1]], 'every piece she sent is still there');
    assert.ok(t.logs.some((l) => l.event === 'deck_upload_store_failed'));
    // The write landed but its answer was lost: it is removed, and removed again later in case it lands late.
    w.fake.clearFaults();
    await sleep(100);
    w.fake.fault({ kind: 'store-then-drop', method: 'PUT' });
    const lost = await up.finish();
    assert.deepEqual([lost.status, reason(lost)], [503, 'upload_storage_unavailable']);
    await until('the half-known write is removed', () => w.fake.objects.size === 0);
    assert.ok(intents(t).every((i) => i.state === 'removing' && i.uncertain === 0), 'and it waits for its second removal');
    // Read back changed: never recorded, removed.
    await sleep(100);
    w.fake.fault({ kind: 'corrupt', method: 'PUT' });
    const changed = await up.finish();
    assert.deepEqual([changed.status, reason(changed)], [503, 'upload_storage_unavailable']);
    await until('the changed write is removed', () => w.fake.objects.size === 0);
    // Then it works, from the same pieces.
    const deck = await up.finish();
    assert.ok(deck.ok, JSON.stringify(deck.error));
    assert.equal(sha(await original(t, ana, deck.data.id)), sha(file));
    // Ten minutes on, the half-known write is removed a second time and its record goes.
    t.clock.advance({ minutes: 11 });
    await until('the second removal has run', () => intents(t).length === 1);
    assert.deepEqual([...w.fake.objects.keys()], [`${PREFIX}teachers/${ana.id}/uploads/${deck.data.id}/original`]);
    assert.deepEqual(t.errors, []);
  } finally {
    await w.done();
  }
});

test('a key that ends in the middle of an upload, of a download and of a waiting delete: the renewed file is used', async () => {
  const w = await world();
  const t = w.server();
  try {
    const ana = await t.registerUser();
    const file = pptx(300_000);
    const up = await upload(t, ana, file);
    w.fake.keys.find((k) => k.accessKeyId === KEY1.accessKeyId)!.expiresAt = Date.now() - 1;
    keysFile(w.dir, KEY2);
    const deck = await up.finish();
    assert.ok(deck.ok, JSON.stringify(deck.error));
    assert.equal(sha(await original(t, ana, deck.data.id)), sha(file));
    // A delete while the store is away waits in the table; the key ends meanwhile; the renewed file removes it.
    w.fake.fault({ kind: 'drop', times: Infinity });
    await t.ok('decks.uploads.delete', { params: { uploadId: deck.data.id }, token: ana.token });
    await sleep(100);
    assert.equal(w.fake.objects.size, 1, 'still there while the store does not answer');
    assert.deepEqual(intents(t).map((i) => i.state), ['removing']);
    w.fake.keys.find((k) => k.accessKeyId === KEY2.accessKeyId)!.expiresAt = Date.now() - 1;
    w.fake.keys.find((k) => k.accessKeyId === KEY1.accessKeyId)!.expiresAt = undefined;
    keysFile(w.dir, KEY1);
    w.fake.clearFaults();
    // The removal was put off after its failure: it runs when it is due.
    t.clock.advance({ minutes: 2 });
    await until('the waiting delete has happened', () => w.fake.objects.size === 0, 6000);
    await until('and its record is gone', () => intents(t).length === 0);
    assert.deepEqual(t.errors, []);
  } finally {
    await w.done();
  }
});

test('while the store is away: downloads say "try again", the site answers, saves and deletes still work', async () => {
  const w = await world();
  const t = w.server();
  try {
    const ana = await t.registerUser();
    const deck = await uploaded(t, ana, pptx(1000));
    w.fake.fault({ kind: 'drop', times: Infinity });
    for (const route of ['decks.uploads.original', 'decks.uploads.pptx'] as const) {
      const r = await t.call(route, { params: { uploadId: deck.id }, token: ana.token });
      assert.deepEqual([r.status, reason(r)], [503, 'download_storage_unavailable'], route);
    }
    assert.equal((await t.request('GET', '/health')).status, 200);
    // Her words are records in the database: they save as ever.
    const saved = await t.ok('decks.uploads.save', { params: { uploadId: deck.id }, body: { baseRev: deck.rev, title: 'Renamed', slides: deck.edits.slides }, token: ana.token });
    assert.equal(saved.rev, deck.rev + 1);
    w.fake.clearFaults();
    await sleep(100);
    assert.equal((await t.call('decks.uploads.original', { params: { uploadId: deck.id }, token: ana.token })).status, 200);
    assert.deepEqual(t.errors, []);
  } finally {
    await w.done();
  }
});

test('an object that is not what was recorded is never sent as her file', async () => {
  const w = await world();
  const t = w.server();
  try {
    const ana = await t.registerUser();
    const big = await uploaded(t, ana, pptx(1_100_000));
    const small = await uploaded(t, ana, pptx(1000));
    for (const d of [big, small]) {
      const obj = w.fake.objects.get(`${PREFIX}teachers/${ana.id}/uploads/${d.id}/original`)!;
      obj[obj.length - 10] = obj[obj.length - 10]! ^ 0xff;
    }
    // A file of one piece: refused before anything is sent.
    const one = await t.call('decks.uploads.original', { params: { uploadId: small.id }, token: ana.token });
    assert.deepEqual([one.status, reason(one)], [503, 'original_unreadable']);
    // A file of several pieces: the answer breaks off before its last piece.
    const res = await t.request('GET', `/deck-uploads/${big.id}/original`, { token: ana.token });
    assert.equal(res.status, 200);
    let got = 0;
    let broke = false;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) got += chunk.length;
    } catch {
      broke = true;
    }
    assert.ok(broke && got < big.bytes, `cut short (${got} of ${big.bytes})`);
    const exported = await t.call('decks.uploads.pptx', { params: { uploadId: big.id }, token: ana.token });
    assert.deepEqual([exported.status, reason(exported)], [503, 'export_failed']);
    assert.ok(t.logs.filter((l) => l.event === 'deck_upload_file_damaged').length >= 2);
  } finally {
    await w.done();
  }
});

test('files kept in the database by an earlier version are moved to the bucket, checked, and only then taken out of the database', async () => {
  const w = await world();
  const dbPath = join(w.dir, 'tala.sqlite');
  try {
    // An older database: uploads stored in pieces (the module without object storage).
    const before = createTestServer({ config: { dbPath }, modules: [createDecksModule({ uploads: { renderer: null, storage: { kind: 'database' } } })] });
    const ana = await before.registerUser();
    const file = pptx(1_100_000);
    const deck = await uploaded(before, ana, file);
    const same = await uploaded(before, ana, file); // the same bytes twice: stored once, in pieces
    assert.equal(pieces(before), 3);
    before.close();
    // The same database with object storage.
    const t = w.server(dbPath);
    await until('both files are in the bucket', () => row(t, deck.id)?.object_key !== null && row(t, same.id)?.object_key !== null);
    for (const d of [deck, same]) assert.equal(sha(w.fake.objects.get(row(t, d.id)!.object_key!)!), sha(file));
    await until('their pieces are gone', () => pieces(t) === 0);
    assert.equal(sha(await original(t, ana, deck.id)), sha(file));
    assert.ok(t.logs.filter((l) => l.event === 'deck_upload_carried_over').length === 2);
    assert.deepEqual(t.errors, []);
  } finally {
    await w.done();
  }
});

test('after a restart the files are found where they were', async () => {
  const w = await world();
  const dbPath = join(w.dir, 'tala.sqlite');
  try {
    const first = w.server(dbPath);
    const ana = await first.registerUser();
    const file = pptx(700_000);
    const deck = await uploaded(first, ana, file);
    first.close();
    const second = w.server(dbPath);
    assert.equal(sha(await original(second, ana, deck.id)), sha(file));
    assert.equal(row(second, deck.id)?.object_key, `${PREFIX}teachers/${ana.id}/uploads/${deck.id}/original`);
    assert.deepEqual(second.errors, []);
  } finally {
    await w.done();
  }
});

test('nowhere private to keep files: no upload is taken, and the log says why at start', async () => {
  const t = createTestServer({ modules: [createDecksModule({ uploads: { renderer: null, storage: { kind: 'off', problems: ['TALA_R2_BUCKET is not set'] } } })] });
  try {
    const ana = await t.registerUser();
    const file = pptx(1000);
    const r = await t.call('decks.uploads.begin', { body: { fileName: 'a.pptx', bytes: file.length, sha256: sha(file) }, token: ana.token });
    assert.deepEqual([r.status, reason(r)], [503, 'uploads_off']);
    assert.equal(t.logs.find((l) => l.event === 'deck_upload_storage_off')?.fields.problems, 'TALA_R2_BUCKET is not set');
  } finally {
    t.close();
  }
});
