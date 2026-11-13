import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRecordData } from '@hiraia/tala-core';
import type { EntityName, Mutation, RecordData } from '@hiraia/tala-core';
import type { ExtendedModule } from '../../kernel/auth';
import { HttpError } from '../../kernel/types';
import { createTestServer } from '../../testing';
import type { TestServer } from '../../testing';

let counter = 0;
const upsert = <E extends EntityName>(entity: E, data: RecordData<E>, baseRev = 0): Mutation => ({
  mutationId: `mutation-a-${String(++counter).padStart(6, '0')}`,
  entity,
  id: data.id,
  op: 'upsert',
  baseRev,
  data,
});
const push = async (t: TestServer, token: string, mutations: Mutation[]) => (await t.ok('sync.push', { token, body: { deviceId: 'device-0001', mutations } })).results;

const note = (id: string, text: string) => parseRecordData('day_note', { id, classId: 'class-0001', date: '2026-11-16', text });
const plan = (id: string) => parseRecordData('plan', { id, templateId: 'tpl.dlp.v1', language: 'fil', grades: ['4'], durationMinutes: 50 });
const check = (id: string, competencyId: string, status: 'confirmed' | 'corrected', curriculumVersion = 'matatag-2024') =>
  parseRecordData('competency_check', { id, competencyId, curriculumVersion, status });

test('account.export returns everything the teacher owns, and only that (AUTH-6)', async () => {
  const t = createTestServer();
  const maria = await t.registerUser({ email: 'maria@example.test' });
  const jose = await t.registerUser();
  await push(t, maria.token, [upsert('day_note', note('note-0001', 'kept')), upsert('day_note', note('note-0002', 'to delete')), upsert('plan', plan('plan-0001'))]);
  await push(t, maria.token, [{ mutationId: 'mutation-a-delete-1', entity: 'day_note', id: 'note-0002', op: 'delete', baseRev: 1 }]);
  await push(t, jose.token, [upsert('day_note', note('note-0001', 'Jose’s own'))]);

  const exported = await t.ok('account.export', { token: maria.token });
  assert.equal(exported.exportedAt, t.clock.now().toISOString());
  assert.equal(exported.user.email, 'maria@example.test');
  const mine = exported.records.filter((r) => r.entity !== 'profile');
  assert.deepEqual(mine.map((r) => `${r.entity}:${r.id}`).sort(), ['day_note:note-0001', 'plan:plan-0001']);
  assert.ok(mine.every((r) => r.deletedAt === null), 'deleted records are not part of an export');
  assert.ok(!JSON.stringify(exported).includes('Jose'));
  assert.ok(!('password_hash' in exported.user) && !JSON.stringify(exported).includes('argon2'));
  assert.equal((await t.call('account.export')).status, 401);
  t.close();
});

test('deleting an account needs the password, removes everything, and signs the other devices out with the reason', async () => {
  const cleaned: string[] = [];
  const other: ExtendedModule = {
    name: 'probe',
    migrations: [{ id: 'probe:001_init', sql: 'CREATE TABLE probe_jobs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL) STRICT;' }],
    handlers: {},
    kernel: {
      onAccountDeleted: (deps, userId) => {
        deps.db.prepare('DELETE FROM probe_jobs WHERE user_id = ?').run(userId);
        cleaned.push(userId);
      },
    },
  };
  const t = createTestServer({ modules: [other] });
  const maria = await t.registerUser({ email: 'maria@example.test', password: 'kalabaw-bituin-ilog-27' });
  const jose = await t.registerUser({ email: 'jose@example.test' });
  const mariaLaptop = await t.ok('auth.login', { body: { email: 'maria@example.test', password: 'kalabaw-bituin-ilog-27' } });
  await push(t, maria.token, [upsert('day_note', note('note-0001', 'Maria’s')), upsert('plan', plan('plan-0001')), upsert('student', parseRecordData('student', { id: 'student-0001', classId: 'class-0001', displayName: 'Ana Reyes' }))]);
  await push(t, jose.token, [upsert('day_note', note('note-0001', 'Jose’s'))]);
  t.db.prepare('INSERT INTO probe_jobs (id, user_id) VALUES (?, ?), (?, ?)').run('job-1', maria.id, 'job-2', jose.id);
  await t.ok('auth.requestReset', { body: { email: 'maria@example.test' } });

  // The literal word and the right password are both required.
  assert.equal((await t.call('account.delete', { token: maria.token, body: { confirm: 'delete' as never, password: 'kalabaw-bituin-ilog-27' } })).status, 400);
  const wrong = await t.call('account.delete', { token: maria.token, body: { confirm: 'DELETE', password: 'not-the-password-1' } });
  assert.equal(wrong.status, 403);
  assert.deepEqual(wrong.error?.details, { reason: 'wrong_password' });
  assert.equal((await t.call('account.delete', { token: maria.token, body: { confirm: 'DELETE' } })).status, 403);
  assert.equal((await t.call('auth.me', { token: maria.token })).ok, true, 'nothing was deleted by the failed tries');

  const done = await t.call('account.delete', { token: maria.token, body: { confirm: 'DELETE', password: 'kalabaw-bituin-ilog-27' } });
  assert.equal(done.ok, true);
  assert.match(done.headers.get('set-cookie')!, /Max-Age=0/);
  assert.deepEqual(cleaned, [maria.id], 'other modules were asked to remove what they hold for her');

  // Every table: nothing of Maria's is left, and Jose's data is untouched.
  const tables = (t.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((r) => r.name);
  const dump = tables.map((name) => JSON.stringify(t.db.prepare(`SELECT * FROM ${name}`).all())).join('\n');
  for (const piece of [maria.id, 'maria@example.test', 'Maria', 'Ana Reyes', 'job-1']) assert.ok(!dump.includes(piece), `${piece} is still stored`);
  assert.equal(t.services.records.get(jose.id, 'day_note', 'note-0001')!.data.text, 'Jose’s');
  assert.equal((t.db.prepare('SELECT count(*) AS n FROM probe_jobs').get() as { n: number }).n, 1);

  // Her other device is told why it was signed out, so the app can clear its local copy (PRIV-6).
  for (const token of [maria.token, mariaLaptop.token]) {
    const res = await t.call('sync.pull', { token });
    assert.equal(res.status, 401);
    assert.deepEqual(res.error?.details, { reason: 'account_deleted' });
  }
  // The email is free again, and the old password opens nothing.
  assert.equal((await t.call('auth.login', { body: { email: 'maria@example.test', password: 'kalabaw-bituin-ilog-27' } })).status, 401);
  assert.equal((await t.call('auth.register', { body: { email: 'maria@example.test', password: 'kalabaw-bituin-ilog-27', displayName: 'Maria again' } })).ok, true);
  assert.equal((await t.call('auth.me', { token: jose.token })).ok, true);
  t.close();
});

test('RecordStore service: get, list, put, remove and planSnapshot work per owner and follow the same rules as sync', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  const other = await t.registerUser();
  const records = t.services.records;

  const created = records.put(u.id, 'day_note', note('note-0001', 'from a module'));
  assert.equal(created.rev, 1);
  assert.equal(records.put(u.id, 'day_note', note('note-0001', 'edited by a module')).rev, 2);
  assert.equal(records.get(u.id, 'day_note', 'note-0001')!.data.text, 'edited by a module');
  assert.equal(records.get(other.id, 'day_note', 'note-0001'), null);

  // A server-side write reaches the teacher's devices on their next pull.
  const pulled = await t.ok('sync.pull', { token: u.token });
  assert.ok(pulled.records.some((r) => r.id === 'note-0001' && r.rev === 2));

  records.remove(u.id, 'day_note', 'note-0001');
  assert.equal(records.get(u.id, 'day_note', 'note-0001'), null, 'a deleted record is not returned by get');
  assert.deepEqual(records.list(u.id, 'day_note'), []);
  assert.equal(records.list(u.id, 'day_note', { includeDeleted: true })[0]!.deletedAt, t.clock.now().toISOString());

  assert.throws(() => records.put(u.id, 'day_note', { ...note('note-0002', 'x'), date: 'not a date' }), (err: unknown) => err instanceof HttpError && err.code === 'invalid_input');

  records.put(u.id, 'plan', plan('plan-0001'));
  records.put(u.id, 'plan_section', parseRecordData('plan_section', { id: 'sec-000001', planId: 'plan-0001', key: 'content', content: { type: 'text', blocks: [] } }));
  records.put(u.id, 'plan_section', parseRecordData('plan_section', { id: 'sec-000002', planId: 'plan-9999', key: 'content', content: { type: 'text', blocks: [] } }));
  const snapshot = records.planSnapshot(u.id, 'plan-0001')!;
  assert.equal(snapshot.plan.id, 'plan-0001');
  assert.deepEqual(snapshot.sections.map((s) => s.id), ['sec-000001']);
  assert.equal(records.planSnapshot(other.id, 'plan-0001'), null);
  assert.equal(records.planSnapshot(u.id, 'plan-none'), null);
  records.remove(u.id, 'plan', 'plan-0001');
  assert.equal(records.planSnapshot(u.id, 'plan-0001'), null);
  t.close();
});

test('the profile record keeps the account’s name and language in step', async () => {
  const t = createTestServer();
  const u = await t.registerUser({ displayName: 'Maria Santos', uiLanguage: 'fil' });
  t.services.records.put(u.id, 'profile', parseRecordData('profile', { id: 'profile', displayName: 'Gng. Maria Santos-Reyes', uiLanguage: 'en' }));
  assert.equal((await t.ok('auth.me', { token: u.token })).user.displayName, 'Gng. Maria Santos-Reyes');
  // Mail now goes out in the language she chose.
  await t.ok('auth.requestReset', { body: { email: u.email } });
  assert.equal(t.outbox()[0]!.lang, 'en');
  assert.match(t.outbox()[0]!.body, /Gng\. Maria Santos-Reyes/);
  t.close();
});

test('checkTallies counts teachers, not records, and only confirmed-email accounts (CUR-7)', async () => {
  const t = createTestServer();
  const a = await t.registerUser();
  const b = await t.registerUser();
  const c = await t.registerUser();
  const unverified = await t.registerUser({ verified: false });
  await push(t, a.token, [upsert('competency_check', check('check-0001', 'sci.g4.t2.001', 'confirmed')), upsert('competency_check', check('check-0002', 'sci.g4.t2.001', 'confirmed')), upsert('competency_check', check('check-0003', 'sci.g4.t2.002', 'corrected'))]);
  await push(t, b.token, [upsert('competency_check', check('check-0001', 'sci.g4.t2.001', 'confirmed')), upsert('competency_check', check('check-0002', 'sci.g4.t2.002', 'corrected'))]);
  await push(t, c.token, [upsert('competency_check', check('check-0001', 'sci.g4.t2.001', 'confirmed', 'another-version')), upsert('competency_check', check('check-0002', 'sci.g4.t2.003', 'confirmed'))]);
  await push(t, unverified.token, [upsert('competency_check', check('check-0001', 'sci.g4.t2.001', 'confirmed'))]);

  const ids = ['sci.g4.t2.001', 'sci.g4.t2.002', 'sci.g4.t2.003', 'sci.g4.t2.004'];
  assert.deepEqual(t.services.records.checkTallies('matatag-2024', ids), {
    confirmed: { 'sci.g4.t2.001': 2, 'sci.g4.t2.003': 1 },
    corrected: { 'sci.g4.t2.002': 2 },
  });
  assert.deepEqual(t.services.records.checkTallies('matatag-2024', []), { confirmed: {}, corrected: {} });

  // A withdrawn check stops counting.
  await push(t, c.token, [{ mutationId: 'mutation-a-delete-2', entity: 'competency_check', id: 'check-0002', op: 'delete', baseRev: 1 }]);
  assert.deepEqual(t.services.records.checkTallies('matatag-2024', ids).confirmed, { 'sci.g4.t2.001': 2 });
  // Many ids at once (a whole pack) are handled.
  const many = Array.from({ length: 450 }, (_, i) => `sci.g4.t9.${i}`);
  assert.deepEqual(t.services.records.checkTallies('matatag-2024', [...many, 'sci.g4.t2.001']).confirmed, { 'sci.g4.t2.001': 2 });
  t.close();
});
