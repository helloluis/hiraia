'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCrmServer, canonical, CrmStore } = require('./server.cjs');
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
    // The whole suite shares one client key; the rate-limit test sets its own tight limits.
    HIRAIA_CRM_RATE_BURST: '5000', HIRAIA_CRM_RATE_PER_MINUTE: '60000',
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

test('list include embeds every thread (all apps) and the latest extract in one read', async () => {
  const multi = (await call('POST', '/api/crm/contacts', { body: { name: 'Embed Multi Channel', platform: 'messenger', last_contact: '2026-10-30T02:00:00Z' } })).json.id;
  const bare = (await call('POST', '/api/crm/contacts', { body: { name: 'Embed Bare Member', platform: 'telegram' } })).json.id;
  const direct = (await call('POST', '/api/crm/threads', { body: { contact_id: multi, app: 'messenger', thread_name: 'Embed Multi Channel', last_seen: '2026-10-30T02:00:00Z' } })).json.id;
  const group = (await call('POST', '/api/crm/threads', { body: { contact_id: multi, app: 'viber', thread_name: 'Group 9f2c41d07a', last_seen: '2026-11-02T05:00:00Z' } })).json.id;
  const undated = (await call('POST', '/api/crm/threads', { body: { contact_id: multi, app: 'telegram', thread_name: 'Embed Multi Channel' } })).json.id;
  await call('POST', '/api/crm/extracts', { body: { contact_id: multi, thread_id: direct, extracted_json: { summary: 'older', next_action: null } } });
  const newest = (await call('POST', '/api/crm/extracts', { body: { contact_id: multi, thread_id: group, extracted_json: { summary: 'newer', next_action: 'send the consent form', last_contact_approximate: true } } })).json.id;

  // Without include the list shape is unchanged.
  const plain = await call('GET', '/api/crm/contacts?search=embed', { key: READ_KEY });
  assert.equal(plain.json.total, 2);
  assert.ok(plain.json.contacts.every((c) => !('threads' in c) && !('latest_extract' in c)));

  for (const query of ['include=threads,latest_extract', 'include=threads&include=LATEST_EXTRACT', 'include=latest_extract,%20threads']) {
    const r = await call('GET', `/api/crm/contacts?search=embed&${query}`, { key: READ_KEY });
    assert.equal(r.status, 200, query);
    const byId = new Map(r.json.contacts.map((c) => [c.id, c]));
    const m = byId.get(multi);
    // Same order as GET /contacts/:id: last_seen DESC NULLS LAST, then id.
    assert.deepEqual(m.threads.map((t) => [t.id, t.app]), [[group, 'viber'], [direct, 'messenger'], [undated, 'telegram']]);
    assert.equal(m.thread_count, 3);
    assert.equal(m.latest_extract.id, newest);
    assert.deepEqual(m.latest_extract.extracted_json, { summary: 'newer', next_action: 'send the consent form', last_contact_approximate: true });
    const detail = await call('GET', `/api/crm/contacts/${multi}?extracts_limit=1`, { key: READ_KEY });
    assert.deepEqual(m.threads, detail.json.threads);
    assert.deepEqual(m.latest_extract, detail.json.extracts[0]);
    assert.deepEqual(byId.get(bare).threads, []);
    assert.equal(byId.get(bare).latest_extract, null);
  }

  // Only one embed was asked for: only that key appears.
  const threadsOnly = await call('GET', '/api/crm/contacts?search=embed&include=threads', { key: READ_KEY });
  assert.ok(threadsOnly.json.contacts.every((c) => Array.isArray(c.threads) && !('latest_extract' in c)));
  // Embeds follow the filtered page, not the whole table.
  const page = await call('GET', '/api/crm/contacts?search=embed&platform=telegram&include=threads,latest_extract&limit=1', { key: READ_KEY });
  assert.deepEqual(page.json.contacts.map((c) => [c.id, c.threads.length, c.latest_extract]), [[bare, 0, null]]);
  const empty = await call('GET', '/api/crm/contacts?search=no-such-contact-xyz&include=threads,latest_extract', { key: READ_KEY });
  assert.deepEqual([empty.status, empty.json.contacts, empty.json.total], [200, [], 0]);
  const unknown = await call('GET', '/api/crm/contacts?include=threads,raw_messages', { key: READ_KEY });
  assert.equal(unknown.status, 400);
  assert.deepEqual([unknown.json.error, unknown.json.details], ['invalid_query', { param: 'include' }]);
});

test('status reports counts and an unconfigured backup as stale', async () => {
  const s = await call('GET', '/api/crm/status', { key: READ_KEY });
  assert.equal(s.status, 200);
  assert.ok(s.json.counts.contacts >= 4);
  assert.equal(s.json.backup.stale, true);
  assert.equal(s.json.migrations, 2);
  for (const t of ['contact_profiles', 'contact_points', 'first_message_evidence']) assert.equal(typeof s.json.counts[t], 'number', t);
  assert.equal(logs.at(-1).client, 'beaniebot');
  assert.ok(!JSON.stringify(logs).includes(READ_KEY) && !JSON.stringify(logs).includes(WRITE_KEY));
});

test('events table is append-only at the SQL level', () => {
  assert.throws(() => app.db.prepare('UPDATE events SET action = ? WHERE id = 1').run('x'), /append-only/);
  assert.throws(() => app.db.prepare('DELETE FROM events').run(), /append-only/);
});

test('migrations are idempotent and survive lost bookkeeping', () => {
  const db = openDatabase(path.join(tmp, 'migrate.db'));
  assert.deepEqual(migrate(db), ['001-init.sql', '002-contact-profile.sql']);
  assert.deepEqual(migrate(db), []);
  assert.ok(migrationStatus(db).every((m) => m.applied_at));
  db.exec('DROP TABLE schema_migrations');
  assert.deepEqual(migrate(db), ['001-init.sql', '002-contact-profile.sql']);   // IF NOT EXISTS everywhere
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

// ---------------------------------------------------------------------------------------------
// 1.2.0: contact profile, phones/e-mails and first-message evidence

test('a populated 1.1.0 database upgrades in place: rows kept, new fields empty, old shapes intact', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'v1-migrations-'));
  fs.copyFileSync(path.join(__dirname, 'migrations', '001-init.sql'), path.join(dir, '001-init.sql'));
  const file = path.join(tmp, 'upgrade.db');
  const db = openDatabase(file);
  assert.deepEqual(migrate(db, dir), ['001-init.sql']);
  db.prepare(`INSERT INTO contacts (name, platform, aliases_json, role, school, stage, notes, last_contact, first_seen, created_at, updated_at)
              VALUES ('Old Row', 'viber', '[]', 'Principal', 'Old School', 'pilot', 'note', '2026-10-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 'x', 'x')`).run();
  assert.deepEqual(migrate(db), ['002-contact-profile.sql']);
  const store = new CrmStore(db);
  const view = store.contactView(1);
  assert.deepEqual([view.name, view.role, view.school, view.stage, view.last_contact], ['Old Row', 'Principal', 'Old School', 'pilot', '2026-10-01T00:00:00.000Z']);
  // Nothing is derived from first_seen, last_contact or created_at: no message evidence, no first contact.
  assert.deepEqual([view.organization, view.job_title, view.first_contact, view.first_contact_quality], [null, null, null, null]);
  assert.ok(!('phones' in view) && !('emails' in view));
  db.close();
});

test('old payloads still work; new fields are additive and phones/e-mails are opt-in', async () => {
  const created = await call('POST', '/api/crm/contacts', { body: { name: 'Compat Person', platform: 'messenger', role: 'teacher', notes: 'n' } });
  assert.equal(created.status, 201);
  const c = created.json.contact;
  for (const k of ['organization', 'organization_source', 'department', 'job_title', 'location', 'first_contact', 'first_contact_quality', 'first_contact_basis', 'first_contact_platform']) {
    assert.equal(c[k], null, k);
  }
  assert.ok(!('phones' in c));
  const list = await call('GET', '/api/crm/contacts?search=compat%20person', { key: READ_KEY });
  assert.ok(list.json.contacts.every((x) => !('phones' in x) && !('emails' in x) && x.organization === null));
  const withPoints = await call('GET', '/api/crm/contacts?search=compat%20person&include=contact_points', { key: READ_KEY });
  assert.deepEqual([withPoints.json.contacts[0].phones, withPoints.json.contacts[0].emails], [[], []]);
  const detail = await call('GET', `/api/crm/contacts/${created.json.id}`, { key: READ_KEY });
  assert.ok(!('phones' in detail.json.contact));
  const detailPoints = await call('GET', `/api/crm/contacts/${created.json.id}?include=contact_points`, { key: READ_KEY });
  assert.deepEqual(detailPoints.json.contact.phones, []);
  assert.equal((await call('GET', `/api/crm/contacts/${created.json.id}?include=threads`, { key: READ_KEY })).status, 400);
});

test('profile fields round-trip with provenance; absent leaves, empty clears, school and role stay separate', async () => {
  const body = { name: 'Profile Person', platform: 'viber', role: 'teacher', school: 'Some ES' };
  const a = await call('POST', '/api/crm/contacts', { body: { ...body, organization: 'Department of Education (DepEd)', organization_source: 'manual_note', job_title: 'Master Teacher II', location: 'Siay, Zamboanga Sibugay' } });
  const c = a.json.contact;
  assert.deepEqual([c.organization, c.organization_source, c.job_title, c.job_title_source, c.location_source, c.school, c.role],
    ['Department of Education (DepEd)', 'manual_note', 'Master Teacher II', 'mbp-harvestd', 'mbp-harvestd', 'Some ES', 'teacher']);
  const same = await call('POST', '/api/crm/contacts', { body: { ...body, organization: 'Department of Education (DepEd)' } });
  assert.equal(same.json.changed, false);                                   // same value, no source: keeps manual_note
  assert.equal(same.json.contact.organization_source, 'manual_note');
  const untouched = await call('POST', '/api/crm/contacts', { body });
  assert.equal(untouched.json.contact.job_title, 'Master Teacher II');      // absent fields are left alone
  const cleared = await call('POST', '/api/crm/contacts', { body: { ...body, location: '', department: 'Curriculum Implementation Division', department_source: 'google_contacts' } });
  assert.deepEqual([cleared.json.contact.location, cleared.json.contact.location_source, cleared.json.contact.department_source], [null, null, 'google_contacts']);
  for (const [extra, code] of [[{ organization_source: 'manual_note' }, 'invalid_field'], [{ organization: 'x', organization_source: 'Not A Source!' }, 'invalid_field'], [{ job_title: 'x'.repeat(201) }, 'field_too_long']]) {
    const r = await call('POST', '/api/crm/contacts', { body: { ...body, ...extra } });
    assert.deepEqual([r.status, r.json.error], [400, code], JSON.stringify(extra));
  }
  const byOrg = await call('GET', '/api/crm/contacts?search=deped', { key: READ_KEY });
  assert.ok(byOrg.json.contacts.some((x) => x.name === 'Profile Person'));
  assert.equal((await call('GET', '/api/crm/contacts?search=curriculum%20implementation', { key: READ_KEY })).json.total, 1);
});

test('phones and e-mails: several per contact, normalized, deduplicated, labelled, primary, removable', async () => {
  const base = { name: 'Points Person', platform: 'messenger' };
  const a = await call('POST', '/api/crm/contacts', { body: { ...base,
    phones: [{ value: '+63 900 000 0001', label: 'mobile', primary: true, source: 'google_contacts', source_ref: 'people/c1' }, '0063-900-000-0002', '(0900) 000.0003'],
    emails: [{ value: ' Teacher@Example.ORG ', label: 'work' }] } });
  assert.equal(a.status, 201);
  assert.deepEqual(a.json.contact.phones.map((p) => [p.value, p.label, p.primary, p.source]),
    [['+639000000001', 'mobile', true, 'google_contacts'], ['+639000000002', null, false, 'mbp-harvestd'], ['09000000003', null, false, 'mbp-harvestd']]);
  assert.deepEqual(a.json.contact.emails.map((e) => e.value), ['teacher@example.org']);
  const again = await call('POST', '/api/crm/contacts', { body: { ...base, phones: ['+639000000001'], emails: ['teacher@example.org'] } });
  assert.equal(again.json.changed, false);                                  // dedupe by normalized value
  const promote = await call('POST', '/api/crm/contacts', { body: { ...base, phones: [{ value: '09000000003', primary: true }] } });
  assert.deepEqual(promote.json.contact.phones.filter((p) => p.primary).map((p) => p.value), ['09000000003']);
  const removed = await call('POST', '/api/crm/contacts', { body: { ...base, phones: [{ value: '+639000000002', remove: true }] } });
  assert.deepEqual(removed.json.contact.phones.map((p) => p.value).sort(), ['+639000000001', '09000000003']);
  for (const bad of [{ phones: ['12'] }, { phones: ['call me'] }, { emails: ['not-an-email'] }, { phones: 'x' }, { phones: Array.from({ length: 21 }, (_, i) => `+6390000000${10 + i}`) }]) {
    assert.equal((await call('POST', '/api/crm/contacts', { body: { ...base, ...bad } })).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  const listed = await call('GET', '/api/crm/contacts?search=points%20person&include=contact_points', { key: READ_KEY });
  assert.equal(listed.json.contacts[0].phones.length, 2);
});

test('first-message evidence: earliest across threads and platforms, monotonic, exact vs approximate', async () => {
  const cid = (await call('POST', '/api/crm/contacts', { body: { name: 'Evidence Person', platform: 'messenger', last_contact: '2026-11-01T00:00:00Z' } })).json.id;
  const otherCid = (await call('POST', '/api/crm/contacts', { body: { name: 'Evidence Other', platform: 'messenger' } })).json.id;
  const tM = (await call('POST', '/api/crm/threads', { body: { contact_id: cid, app: 'messenger', thread_name: 'Evidence Person' } })).json.id;
  const tT = (await call('POST', '/api/crm/threads', { body: { contact_id: cid, app: 'telegram', thread_name: 'Evidence Person' } })).json.id;
  const tOther = (await call('POST', '/api/crm/threads', { body: { contact_id: otherCid, app: 'messenger', thread_name: 'Evidence Other' } })).json.id;
  const ev = (over) => ({ contact_id: cid, evidence_key: 'conv-m', platform: 'messenger', conversation_kind: 'direct', first_message_at: '2026-10-12T07:45:00Z', quality: 'exact', basis: 'message_timestamp', direction: 'incoming', ...over });
  const post = (over, headers) => call('POST', '/api/crm/first-message-evidence', { body: ev(over), headers });

  // No evidence yet: first_contact stays empty although last_contact and created_at exist.
  assert.equal((await call('GET', `/api/crm/contacts/${cid}`, { key: READ_KEY })).json.contact.first_contact, null);

  const first = await post({ thread_id: tM });
  assert.deepEqual([first.status, first.json.action, first.json.first_contact.at, first.json.first_contact.quality], [201, 'created', '2026-10-12T07:45:00.000Z', 'exact']);
  const later = await post({ first_message_at: '2026-10-20T00:00:00Z' });
  assert.deepEqual([later.status, later.json.changed, later.json.evidence.first_message_at], [200, false, '2026-10-12T07:45:00.000Z']);
  const weakerSame = await post({ quality: 'approximate', basis: 'first_observed' });
  assert.equal(weakerSame.json.changed, false);                             // never weakened at the same instant

  // A second platform: Telegram OCR with only an observation time, earlier than the Messenger exact time.
  const tg = await post({ evidence_key: 'conv-t', platform: 'telegram', thread_id: tT, first_message_at: '2026-10-05T03:00:00Z', quality: 'approximate', basis: 'first_observed', direction: 'unknown' });
  assert.deepEqual([tg.json.first_contact.at, tg.json.first_contact.quality, tg.json.first_contact.basis, tg.json.first_contact.platform, tg.json.first_contact.thread_id],
    ['2026-10-05T03:00:00.000Z', 'approximate', 'first_observed', 'telegram', tT]);
  // An exact timestamp at the same instant outranks the approximate one.
  const exactSame = await post({ evidence_key: 'conv-t', platform: 'telegram', thread_id: tT, first_message_at: '2026-10-05T03:00:00Z' });
  assert.deepEqual([exactSame.json.action, exactSame.json.first_contact.quality, exactSame.json.first_contact.basis], ['updated', 'exact', 'message_timestamp']);
  // An earlier report on the Messenger conversation moves the contact earlier, even if approximate.
  const earlier = await post({ first_message_at: '2026-09-30T23:00:00Z', quality: 'approximate', basis: 'relative_label' });
  assert.deepEqual([earlier.json.action, earlier.json.first_contact.at, earlier.json.first_contact.basis, earlier.json.first_contact.thread_id],
    ['updated', '2026-09-30T23:00:00.000Z', 'relative_label', tM]);

  // Evidence without a CRM thread (a linked conversation that was never exported) still counts.
  const unthreaded = await post({ evidence_key: 'conv-local', platform: 'viber', first_message_at: '2026-09-29T00:00:00Z' });
  assert.deepEqual([unthreaded.json.first_contact.platform, unthreaded.json.first_contact.thread_id], ['viber', null]);

  // Thread views carry their own earliest message; the contact view carries the minimum across all.
  const detail = await call('GET', `/api/crm/contacts/${cid}`, { key: READ_KEY });
  const byThread = Object.fromEntries(detail.json.threads.map((t) => [t.app, [t.first_message_at, t.first_message_quality, t.first_message_basis]]));
  assert.deepEqual(byThread, { messenger: ['2026-09-30T23:00:00.000Z', 'approximate', 'relative_label'], telegram: ['2026-10-05T03:00:00.000Z', 'exact', 'message_timestamp'] });
  assert.equal(detail.json.contact.first_contact, '2026-09-29T00:00:00.000Z');
  const listed = await call('GET', '/api/crm/contacts?search=evidence%20person&include=threads', { key: READ_KEY });
  assert.equal(listed.json.contacts[0].first_contact_platform, 'viber');

  // Relinking evidence to a thread that was exported later does not touch its time.
  const relink = await post({ evidence_key: 'conv-local', platform: 'viber', thread_id: tM, first_message_at: '2026-10-25T00:00:00Z' });
  assert.deepEqual([relink.json.action, relink.json.evidence.first_message_at, relink.json.evidence.thread_id], ['relinked', '2026-09-29T00:00:00.000Z', tM]);

  // Idempotent replays and every validation edge.
  const k = { 'idempotency-key': 'fme-replay-1' };
  const r1 = await post({ evidence_key: 'conv-replay', first_message_at: '2026-10-01T00:00:00Z' }, k);
  const r2 = await post({ evidence_key: 'conv-replay', first_message_at: '2026-10-01T00:00:00Z' }, k);
  assert.deepEqual([r2.headers.get('idempotent-replayed'), r2.json.id], ['true', r1.json.id]);
  const cases = [
    [{ quality: 'exact', basis: 'relative_label' }, 400, 'invalid_field'],
    [{ first_message_at: '2003-12-31T00:00:00Z' }, 400, 'invalid_timestamp'],
    [{ first_message_at: new Date(Date.now() + 3 * 86400_000).toISOString() }, 400, 'invalid_timestamp'],
    [{ first_message_at: 'Wednesday 9:41am' }, 400, 'invalid_timestamp'],
    [{ first_message_at: undefined }, 400, 'missing_field'],
    [{ quality: 'certain' }, 400, 'invalid_field'],
    [{ conversation_kind: 'channel' }, 400, 'invalid_field'],
    [{ evidence_key: 'has space' }, 400, 'invalid_field'],
    [{ thread_id: tOther }, 422, 'unknown_thread'],
    [{ contact_id: 999999 }, 422, 'unknown_contact'],
    [{ platform: 'viber' }, 422, 'evidence_conflict'],
  ];
  for (const [over, status, code] of cases) {
    const r = await post(over);
    assert.deepEqual([r.status, r.json.error], [status, code], JSON.stringify(over));
  }
  assert.equal((await call('POST', '/api/crm/first-message-evidence', { key: READ_KEY, body: ev({}) })).status, 403);
  const audit = app.db.prepare("SELECT action FROM events WHERE entity = 'first_message_evidence' ORDER BY id").all().map((e) => e.action);
  assert.ok(audit.includes('created') && audit.includes('updated') && audit.includes('relinked') && audit.includes('unchanged'));
});
