/** Roster import: client helpers, plus the real roster module end to end (paste → review → confirm → students). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestServer } from '@hiraia/tala-server/testing';
import { modules } from '@hiraia/tala-server';
import { createMemoryStore, createSyncEngine } from '@hiraia/tala-core/sync';
import type { ClassRecord, RosterImportDraft } from '@hiraia/tala-core/contracts';
import { buildConfirm, groupRows, proposedToStudent, saveStudents, unresolvedRows, type Resolution } from './roster';

let n = 0;
const newId = () => `s${++n}`;
const rosterModule = modules.find(m => m.name === 'roster')!;

const cls = (id: string): ClassRecord => ({ id, schoolYearId: 'sy', name: 'Grade 3 Mabini', curriculum: 'deped', gradeGroups: [{ id: 'g3', grade: '3', learnerCount: null }], languages: ['fil'], profile: { materials: [], textbooks: [], electricity: null, projector: null, printing: null, outdoorSpace: null, notes: '' }, isSample: false, archived: false });

test('pasted names go through the real roster module and come back as PRIV-1 student records', async () => {
  const t = createTestServer({ modules: [rosterModule], quiet: true });
  try {
    const teacher = await t.registerUser();
    const engine = createSyncEngine({ store: createMemoryStore(), transport: t.client(teacher.token).syncTransport, deviceId: 'web', now: () => new Date(), newId });
    await engine.put('class', cls('c1'));
    await engine.sync();
    const text = ['Pangalan', 'DELA CRUZ, Juan Miguel S.', 'Reyes, Maria Clara', 'Santos, Jose Jr.', 'TOTAL: 3'].join('\n');
    const draft = (await t.ok('roster.import', { body: { classId: 'c1', filename: 'list.txt', text, useAi: false, cloudFlagAcknowledged: false, exactlyAsWritten: false }, token: teacher.token })) as RosterImportDraft;
    assert.ok(draft.rows.length >= 3);
    assert.equal(draft.aiUsed, false);
    const groups = groupRows(draft.rows);
    const resolutions = new Map<number, Resolution>();
    for (const r of groups.needsReview) resolutions.set(r.rowIndex, { rowIndex: r.rowIndex, action: 'accept' });
    assert.equal(unresolvedRows(draft, resolutions).length, 0);
    const body = buildConfirm(draft, resolutions, { acceptAllChanged: true, defaultGradeGroupId: 'g3', idempotencyKey: 'idem-1', onlyResolved: false });
    const res = await t.ok('roster.confirm', { params: { importId: draft.importId }, body, token: teacher.token });
    assert.ok(res.students.length >= 3, `expected students, got ${res.students.length}`);
    const students = res.students.map((p, i) => proposedToStudent(p, 'c1', i, draft.importId, newId));
    for (const s of students) {
      assert.deepEqual(Object.keys(s).sort(), ['classId', 'displayName', 'familyName', 'givenName', 'gradeGroupId', 'id', 'importId', 'localId', 'middleName', 'order', 'sex', 'suffix']);
      assert.ok(s.displayName.length > 0);
    }
    await saveStudents(engine, students);
    assert.equal((await engine.list('student')).length, students.length);
    // Retrying the same confirm with the same key is safe (RES-5).
    const again = await t.call('roster.confirm', { params: { importId: draft.importId }, body, token: teacher.token });
    assert.ok(again.ok || again.status === 404, 'idempotent or draft already deleted');
  } finally {
    t.close();
  }
});

test('buildConfirm leaves clean rows out when saving only resolved rows', () => {
  const draft = { rows: [{ rowIndex: 0, status: 'clean' }, { rowIndex: 1, status: 'needs_review' }] } as unknown as RosterImportDraft;
  const res = new Map<number, Resolution>([[1, { rowIndex: 1, action: 'keep_original' }]]);
  assert.deepEqual(buildConfirm(draft, res, { acceptAllChanged: false, defaultGradeGroupId: null, idempotencyKey: 'k', onlyResolved: true }).resolutions.map(r => r.rowIndex), [1]);
  assert.deepEqual(buildConfirm(draft, res, { acceptAllChanged: false, defaultGradeGroupId: null, idempotencyKey: 'k', onlyResolved: false }).resolutions.map(r => r.rowIndex).sort(), [0, 1]);
});
