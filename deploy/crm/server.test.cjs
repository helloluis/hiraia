'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCrmServer, canonical } = require('./server.cjs');
const { openDatabase, migrate, migrationStatus } = require('./db.cjs');

const WRITE_KEY = `hcrm_test_${crypto.randomBytes(32).toString('base64url')}`;
const READ_KEY = `hcrm_test_${crypto.randomBytes(32).toString('base64url')}`;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-crm-test-'));

function env(extra = {}) {
  return {
    HIRAIA_CRM_PORT: '0', HIRAIA_CRM_HOST: '127.0.0.1', HIRAIA_CRM_DB_PATH: path.join(tmp, `${crypto.randomBytes(4).toString('hex')}.db`),
    HIRAIA_CRM_BACKUP_STATUS: path.join(tmp, 'nope.json'),
    HIRAIA_CRM_CLIENT_MBP_HARVESTD: `write:sha256:${sha(WRITE_KEY)}`,
    HIRAIA_CRM_CLIENT_BEANIEBOT: `read:sha256:${sha(READ_KEY)}`,
    ...extra,
  };
}

let app; let base;
const logs = [];
before(async () => {
  app = createCrmServer({ env: env(), log: (l) => logs.push(l) });
  const addr = await app.listen();
  base = `http://127.0.0.1:${addr.port}`;
});
after(async () => { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function call(method, p, { key = WRITE_KEY, body, headers = {}, https = true } = {}) {
  const h = { ...(https ? { 'x-forwarded-proto': 'https' } : {}), 'x-forwarded-for': '203.0.113.9', ...headers };
  if (key) h.authorization = `Bearer ${key}`;
  if (body !== undefined) h['content-type'] = h['content-type'] || 'application/json';
  const res = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, headers: res.headers, json };
}

test('health needs no auth; everything else needs https + a valid key', async () => {
  assert.equal((await call('GET', '/api/crm/health', { key: null })).status, 200);
  const noKey = await call('GET', '/api/crm/contacts', { key: null });
  assert.equal(noKey.status, 401);
  assert.equal(noKey.headers.get('www-authenticate'), 'Bearer realm="hiraia-crm"');
  assert.equal((await call('GET', '/api/crm/contacts', { key: 'hcrm_bogus' })).status, 401);
  assert.equal((await call('GET', '/api/crm/contacts', { key: null, headers: { authorization: 'Basic abc' } })).status, 401);
  const http = await call('GET', '/api/crm/contacts', { https: false });
  assert.equal(http.status, 403);
  assert.equal(http.json.error, 'https_required');
  assert.equal((await call('GET', '/api/crm/nope')).status, 404);
  assert.equal((await call('DELETE', '/api/crm/contacts')).status, 405);
});

test('read scope cannot write; write scope can read', async () => {
  const r = await call('POST', '/api/crm/contacts', { key: READ_KEY, body: { name: 'x', platform: 'viber' } });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'forbidden');
  assert.equal((await call('GET', '/api/crm/contacts', { key: READ_KEY })).status, 200);
  assert.equal((await call('GET', '/api/crm/contacts', { key: WRITE_KEY })).status, 200);
});

test('contact upsert by name+platform merges aliases, keeps earliest first_seen and latest last_contact', async () => {
  const c1 = await call('POST', '/api/crm/contacts', { body: { name: '  Maria   Santos ', platform: 'Messenger', role: 'Principal', school: 'DaangHari ES', stage: 'intro', aliases: ["Ma'am Santos"], first_seen: '2026-09-01T08:00:00Z', last_contact: '2026-10-01T08:00:00Z' } });
  assert.equal(c1.status, 201);
  assert.equal(c1.json.created, true);
  assert.equal(c1.json.contact.name, 'Maria Santos');
  assert.equal(c1.json.contact.platform, 'messenger');
  assert.equal(c1.json.contact.is_test, false);
  const id = c1.json.id;
  const c2 = await call('POST', '/api/crm/contacts', { body: { name: 'maria santos', platform: 'messenger', stage: 'pilot', aliases: ["ma'am santos", 'Principal Santos'], first_seen: '2026-10-05T00:00:00Z', last_contact: '2026-10-20T09:30:00+08:00', notes: 'Agreed to a pilot for 2 sections.' } });
  assert.equal(c2.status, 200);
  assert.equal(c2.json.id, id);
  assert.equal(c2.json.created, false);
  assert.equal(c2.json.changed, true);
  assert.deepEqual(c2.json.contact.aliases, ["Ma'am Santos", 'Principal Santos']);
  assert.equal(c2.json.contact.first_seen, '2026-09-01T08:00:00.000Z');
  assert.equal(c2.json.contact.last_contact, '2026-10-20T01:30:00.000Z');
  assert.equal(c2.json.contact.stage, 'pilot');
  assert.equal(c2.json.contact.role, 'Principal');     // untouched fields survive
  const c3 = await call('POST', '/api/crm/contacts', { body: { name: 'maria santos', platform: 'messenger' } });
  assert.equal(c3.status, 200);
  assert.equal(c3.json.changed, false);           // identical resend is a no-op
  const recased = await call('POST', '/api/crm/contacts', { body: { name: 'Maria Santos', platform: 'messenger' } });
  assert.equal(recased.json.changed, true);        // the latest display-name casing wins
  assert.equal(recased.json.contact.name, 'Maria Santos');
  const cleared = await call('POST', '/api/crm/contacts', { body: { name: 'Maria Santos', platform: 'messenger', role: '' } });
  assert.equal(cleared.json.contact.role, null);
});

test('validation errors are 400 with a field pointer', async () => {
  for (const [body, code] of [
    [{ platform: 'viber' }, 'missing_field'],
    [{ name: 'A', platform: 'Viber!' }, 'invalid_field'],
    [{ name: 'A', platform: 'viber', stage: 'won' }, 'invalid_field'],
    [{ name: 'A', platform: 'viber', last_contact: 'yesterday' }, 'invalid_timestamp'],
    [{ name: 'A', platform: 'viber', aliases: 'x' }, 'invalid_field'],
    [{ name: 'A'.repeat(201), platform: 'viber' }, 'field_too_long'],
  ]) {
    const r = await call('POST', '/api/crm/contacts', { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error, code);
  }
  assert.equal((await call('POST', '/api/crm/contacts', { body: '[1,2]' })).json.error, 'invalid_json');
  assert.equal((await call('POST', '/api/crm/contacts', { body: '{bad' })).json.error, 'invalid_json');
  assert.equal((await call('POST', '/api/crm/contacts', { body: 'x', headers: { 'content-type': 'text/plain' } })).status, 415);
  const badKey = await call('POST', '/api/crm/contacts', { body: { name: 'A', platform: 'viber' }, headers: { 'idempotency-key': 'has space' } });
  assert.equal(badKey.json.error, 'invalid_idempotency_key');
});

test('Idempotency-Key replays the stored response and never double-writes', async () => {
  const contact = await call('POST', '/api/crm/contacts', { body: { name: 'Jose Cruz', platform: 'viber' } });
  const cid = contact.json.id;
  const body = { contact_id: cid, source_thread: 'viber:Jose Cruz', extracted_json: { summary: 'Asked for the APK link', intent: 'pilot-interest' }, model_version: 'harvestd-v1' };
  const h = { 'idempotency-key': 'extract-0001' };
  const a = await call('POST', '/api/crm/extracts', { body, headers: h });
  assert.equal(a.status, 201);
  assert.equal(a.headers.get('idempotent-replayed'), null);
  const reordered = { model_version: 'harvestd-v1', extracted_json: { intent: 'pilot-interest', summary: 'Asked for the APK link' }, source_thread: 'viber:Jose Cruz', contact_id: cid };
  const b = await call('POST', '/api/crm/extracts', { body: reordered, headers: h });
  assert.equal(b.status, 201);
  assert.equal(b.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(b.json, a.json);
  const list = await call('GET', `/api/crm/extracts?contact_id=${cid}`);
  assert.equal(list.json.total, 1);
  const reused = await call('POST', '/api/crm/extracts', { body: { ...body, model_version: 'harvestd-v2' }, headers: h });
  assert.equal(reused.status, 422);
  assert.equal(reused.json.error, 'idempotency_key_reused');
  // the same key is scoped per client
  const other = await call('POST', '/api/crm/extracts', { body, headers: h, key: READ_KEY });
  assert.equal(other.status, 403);
  const events = app.db.prepare('SELECT action, idempotency_key FROM events WHERE entity = ? OR action = ? ORDER BY id').all('extracts', 'replayed');
  assert.deepEqual(events.map((e) => e.action), ['appended', 'replayed']);
  assert.equal(events[0].idempotency_key, 'extract-0001');
  assert.equal(canonical({ b: 1, a: [{ d: 1, c: 2 }] }), '{"a":[{"c":2,"d":1}],"b":1}');
});

test('threads upsert and extracts reference existing contacts/threads', async () => {
  const contact = await call('POST', '/api/crm/contacts', { body: { name: 'Ana Reyes', platform: 'messenger' } });
  const cid = contact.json.id;
  const t1 = await call('POST', '/api/crm/threads', { body: { contact_id: cid, app: 'Messenger', thread_name: 'Ana Reyes', last_seen: '2026-10-10T00:00:00Z' } });
  assert.equal(t1.status, 201);
  const t2 = await call('POST', '/api/crm/threads', { body: { contact_id: cid, app: 'messenger', thread_name: 'ana reyes', last_seen: '2026-10-01T00:00:00Z' } });
  assert.equal(t2.status, 200);
  assert.equal(t2.json.id, t1.json.id);
  assert.equal(t2.json.thread.last_seen, '2026-10-10T00:00:00.000Z');   // monotonic
  assert.equal((await call('POST', '/api/crm/threads', { body: { contact_id: 999999, app: 'viber', thread_name: 'x' } })).status, 422);
  const wrongThread = await call('POST', '/api/crm/extracts', { body: { contact_id: cid, thread_id: 999999, extracted_json: {} } });
  assert.equal(wrongThread.status, 422);
  assert.equal(wrongThread.json.error, 'unknown_thread');
  const ok = await call('POST', '/api/crm/extracts', { body: { contact_id: cid, thread_id: t1.json.id, extracted_json: { summary: 'Will ask the division office' } } });
  assert.equal(ok.status, 201);
  assert.equal((await call('POST', '/api/crm/extracts', { body: { contact_id: cid, extracted_json: 'nope' } })).status, 400);
  const got = await call('GET', `/api/crm/contacts/${cid}`, { key: READ_KEY });
  assert.equal(got.status, 200);
  assert.equal(got.json.threads.length, 1);
  assert.equal(got.json.extracts.length, 1);
  assert.deepEqual(got.json.extracts[0].extracted_json, { summary: 'Will ask the division office' });
  assert.equal((await call('GET', '/api/crm/contacts/424242', { key: READ_KEY })).status, 404);
});

test('list filters: stage, platform, quiet_for_days, search, include_test', async () => {
  const now = Date.now();
  const iso = (daysAgo) => new Date(now - daysAgo * 86400_000).toISOString();
  await call('POST', '/api/crm/contacts', { body: { name: 'Quiet Teacher', platform: 'viber', stage: 'dormant', school: 'Smokey Mountain ES', last_contact: iso(45) } });
  await call('POST', '/api/crm/contacts', { body: { name: 'Active Teacher', platform: 'viber', stage: 'active', aliases: ['Sir Dan'], last_contact: iso(2) } });
  await call('POST', '/api/crm/contacts', { body: { name: 'Never Contacted', platform: 'messenger', stage: 'unknown' } });
  await call('POST', '/api/crm/contacts', { body: { name: 'ZZ Smoke Test', platform: 'test', is_test: true, notes: 'synthetic' } });
  const all = await call('GET', '/api/crm/contacts?limit=200', { key: READ_KEY });
  assert.ok(all.json.contacts.every((c) => !c.is_test));
  assert.equal(all.json.total, all.json.contacts.length);
  const withTest = await call('GET', '/api/crm/contacts?include_test=1&search=zz%20smoke', { key: READ_KEY });
  assert.equal(withTest.json.total, 1);
  assert.equal(withTest.json.contacts[0].is_test, true);
  const dormant = await call('GET', '/api/crm/contacts?stage=dormant', { key: READ_KEY });
  assert.deepEqual(dormant.json.contacts.map((c) => c.name), ['Quiet Teacher']);
  const viber = await call('GET', '/api/crm/contacts?platform=viber', { key: READ_KEY });
  assert.deepEqual(viber.json.contacts.map((c) => c.name).sort(), ['Active Teacher', 'Jose Cruz', 'Quiet Teacher']);
  const quiet = await call('GET', '/api/crm/contacts?quiet_for_days=30', { key: READ_KEY });
  const names = quiet.json.contacts.map((c) => c.name);
  assert.ok(names.includes('Quiet Teacher') && names.includes('Never Contacted') && !names.includes('Active Teacher'));
  const alias = await call('GET', '/api/crm/contacts?search=sir%20dan', { key: READ_KEY });
  assert.deepEqual(alias.json.contacts.map((c) => c.name), ['Active Teacher']);
  const school = await call('GET', '/api/crm/contacts?search=smokey', { key: READ_KEY });
  assert.deepEqual(school.json.contacts.map((c) => c.name), ['Quiet Teacher']);
  assert.equal((await call('GET', '/api/crm/contacts?search=100%25', { key: READ_KEY })).json.total, 0);   // LIKE wildcard escaped
  assert.equal((await call('GET', '/api/crm/contacts?stage=won', { key: READ_KEY })).status, 400);
  assert.equal((await call('GET', '/api/crm/contacts?limit=5000', { key: READ_KEY })).status, 400);
  // newest last_contact first, never-contacted last
  assert.equal(all.json.contacts[0].name, 'Active Teacher');
  assert.equal(all.json.contacts.at(-1).last_contact, null);
  assert.equal(typeof all.json.contacts[0].thread_count, 'number');
});

test('status reports counts and an unconfigured backup as stale', async () => {
  const s = await call('GET', '/api/crm/status', { key: READ_KEY });
  assert.equal(s.status, 200);
  assert.ok(s.json.counts.contacts >= 4);
  assert.equal(s.json.backup.stale, true);
  assert.equal(s.json.migrations, 1);
  assert.equal(logs.at(-1).client, 'beaniebot');
  assert.ok(!JSON.stringify(logs).includes(READ_KEY) && !JSON.stringify(logs).includes(WRITE_KEY));
});

test('events table is append-only at the SQL level', () => {
  assert.throws(() => app.db.prepare('UPDATE events SET action = ? WHERE id = 1').run('x'), /append-only/);
  assert.throws(() => app.db.prepare('DELETE FROM events').run(), /append-only/);
});

test('migrations are idempotent and survive lost bookkeeping', () => {
  const db = openDatabase(path.join(tmp, 'migrate.db'));
  assert.deepEqual(migrate(db), ['001-init.sql']);
  assert.deepEqual(migrate(db), []);
  assert.ok(migrationStatus(db).every((m) => m.applied_at));
  db.exec('DROP TABLE schema_migrations');
  assert.deepEqual(migrate(db), ['001-init.sql']);   // IF NOT EXISTS everywhere
  db.close();
});

test('payload cap and per-client rate limit', async (t) => {
  const small = createCrmServer({ env: env({ HIRAIA_CRM_MAX_BODY: '512', HIRAIA_CRM_RATE_BURST: '3', HIRAIA_CRM_RATE_PER_MINUTE: '1' }), log: () => {} });
  t.after(() => small.close());
  const addr = await small.listen();
  const b = `http://127.0.0.1:${addr.port}`;
  const h = { 'x-forwarded-proto': 'https', authorization: `Bearer ${WRITE_KEY}`, 'content-type': 'application/json' };
  const big = await fetch(`${b}/api/crm/contacts`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'x', platform: 'viber', notes: 'n'.repeat(600) }) });
  assert.equal(big.status, 413);
  const statuses = [];
  for (let i = 0; i < 3; i += 1) statuses.push((await fetch(`${b}/api/crm/contacts`, { headers: h })).status);
  assert.deepEqual(statuses, [200, 200, 429]);  // burst 3 = the 413 request + two GETs, then throttled
  const limited = await fetch(`${b}/api/crm/contacts`, { headers: h });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});
