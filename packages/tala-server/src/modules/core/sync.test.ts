import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRecordData } from '@hiraia/tala-core';
import type { EntityName, Mutation, MutationResult, RecordData } from '@hiraia/tala-core';
import { createTestServer } from '../../testing';
import type { TestServer } from '../../testing';
import { MAX_RECORD_BYTES } from './records';

let counter = 0;
const mid = () => `mutation-${String(++counter).padStart(6, '0')}`;

function upsert<E extends EntityName>(entity: E, data: RecordData<E>, baseRev = 0, mutationId = mid()): Mutation {
  return { mutationId, entity, id: data.id, op: 'upsert', baseRev, data };
}
function del(entity: EntityName, id: string, baseRev: number, mutationId = mid()): Mutation {
  return { mutationId, entity, id, op: 'delete', baseRev };
}

const note = (id: string, text: string) => parseRecordData('day_note', { id, classId: 'class-0001', date: '2026-11-16', text });
const student = (id: string, displayName: string) =>
  parseRecordData('student', { id, classId: 'class-0001', displayName, familyName: 'Dela Cruz', givenName: 'Juan Miguel', localId: 'A-17', sex: 'M' });
const plan = (id: string, extra: Record<string, unknown> = {}) =>
  parseRecordData('plan', { id, templateId: 'tpl.dlp.v1', language: 'fil', grades: ['4'], durationMinutes: 50, title: `Plan ${id}`, ...extra });
const section = (id: string, planId: string, key: string, text: string) =>
  parseRecordData('plan_section', { id, planId, key, content: { type: 'text', blocks: [{ t: 'p', spans: [{ text }] }] } });

async function push(t: TestServer, token: string, mutations: Mutation[], deviceId = 'device-0001'): Promise<MutationResult[]> {
  const res = await t.ok('sync.push', { token, body: { deviceId, mutations } });
  return res.results as MutationResult[];
}
async function pullAll(t: TestServer, token: string, query: { windowFrom?: string; windowTo?: string; limit?: number } = {}) {
  const records = [];
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const page = await t.ok('sync.pull', { token, query: { ...query, ...(cursor ? { cursor } : {}) } });
    // The account's own profile record may or may not exist yet; these tests are about what they pushed.
    records.push(...page.records.filter((r) => r.entity !== 'profile'));
    pages++;
    assert.ok(!page.hasMore || page.cursor !== cursor, 'the cursor must advance while there is more');
    cursor = page.cursor;
    if (!page.hasMore) return { records, cursor, pages };
  }
}

test('rules 1 and 4: a write on the version the device saw is applied; the server assigns rev and time', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  const [created] = await push(t, u.token, [upsert('day_note', note('note-0001', 'first'))]);
  assert.equal(created!.status, 'applied');
  assert.equal(created!.record!.rev, 1);
  assert.equal(created!.record!.updatedAt, t.clock.now().toISOString());
  assert.equal(created!.record!.deletedAt, null);

  t.clock.advance({ minutes: 3 });
  const [updated] = await push(t, u.token, [upsert('day_note', note('note-0001', 'second'), 1)]);
  assert.equal(updated!.status, 'applied');
  assert.equal(updated!.record!.rev, 2);
  assert.equal(updated!.record!.updatedAt, t.clock.now().toISOString());
  assert.equal((updated!.record!.data as { text: string }).text, 'second');

  // Schema defaults are applied on the way in, so every device reads the same shape back.
  const [bare] = await push(t, u.token, [{ mutationId: mid(), entity: 'day_note', id: 'note-0002', op: 'upsert', baseRev: 0, data: { id: 'note-0002', classId: 'class-0001', date: '2026-11-16', text: 'x' } }]);
  assert.deepEqual(bare!.record!.data, note('note-0002', 'x'));
  t.close();
});

test('rule 2: a write on an older version is a conflict; the server record comes back and is not overwritten', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  await push(t, u.token, [upsert('day_note', note('note-0001', 'first'))]);
  await push(t, u.token, [upsert('day_note', note('note-0001', 'from the laptop'), 1)], 'device-laptop');

  const [stale] = await push(t, u.token, [upsert('day_note', note('note-0001', 'from the phone'), 1)], 'device-phone');
  assert.equal(stale!.status, 'conflict');
  assert.equal(stale!.record!.rev, 2);
  assert.equal((stale!.record!.data as { text: string }).text, 'from the laptop');
  assert.equal(t.services.records.get(u.id, 'day_note', 'note-0001')!.data.text, 'from the laptop');

  // A device claiming a newer version than exists is told the same way.
  const [ahead] = await push(t, u.token, [upsert('day_note', note('note-0001', 'from the future'), 9)]);
  assert.equal(ahead!.status, 'conflict');

  // Sending exactly what the server already has is not a conflict and makes no new version.
  const [same] = await push(t, u.token, [upsert('day_note', note('note-0001', 'from the laptop'), 1)]);
  assert.equal(same!.status, 'applied');
  assert.equal(same!.record!.rev, 2);
  t.close();
});

test('rule 3: a replayed mutation returns the original result and changes nothing', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  const first = upsert('day_note', note('note-0001', 'first'));
  const [original] = await push(t, u.token, [first]);

  t.clock.advance({ minutes: 5 });
  const [replay] = await push(t, u.token, [first]);
  assert.deepEqual(replay, original);
  assert.equal(t.services.records.get(u.id, 'day_note', 'note-0001')!.rev, 1);

  // Another device moves the record on. The lost-reply replay must still report rev 1, not the newer record:
  // otherwise the first device would believe it had seen (and could overwrite) the other device's edit.
  await push(t, u.token, [upsert('day_note', note('note-0001', 'newer, from elsewhere'), 1)], 'device-other');
  const [late] = await push(t, u.token, [first]);
  assert.deepEqual(late, original);
  assert.equal(t.services.records.get(u.id, 'day_note', 'note-0001')!.data.text, 'newer, from elsewhere');

  // The same id sent twice in one batch is answered twice and applied once.
  const twice = upsert('day_note', note('note-0002', 'once'));
  const both = await push(t, u.token, [twice, twice]);
  assert.deepEqual(both[0], both[1]);
  assert.equal(both[0]!.record!.rev, 1);

  // Reusing a mutation id for different content is refused rather than silently answered with the old result.
  const [reused] = await push(t, u.token, [{ ...first, data: note('note-0001', 'something else') }]);
  assert.equal(reused!.status, 'invalid');
  assert.equal(reused!.record, null);

  // A replayed delete, likewise.
  const gone = del('day_note', 'note-0002', 1);
  const [deleted] = await push(t, u.token, [gone]);
  assert.deepEqual((await push(t, u.token, [gone]))[0], deleted);
  t.close();
});

test('rule 6 and edit-versus-delete: the edit wins both ways round', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  await push(t, u.token, [upsert('day_note', note('note-0001', 'first'))]);

  // Deleted on device A, then a stale edit arrives from device B: applied, and the record is back.
  const [tombstone] = await push(t, u.token, [del('day_note', 'note-0001', 1)], 'device-a');
  assert.equal(tombstone!.status, 'applied');
  assert.equal(tombstone!.record!.rev, 2);
  assert.equal(tombstone!.record!.deletedAt, t.clock.now().toISOString());
  assert.equal(t.services.records.get(u.id, 'day_note', 'note-0001'), null);
  const [restored] = await push(t, u.token, [upsert('day_note', note('note-0001', 'edited on B'), 1)], 'device-b');
  assert.equal(restored!.status, 'applied');
  assert.equal(restored!.record!.rev, 3);
  assert.equal(restored!.record!.deletedAt, null);

  // Edited on device B, then a stale delete arrives from device A: conflict, the record stays.
  const [staleDelete] = await push(t, u.token, [del('day_note', 'note-0001', 1)], 'device-a');
  assert.equal(staleDelete!.status, 'conflict');
  assert.equal((staleDelete!.record!.data as { text: string }).text, 'edited on B');
  assert.equal(t.services.records.get(u.id, 'day_note', 'note-0001')!.rev, 3);

  // Deleting twice is harmless; deleting something the server never saw has nothing to return.
  const [again] = await push(t, u.token, [del('day_note', 'note-0001', 3)]);
  const [twice] = await push(t, u.token, [del('day_note', 'note-0001', 3)]);
  assert.equal(again!.record!.rev, 4);
  assert.equal(twice!.status, 'applied');
  assert.equal(twice!.record!.rev, 4);
  const [never] = await push(t, u.token, [del('day_note', 'note-never-seen', 0)]);
  assert.deepEqual(never, { mutationId: never!.mutationId, status: 'applied', record: null });
  t.close();
});

test('rule 5: sections of a locked plan are refused, except those outside the lock', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  const sections = [
    section('sec-objectives', 'plan-0001', 'objectives', 'x'),
    section('sec-materials', 'plan-0001', 'materials', 'x'),
    section('sec-procedure', 'plan-0001', 'procedure', 'x'),
    section('sec-assessment', 'plan-0001', 'assessment', 'x'),
    section('sec-reflection', 'plan-0001', 'reflection', ''),
  ].map((s) =>
    s.key === 'objectives' || s.key === 'materials'
      ? parseRecordData('plan_section', { ...s, content: { type: 'list', items: ['one'] } })
      : s.key === 'procedure'
        ? parseRecordData('plan_section', { ...s, content: { type: 'procedure', steps: [{ id: 'step-0001', title: 'Simula', minutes: 10, body: [{ t: 'p', spans: [{ text: 'Gawin' }] }] }] } })
        : s,
  );
  const results = await push(t, u.token, [
    upsert('plan', plan('plan-0001')),
    ...sections.map((s) => upsert('plan_section', s)),
    upsert('plan', plan('plan-0001', { state: 'locked', lock: { lockedAt: t.clock.now().toISOString(), revisionCode: 'ABC1234', revision: null } }), 1),
  ]);
  assert.deepEqual(results.map((r) => r.status), Array(7).fill('applied'));

  const edit = await push(t, u.token, [upsert('plan_section', section('sec-assessment', 'plan-0001', 'assessment', 'changed after lock'), 1)]);
  assert.equal(edit[0]!.status, 'locked');
  assert.equal((edit[0]!.record!.data as { content: { blocks: Array<{ spans: Array<{ text: string }> }> } }).content.blocks[0]!.spans[0]!.text, 'x', 'the server copy comes back unchanged');

  // Locked is reported even when the device is also behind: it will make a draft copy either way (DOC-4).
  assert.equal((await push(t, u.token, [upsert('plan_section', section('sec-assessment', 'plan-0001', 'assessment', 'stale and locked'), 0)]))[0]!.status, 'locked');
  assert.equal((await push(t, u.token, [upsert('plan_section', section('sec-new-0001', 'plan-0001', 'content', 'a new part'))]))[0]!.status, 'locked');
  assert.equal((await push(t, u.token, [del('plan_section', 'sec-assessment', 1)]))[0]!.status, 'locked');

  // Reflection is outside the lock: the teacher writes it after the lesson (DOC-2).
  const reflection = await push(t, u.token, [upsert('plan_section', section('sec-reflection', 'plan-0001', 'reflection', 'Nahirapan ang ilan sa bahagi 2.'), 1)]);
  assert.equal(reflection[0]!.status, 'applied');
  // …but it cannot be turned into a locked part, and a part cannot be moved into the locked plan.
  assert.equal((await push(t, u.token, [upsert('plan_section', section('sec-reflection', 'plan-0001', 'assessment', 'sneaky'), 2)]))[0]!.status, 'locked');
  await push(t, u.token, [upsert('plan', plan('plan-0002')), upsert('plan_section', section('sec-other-01', 'plan-0002', 'content', 'draft text'))]);
  assert.equal((await push(t, u.token, [upsert('plan_section', section('sec-other-01', 'plan-0001', 'content', 'draft text'), 1)]))[0]!.status, 'locked');

  // Re-sending a locked part unchanged is not an edit, so the device makes no needless draft copy.
  const unchanged = await push(t, u.token, [upsert('plan_section', sections[3]!, 1)]);
  assert.equal(unchanged[0]!.status, 'applied');
  assert.equal(unchanged[0]!.record!.rev, 1);

  // History records are not subject to the lock.
  const history = parseRecordData('section_revision', {
    id: 'rev-000001', planId: 'plan-0001', sectionId: 'sec-assessment', key: 'assessment',
    content: { type: 'text', blocks: [] }, origin: 'manual', reason: 'lock', savedAt: t.clock.now().toISOString(),
  });
  assert.equal((await push(t, u.token, [upsert('section_revision', history)]))[0]!.status, 'applied');
  // …and once written they do not change.
  const altered = await push(t, u.token, [upsert('section_revision', { ...history, key: 'objectives' }, 1)]);
  assert.equal(altered[0]!.status, 'forbidden');
  assert.equal((await push(t, u.token, [upsert('section_revision', history, 1)]))[0]!.status, 'applied');
  t.close();
});

test('strict owner isolation: same ids, separate worlds', async () => {
  const t = createTestServer();
  const maria = await t.registerUser();
  const jose = await t.registerUser();
  await push(t, maria.token, [upsert('day_note', note('note-0001', 'Maria’s note')), upsert('plan', plan('plan-0001')), upsert('plan_section', section('sec-000001', 'plan-0001', 'content', 'Maria’s lesson'))]);

  // Jose using the very same ids neither sees nor disturbs Maria's records.
  const [joseNote] = await push(t, jose.token, [upsert('day_note', note('note-0001', 'Jose’s note'))]);
  assert.equal(joseNote!.status, 'applied');
  assert.equal(joseNote!.record!.rev, 1);
  assert.equal((await push(t, jose.token, [del('plan', 'plan-0001', 1)]))[0]!.record, null);
  assert.equal(t.services.records.get(maria.id, 'day_note', 'note-0001')!.data.text, 'Maria’s note');
  assert.ok(t.services.records.get(maria.id, 'plan', 'plan-0001'));

  const josePull = await pullAll(t, jose.token);
  assert.deepEqual(josePull.records.map((r) => `${r.entity}:${r.id}`).sort(), ['day_note:note-0001']);
  assert.ok(!JSON.stringify(josePull.records).includes('Maria'));

  // A cursor is a position in one shared sequence, so Maria's cursor in Jose's hands still yields only Jose's records.
  const mariaPull = await pullAll(t, maria.token);
  const withMariasCursor = await t.ok('sync.pull', { token: jose.token, query: { cursor: mariaPull.cursor } });
  assert.ok(!JSON.stringify(withMariasCursor).includes('Maria'));
  const fromZero = await t.ok('sync.pull', { token: jose.token, query: { cursor: Buffer.from(JSON.stringify({ v: 1, s: 0 })).toString('base64url') } });
  assert.ok(!JSON.stringify(fromZero).includes('Maria'));

  const joseExport = await t.ok('account.export', { token: jose.token });
  assert.ok(!JSON.stringify(joseExport).includes('Maria'));
  assert.equal((await t.call('plans.revisions', { token: jose.token, params: { planId: 'plan-0001' } })).data!.revisions.length, 0);
  assert.equal((await t.call('plans.revision', { token: jose.token, params: { planId: 'plan-0001', revision: '1' } })).status, 404);
  assert.equal(t.services.records.planSnapshot(jose.id, 'plan-0001'), null);
  assert.equal(t.services.records.list(jose.id, 'plan').length, 0);

  // No signed-in user, no sync.
  assert.equal((await t.call('sync.pull')).status, 401);
  assert.equal((await t.call('sync.push', { body: { deviceId: 'device-0001', mutations: [] } })).status, 401);
  t.close();
});

test('bad items are refused one by one, without echoing what was sent', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  const results = await push(t, u.token, [
    upsert('day_note', note('note-0001', 'good')),
    { mutationId: mid(), entity: 'day_note', id: 'note-0002', op: 'upsert', baseRev: 0, data: { id: 'note-0002', classId: 'class-0001', date: 'the 16th, SECRET-VALUE', text: 'x' } },
    { mutationId: mid(), entity: 'day_note', id: 'note-0003', op: 'upsert', baseRev: 0, data: { ...note('note-9999', 'x') } },
    { mutationId: mid(), entity: 'day_note', id: 'note-0004', op: 'upsert', baseRev: 0, data: { ...note('note-0004', 'x'), padding: 'p'.repeat(MAX_RECORD_BYTES) } },
    { mutationId: mid(), entity: 'day_note', id: 'note-0005', op: 'upsert', baseRev: 0 },
    { mutationId: mid(), entity: 'template', id: 'tpl-custom-1', op: 'upsert', baseRev: 0, data: { id: 'tpl-custom-1', kind: 'custom', name: { fil: 'A', en: 'A' }, builtIn: true, span: 'session', orientation: 'portrait', sections: [] } },
    upsert('day_note', note('note-0006', 'also good')),
  ]);
  assert.deepEqual(results.map((r) => r.status), ['applied', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'applied']);
  assert.match(results[1]!.message!, /\(date\)$/);
  assert.ok(!JSON.stringify(results).includes('SECRET-VALUE'));
  assert.ok(!JSON.stringify(t.logs).includes('SECRET-VALUE'));
  assert.deepEqual(t.services.records.list(u.id, 'day_note').map((r) => r.id), ['note-0001', 'note-0006']);

  // The request itself is validated by the contract: more than 100 mutations or an unknown kind of record is a 400.
  const tooMany = await t.call('sync.push', { token: u.token, body: { deviceId: 'device-0001', mutations: Array.from({ length: 101 }, (_, i) => upsert('day_note', note(`note-1${String(i).padStart(4, '0')}`, 'x'))) } });
  assert.equal(tooMany.status, 400);
  const unknownKind = await t.call('sync.push', { token: u.token, body: { deviceId: 'device-0001', mutations: [{ mutationId: mid(), entity: 'gradebook' as never, id: 'grade-0001', op: 'upsert', baseRev: 0, data: {} }] } });
  assert.equal(unknownKind.status, 400);
  t.close();
});

test('a deleted learner’s name does not stay on the server', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  const NAME = 'Juan Miguel S. Dela Cruz';
  const create = upsert('student', student('student-0001', NAME));
  await push(t, u.token, [create, upsert('day_note', note('note-0001', `${NAME} was absent today`))]);
  const [tombstone] = await push(t, u.token, [del('student', 'student-0001', 1), del('day_note', 'note-0001', 1)]);

  // What remains still fits the schema (devices validate what they receive) but carries no name.
  const data = parseRecordData('student', tombstone!.record!.data);
  assert.equal(data.displayName, '—');
  assert.deepEqual([data.familyName, data.givenName, data.localId, data.sex], ['', '', null, null]);
  assert.equal(data.classId, 'class-0001');

  const dump = ['core_records', 'core_sync_mutations', 'core_plan_revisions'].map((n) => JSON.stringify(t.db.prepare(`SELECT * FROM ${n}`).all())).join('\n');
  for (const piece of [NAME, 'Juan Miguel', 'Dela Cruz', 'A-17', 'absent today']) assert.ok(!dump.includes(piece), piece);

  // A replay of the original create is still answered, without bringing the name back.
  const [replay] = await push(t, u.token, [create]);
  assert.equal(replay!.status, 'applied');
  assert.equal(replay!.record!.rev, 1);
  assert.ok(!JSON.stringify(replay).includes('Juan'));

  // Another device learns of the delete on its next pull.
  const pulled = await pullAll(t, u.token);
  assert.deepEqual(pulled.records.map((r) => r.id).sort(), []);
  const later = await t.ok('sync.pull', { token: u.token, query: { cursor: Buffer.from(JSON.stringify({ v: 1, s: 1 })).toString('base64url') } });
  const gone = later.records.find((r) => r.id === 'student-0001')!;
  assert.ok(gone.deletedAt);
  parseRecordData('student', gone.data);
  t.close();
});

test('pull: pages by cursor, picks up only what changed, and leaves tombstones out of a first sync', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  await push(t, u.token, Array.from({ length: 25 }, (_, i) => upsert('day_note', note(`note-${String(i).padStart(4, '0')}`, `text ${i}`))));
  await push(t, u.token, [del('day_note', 'note-0003', 1)]);

  const first = await pullAll(t, u.token, { limit: 10 });
  assert.equal(first.pages, 3);
  assert.equal(first.records.length, 24, 'the deleted note is not sent to a new device');
  assert.ok(first.records.every((r) => r.deletedAt === null));
  assert.equal(new Set(first.records.map((r) => `${r.entity}:${r.id}`)).size, 24);

  // Nothing new: an empty page and a cursor that still works.
  const idle = await t.ok('sync.pull', { token: u.token, query: { cursor: first.cursor } });
  assert.deepEqual(idle.records, []);
  assert.equal(idle.hasMore, false);
  assert.equal(idle.serverTime, t.clock.now().toISOString());

  // Later changes, including deletes, arrive from the cursor on.
  await push(t, u.token, [upsert('day_note', note('note-0001', 'edited'), 1), del('day_note', 'note-0002', 1), upsert('day_note', note('note-9000', 'new'))]);
  const next = await t.ok('sync.pull', { token: u.token, query: { cursor: idle.cursor } });
  assert.deepEqual(next.records.map((r) => [r.id, r.rev, r.deletedAt !== null]), [
    ['note-0001', 2, false],
    ['note-0002', 2, true],
    ['note-9000', 1, false],
  ]);

  // A cursor the server cannot read means "start again", not an error the device is stuck on.
  const garbled = await t.ok('sync.pull', { token: u.token, query: { cursor: 'not-a-real-cursor' } });
  assert.ok(garbled.records.length > 0);
  assert.ok(t.logs.some((l) => l.event === 'sync_cursor_unreadable'));
  assert.equal((await t.call('sync.pull', { token: u.token, query: { limit: 500 } })).status, 400);
  assert.equal((await t.call('sync.pull', { token: u.token, query: { windowFrom: 'last week' } })).status, 400);
  t.close();
});

test('pull keeps pages small on slow connections whatever the limit', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  const big = 'lesson text '.repeat(1800); // ~21 KB each
  for (let batch = 0; batch < 3; batch++) {
    await push(t, u.token, Array.from({ length: 20 }, (_, i) => upsert('plan_section', section(`sec-${batch}-${String(i).padStart(4, '0')}`, 'plan-0001', 'content', big.slice(0, 3900)))));
  }
  // 60 sections of ~4 KB fit one page; make them heavier with many paragraphs.
  const heavy = parseRecordData('plan_section', { id: 'sec-heavy-0001', planId: 'plan-0001', key: 'content', content: { type: 'text', blocks: Array.from({ length: 60 }, () => ({ t: 'p', spans: [{ text: big.slice(0, 3900) }] })) } });
  await push(t, u.token, [upsert('plan_section', heavy), upsert('plan_section', { ...heavy, id: 'sec-heavy-0002' }), upsert('plan_section', { ...heavy, id: 'sec-heavy-0003' })]);
  const all = await pullAll(t, u.token, { limit: 200 });
  assert.equal(all.records.length, 63);
  assert.ok(all.pages >= 3, `expected the byte cap to split the pull, got ${all.pages} page(s)`);
  t.close();
});

test('first-sync window (OFF-2): far-off plans wait, except locked ones in the running term', async () => {
  const t = createTestServer({ now: '2026-11-16T00:00:00.000Z' });
  const u = await t.registerUser();
  const placed = (id: string, date: string, extra: Record<string, unknown> = {}) => plan(id, { placements: [{ classId: 'class-0001', assignmentId: null, dates: [date] }], ...extra });
  const lockedPlan = (id: string, date: string) => placed(id, date, { state: 'locked', lock: { lockedAt: '2026-08-20T00:00:00.000Z', revisionCode: 'OLD0001', revision: null } });
  const filled = (planId: string) => [
    parseRecordData('plan_section', { id: `${planId}-objectives`, planId, key: 'objectives', content: { type: 'list', items: ['a'] } }),
    parseRecordData('plan_section', { id: `${planId}-materials`, planId, key: 'materials', content: { type: 'list', items: ['a'] } }),
    parseRecordData('plan_section', { id: `${planId}-procedure`, planId, key: 'procedure', content: { type: 'procedure', steps: [{ id: 'step-0001', title: 'a', minutes: 5, body: [{ t: 'p', spans: [{ text: 'a' }] }] }] } }),
    section(`${planId}-assessment`, planId, 'assessment', 'a'),
  ];
  const schoolYear = parseRecordData('school_year', {
    id: 'sy-2026-27', label: '2026-2027', startDate: '2026-06-15', endDate: '2027-03-31',
    terms: [
      { id: 'term-0001', index: 1, name: 'Q1', startDate: '2026-06-15', endDate: '2026-08-21' },
      { id: 'term-0002', index: 2, name: 'Q2', startDate: '2026-08-24', endDate: '2026-12-18' },
    ],
  });
  const results = await push(t, u.token, [
    upsert('school_year', schoolYear),
    upsert('plan', placed('plan-this-week', '2026-11-18')),
    upsert('plan_section', section('sec-this-week', 'plan-this-week', 'content', 'near')),
    upsert('plan', placed('plan-last-june', '2026-06-22')),
    upsert('plan_section', section('sec-last-june', 'plan-last-june', 'content', 'far')),
    upsert('section_revision', parseRecordData('section_revision', { id: 'hist-last-june', planId: 'plan-last-june', sectionId: 'sec-last-june', key: 'content', content: { type: 'text', blocks: [] }, origin: 'manual', reason: 'edit', savedAt: '2026-06-22T00:00:00.000Z' })),
    upsert('plan', plan('plan-undated')),
    upsert('plan', placed('plan-far-ahead', '2027-03-01')),
    // Locked, outside the window, but in the term that is running now (Q2): kept.
    ...filled('plan-locked-q2').map((s) => upsert('plan_section', s)),
    upsert('plan', lockedPlan('plan-locked-q2', '2026-09-02')),
    // Locked, outside the window, in a term that is over (Q1): waits.
    ...filled('plan-locked-q1').map((s) => upsert('plan_section', s)),
    upsert('plan', lockedPlan('plan-locked-q1', '2026-07-01')),
    upsert('day_note', note('note-old-0001', 'other kinds of record always sync in full')),
  ]);
  assert.ok(results.every((r) => r.status === 'applied'), JSON.stringify(results.filter((r) => r.status !== 'applied')));

  // Four weeks back to eight weeks ahead of 16 November.
  const window = { windowFrom: '2026-10-19', windowTo: '2027-01-11' };
  const windowed = await pullAll(t, u.token, { ...window, limit: 5 });
  const got = new Set(windowed.records.map((r) => r.id));
  for (const id of ['plan-this-week', 'sec-this-week', 'plan-undated', 'plan-locked-q2', 'plan-locked-q2-assessment', 'note-old-0001', 'sy-2026-27']) assert.ok(got.has(id), `expected ${id}`);
  for (const id of ['plan-last-june', 'sec-last-june', 'hist-last-june', 'plan-far-ahead', 'plan-locked-q1', 'plan-locked-q1-assessment']) assert.ok(!got.has(id), `did not expect ${id}`);
  assert.ok(windowed.pages > 1, 'the window carries across pages of the same first sync');

  // Without a window everything comes.
  assert.equal((await pullAll(t, u.token)).records.length, results.length);

  // After the first sync the window no longer filters: a change to a far-off plan reaches the device.
  await push(t, u.token, [upsert('plan', placed('plan-last-june', '2026-06-23'), 1)]);
  const next = await t.ok('sync.pull', { token: u.token, query: { cursor: windowed.cursor, ...window } });
  assert.deepEqual(next.records.map((r) => r.id), ['plan-last-june']);

  // Older plans on demand: a separate windowed pull over the range wanted.
  const older = await pullAll(t, u.token, { windowFrom: '2026-06-01', windowTo: '2026-06-30' });
  assert.ok(older.records.some((r) => r.id === 'sec-last-june'));
  assert.ok(!older.records.some((r) => r.id === 'plan-this-week'));
  t.close();
});

test('older plans on demand: planIds returns just those plans with their parts and history, and leaves the main cursor alone', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  const other = await t.registerUser();
  const history = (id: string, planId: string, sectionId: string) =>
    parseRecordData('section_revision', { id, planId, sectionId, key: 'content', content: { type: 'text', blocks: [] }, origin: 'manual', reason: 'edit', savedAt: '2026-06-22T00:00:00.000Z' });
  await push(t, u.token, [
    upsert('plan', plan('plan-old-0001')),
    upsert('plan_section', section('sec-old-0001a', 'plan-old-0001', 'content', 'old lesson, part a')),
    upsert('plan_section', section('sec-old-0001b', 'plan-old-0001', 'assessment', 'old lesson, part b')),
    upsert('section_revision', history('hist-old-0001', 'plan-old-0001', 'sec-old-0001a')),
    upsert('plan', plan('plan-old-0002')),
    upsert('plan_section', section('sec-old-0002a', 'plan-old-0002', 'content', 'another old lesson')),
    upsert('plan', plan('plan-other-01')),
    upsert('plan_section', section('sec-other-01a', 'plan-other-01', 'content', 'not asked for')),
    upsert('day_note', note('note-0001', 'not a plan')),
  ]);
  await push(t, other.token, [upsert('plan', plan('plan-old-0001')), upsert('plan_section', section('sec-theirs-01', 'plan-old-0001', 'content', 'someone else’s lesson with the same id'))]);
  const main = await pullAll(t, u.token);

  const one = await t.ok('sync.pull', { token: u.token, query: { planIds: 'plan-old-0001' } });
  assert.deepEqual(one.records.map((r) => r.id).sort(), ['hist-old-0001', 'plan-old-0001', 'sec-old-0001a', 'sec-old-0001b']);
  assert.equal(one.hasMore, false);
  assert.equal(one.cursor, '', 'nothing to continue, and nothing a device could mistake for its main cursor');
  assert.ok(!JSON.stringify(one).includes('someone else'));

  // Several at once, paged with the request's own token.
  const firstPage = await t.ok('sync.pull', { token: u.token, query: { planIds: 'plan-old-0001, plan-old-0002,plan-missing-1', limit: 4 } });
  assert.equal(firstPage.records.length, 4);
  assert.equal(firstPage.hasMore, true);
  const secondPage = await t.ok('sync.pull', { token: u.token, query: { planIds: 'plan-old-0001, plan-old-0002,plan-missing-1', limit: 4, cursor: firstPage.cursor } });
  assert.equal(secondPage.hasMore, false);
  assert.deepEqual([...firstPage.records, ...secondPage.records].map((r) => r.id).sort(), ['hist-old-0001', 'plan-old-0001', 'plan-old-0002', 'sec-old-0001a', 'sec-old-0001b', 'sec-old-0002a']);

  // A deleted part comes back marked deleted, so the device can tell.
  await push(t, u.token, [del('plan_section', 'sec-old-0001b', 1)]);
  const afterDelete = await t.ok('sync.pull', { token: u.token, query: { planIds: 'plan-old-0001' } });
  assert.ok(afterDelete.records.find((r) => r.id === 'sec-old-0001b')!.deletedAt);

  // The main cursor still works exactly as before and has not skipped anything.
  const next = await t.ok('sync.pull', { token: u.token, query: { cursor: main.cursor } });
  assert.deepEqual(next.records.map((r) => r.id), ['sec-old-0001b']);

  for (const bad of ['', ' , ', 'has spaces in it', Array.from({ length: 51 }, (_, i) => `plan-${i}`).join(',')]) {
    const res = await t.request('GET', `/sync/pull?planIds=${encodeURIComponent(bad)}`, { token: u.token });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  t.close();
});
