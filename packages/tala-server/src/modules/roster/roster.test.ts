import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { zipSync, strToU8 } from 'fflate';
import { emptyName } from '@hiraia/tala-core/roster';
import type { LlmGateway, LlmRequest, RecordStore } from '../../kernel/types';
import { createTestServer } from '../../testing';
import { createRosterModule } from './index';
import { readRoster } from './reader';
const classId = 'class-roster-test', groupId = 'group-three';
function harness(llm?: LlmGateway, production = false) {
  const owners = new Set<string>();
  const records = { get: (owner: string, entity: string, id: string) => owners.has(owner) && entity === 'class' && id === classId ? { data: { id: classId, gradeGroups: [{ id: groupId, grade: '3' }, { id: 'group-four', grade: '4' }] }, deletedAt: null } : null } as unknown as RecordStore;
  const t = createTestServer({ modules: [createRosterModule()], services: { records, ...(llm ? { llm } : {}) }, config: { publicOrigin: 'https://tala.test', environment: production ? 'production' : 'local', features: { rosterAi: true } }, quiet: true });
  return { t, owners };
}
function gateway(output: unknown | ((request: LlmRequest<unknown>) => unknown), route: 'cloud' | 'local' | 'rules' | 'off' = 'local', calls: LlmRequest<unknown>[] = []): LlmGateway {
  return { routeFor: () => route, async complete<T>(request: LlmRequest<T>) {
    calls.push(request as LlmRequest<unknown>);
    const data = typeof output === 'function' ? output(request as LlmRequest<unknown>) : output;
    return { ok: true, data: data as T, provider: route === 'cloud' ? 'deepseek' : 'local', model: 'fake', promptId: request.promptId, promptVersion: 1, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, fellBack: false };
  } };
}
const pasted = 'Name\tGrade\tLRN\tGuardian\nMiro Peña\t3\t123456789012\tPRIVATE_GUARDIAN\nJ. Reyes\t3\t123456789013\tPRIVATE_GUARDIAN';
for (const [label, output] of [
  ['hallucinated surname', { rows: [{ rowIndex: 1, proposed: emptyName('Miro Santos') }, { rowIndex: 2, proposed: emptyName('J. Reyes') }] }],
  ['expanded initial', { rows: [{ rowIndex: 1, proposed: emptyName('Miro Peña') }, { rowIndex: 2, proposed: emptyName('Jona Reyes') }] }],
  ['merged rows', { rows: [{ rowIndex: 1, proposed: emptyName('Miro Peña J. Reyes') }] }],
  ['dropped row', { rows: [{ rowIndex: 1, proposed: emptyName('Miro Peña') }] }],
  ['garbage output', 'not JSON'],
  ['duplicate indices', { rows: [{ rowIndex: 1, proposed: emptyName('Miro Peña') }, { rowIndex: 1, proposed: emptyName('Miro Peña') }] }],
] as const) test(`model ${label} cannot silently change stored students`, async () => {
  const calls: LlmRequest<unknown>[] = [];
  const { t, owners } = harness(gateway(output, 'local', calls));
  try {
    const user = await t.registerUser(); owners.add(user.id);
    const draft = await t.ok('roster.import', { token: user.token, body: { classId, filename: 'names.txt', text: pasted, useAi: true } });
    assert.equal(draft.rows.length, 3);
    assert.ok(draft.rows.some(r => r.flags.includes('untraceable_output')));
    assert.equal(draft.rows[1]!.proposed.displayName, 'Miro Peña');
    assert.equal(draft.rows[2]!.proposed.displayName, 'J. Reyes');
    assert.equal(calls.length, 1);
    const payload = JSON.stringify(calls[0]!.vars);
    for (const forbidden of ['PRIVATE_GUARDIAN','123456789012',classId,user.id,user.email]) assert.ok(!payload.includes(forbidden));
    const partial = await t.ok('roster.confirm', { token: user.token, params: { importId: draft.importId }, body: { resolutions: [] } });
    assert.deepEqual(partial.students, []); assert.deepEqual(partial.pendingRows, [1,2]);
    const resolved = await t.ok('roster.confirm', { token: user.token, params: { importId: draft.importId }, body: { resolutions: [{ rowIndex: 1, action: 'keep_original' }, { rowIndex: 2, action: 'keep_original' }] } });
    assert.deepEqual(resolved.students.map(s => s.displayName), ['Miro Peña','J. Reyes']);
    assert.equal((await t.call('roster.get', { token: user.token, params: { importId: draft.importId } })).status, 404);
    assert.ok(!JSON.stringify(t.logs).includes('Miro')); assert.equal(t.errors.length, 0);
  } finally { t.close(); }
});
test('gateway outage never fails an import', async () => {
  const { t, owners } = harness({ routeFor: () => 'local', complete: async () => { throw new Error('provider response contains private data'); } });
  try { const u = await t.registerUser(); owners.add(u.id); const draft = await t.ok('roster.import', { token: u.token, body: { classId, filename: 'names.txt', text: pasted, useAi: true } }); assert.equal(draft.rows.length, 3); assert.equal(t.errors.length, 0); } finally { t.close(); }
});
test('cloud flag required every import; production blocks cloud even with faulty gateway', async () => {
  for (const production of [false,true]) {
    const calls: LlmRequest<unknown>[] = [];
    const { t, owners } = harness(gateway({}, 'cloud', calls), production);
    try { const u = await t.registerUser({ verified: !production }); owners.add(u.id);
      // Production intentionally has no development mail outbox; seed only this test account's verified bit.
      if (production) t.db.prepare('UPDATE core_users SET email_verified = 1 WHERE id = ?').run(u.id);
      const result = await t.call('roster.import', { token: u.token, body: { classId, filename: 'names.txt', text: pasted, useAi: true } });
      assert.equal(result.status, production ? 200 : 400); assert.equal(calls.length, 0);
      const draft = await t.ok('roster.import', { token: u.token, body: { classId, filename: 'names.txt', text: pasted, useAi: true, cloudFlagAcknowledged: true } });
      assert.equal(draft.route, production ? 'rules' : 'cloud'); assert.equal(calls.length, production ? 0 : 1);
    } finally { t.close(); }
  }
});
test('ownership, verified email, expiry, abandonment and deleted classes', async () => {
  const { t, owners } = harness();
  try {
    const u = await t.registerUser(), other = await t.registerUser(), unverified = await t.registerUser({ verified: false }); owners.add(u.id); owners.add(other.id); owners.add(unverified.id);
    const body = { classId, filename: 'names.txt', text: 'Peña, Miro A.', useAi: false };
    assert.equal((await t.call('roster.import', { token: unverified.token, body })).status, 403);
    const draft = await t.ok('roster.import', { token: u.token, body });
    const params = { importId: draft.importId };
    assert.equal((await t.call('roster.get', { token: other.token, params })).status, 404);
    assert.equal((await t.call('roster.abandon', { token: other.token, params })).status, 404);
    t.clock.advance({ hours: 24 });
    assert.equal((await t.call('roster.get', { token: u.token, params })).status, 404);
    const next = await t.ok('roster.import', { token: u.token, body });
    await t.ok('roster.abandon', { token: u.token, params: { importId: next.importId } });
    assert.equal((await t.call('roster.get', { token: u.token, params: { importId: next.importId } })).status, 404);
    const deleted = await t.ok('roster.import', { token: u.token, body }); owners.delete(u.id);
    assert.equal((await t.call('roster.get', { token: u.token, params: { importId: deleted.importId } })).status, 404);
  } finally { t.close(); }
});
test('remap is deterministic and cannot resurrect LRN or guardian cells', async () => {
  const { t, owners } = harness();
  try {
    const u = await t.registerUser(); owners.add(u.id);
    const draft = await t.ok('roster.import', { token: u.token, body: { classId, filename: 'names.txt', text: 'First name\tLast name\tLRN\tGrade\nMiro\tPeña\t123456789012\t3', useAi: false } });
    const params = { importId: draft.importId };
    assert.ok(!JSON.stringify(draft).includes('123456789012'));
    assert.equal((await t.call('roster.remap', { token: u.token, params, body: { columns: [{ index: 2, field: 'fullName' }] } })).status, 400);
    const changed = await t.ok('roster.remap', { token: u.token, params, body: { columns: [{ index: 0, field: 'familyName' }, { index: 1, field: 'givenName' }] } });
    assert.equal(changed.rows[1]!.proposed.familyName, 'Miro');
  } finally { t.close(); }
});
test('partial save returns resolved rows once and preserves pending rows', async () => {
  const { t, owners } = harness();
  try {
    const u = await t.registerUser(); owners.add(u.id);
    const draft = await t.ok('roster.import', { token: u.token, body: { classId, filename: 'names.txt', text: 'Name\tGrade\nPeña, Miro A.\t3\nJona Lira\t3', useAi: false } });
    const params = { importId: draft.importId };
    const first = await t.ok('roster.confirm', { token: u.token, params, body: { resolutions: [] } });
    assert.equal(first.students.length, 1); assert.deepEqual(first.pendingRows, [2]);
    const second = await t.ok('roster.confirm', { token: u.token, params, body: { resolutions: [] } }); assert.equal(second.students.length, 0);
    const third = await t.ok('roster.confirm', { token: u.token, params, body: { resolutions: [{ rowIndex: 2, action: 'split', students: [{ ...emptyName('Jona'), grade: '3' }, { ...emptyName('Lira'), grade: '3' }] }] } });
    assert.equal(third.students.length, 2);
  } finally { t.close(); }
});
test('exactly as written preserves lines, spacing and initials', async () => {
  const calls: LlmRequest<unknown>[] = []; const { t, owners } = harness(gateway({}, 'cloud', calls));
  try { const u = await t.registerUser(); owners.add(u.id);
    const draft = await t.ok('roster.import', { token: u.token, body: { classId, filename: 'names.txt', text: '  Ma. Miro Peña  \nJ. Reyes', useAi: true, exactlyAsWritten: true } });
    assert.equal(draft.rows[0]!.proposed.displayName, '  Ma. Miro Peña  '); assert.equal(draft.rows[0]!.proposed.givenName, ''); assert.equal(calls.length, 0);
  } finally { t.close(); }
});
for (const format of ['xlsx','xls','ods'] as const) test(`${format} reader supports sheets and ignores formula cache`, async () => {
  const book = XLSX.utils.book_new(), sheet = XLSX.utils.aoa_to_sheet([['Name','Grade'],['Peña, Miro A.',3],['formula',3]]);
  sheet['A3'] = { t: 's', f: 'CONCAT("bad")', v: 'Invented Surname' };
  XLSX.utils.book_append_sheet(book, sheet, 'Test list');
  const bytes = XLSX.write(book, { type: 'buffer', bookType: format });
  const result = await readRoster({ bytes, extension: format, maxRows: 500 });
  assert.equal(result.rows[1]![0], 'Peña, Miro A.'); if (format !== 'xls') assert.equal(result.rows[2]![0], '[formula omitted]'); // SheetJS writes XLS formula fixtures as literal values.
  assert.deepEqual(result.sheets, ['Test list']);
});
test('docx paragraphs and tables are data only; entities and oversized files refused', async () => {
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>List</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Peña, Miro A.</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const result = await readRoster({ bytes: zipSync({ 'word/document.xml': strToU8(xml) }), extension: 'docx', maxRows: 500 });
  assert.deepEqual(result.rows, [['List'],['Peña, Miro A.','3']]);
  await assert.rejects(readRoster({ bytes: zipSync({ 'word/document.xml': strToU8('<!DOCTYPE root [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml) }), extension: 'docx', maxRows: 500 }));
  await assert.rejects(readRoster({ bytes: new Uint8Array(12), extension: 'txt', maxRows: 500 }, 10));
});
test('column requests mask all samples and never include sensitive context', async () => {
  const calls: LlmRequest<unknown>[] = []; const { t, owners } = harness(gateway({ columns: [{ index: 1, field: 'givenName' }] }, 'local', calls));
  try {
    const u = await t.registerUser(); owners.add(u.id);
    const draft = await t.ok('roster.import', { token: u.token, body: { classId, filename: 'private-class.xlsx', text: 'Name\tUnusual\tAddress\tGrade\nPeña, Miro A.\tPRIVATE_GUARDIAN\t99 Private Street\t3', useAi: true } });
    assert.equal(calls.length, 1); assert.equal(calls[0]!.feature, 'roster.columns');
    for (const value of ['Peña','PRIVATE_GUARDIAN','99 Private Street','private-class',classId]) assert.ok(!JSON.stringify(calls[0]!.vars).includes(value));
    assert.equal(draft.columns[1]!.field, 'ignore');
  } finally { t.close(); }
});
test('rules and off never call a model; teacher disabling AI overrides cloud', async () => {
  for (const route of ['rules','off','cloud'] as const) {
    const calls: LlmRequest<unknown>[] = []; const { t, owners } = harness(gateway({}, route, calls));
    try { const u = await t.registerUser(); owners.add(u.id);
      const draft = await t.ok('roster.import', { token: u.token, body: { classId, filename: 'names.txt', text: pasted, useAi: route !== 'cloud' } });
      assert.equal(calls.length, 0); assert.equal(draft.aiUsed, false);
    } finally { t.close(); }
  }
});
test('model cannot infer sex, grade, local ID or silently remove a name', async () => {
  for (const value of [{ ...emptyName('Miro Peña'), sex: 'M' }, { ...emptyName('Miro Peña'), grade: '3' }, { ...emptyName('Miro Peña'), localId: 'L-1' }, emptyName('Miro')]) {
    const { t, owners } = harness(gateway({ rows: [{ rowIndex: 0, proposed: value }] }));
    try { const u = await t.registerUser(); owners.add(u.id);
      const draft = await t.ok('roster.import', { token: u.token, body: { classId, filename: 'names.txt', text: 'Miro Peña', useAi: true } });
      assert.ok(draft.rows[0]!.flags.includes('untraceable_output')); assert.equal(draft.rows[0]!.proposed.displayName, 'Miro Peña');
    } finally { t.close(); }
  }
});
test('readers reject malformed archives, missing sheets, unsupported formats and excessive rows', async () => {
  await assert.rejects(readRoster({ bytes: strToU8('not a workbook'), extension: 'docx', maxRows: 500 }));
  await assert.rejects(readRoster({ bytes: strToU8('a\nb\nc'), extension: 'txt', maxRows: 2 }));
  await assert.rejects(readRoster({ bytes: strToU8('name'), extension: 'pdf', maxRows: 500 }));
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Name'],['Miro Peña']]), 'Only sheet');
  await assert.rejects(readRoster({ bytes: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), extension: 'xlsx', maxRows: 500, sheet: 'missing' }));
});
