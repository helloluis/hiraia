/**
 * End to end: the web LocalStore on IndexedDB (fake-indexeddb) + the shared sync engine + the REAL Tala server
 * (worker A's kernel through `@hiraia/tala-server/testing`) via the real typed client.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createSyncEngine } from '@hiraia/tala-core/sync';
import { createTestServer } from '@hiraia/tala-server/testing';
import { BUILTIN_TEMPLATES, type ClassRecord, type SyncEngine } from '@hiraia/tala-core/contracts';
import { lockPlan } from '@hiraia/tala-core/plan';
import { createIdbStore } from './idb-store';
import { newPlan } from './plans';

let n = 0;
const newId = () => `id-${++n}-${Math.random().toString(36).slice(2, 8)}`;

function device(t: ReturnType<typeof createTestServer>, token: string, label: string): SyncEngine {
  const store = createIdbStore({ name: `${label}-${Math.random()}`, factory: new IDBFactory() });
  return createSyncEngine({
    store,
    transport: t.client(token).syncTransport,
    deviceId: label,
    now: () => new Date(),
    newId,
  });
}

const cls = (id: string): ClassRecord => ({
  id,
  schoolYearId: 'sy1',
  name: 'Grade 3 Sampaguita',
  curriculum: 'deped',
  gradeGroups: [{ id: 'g3', grade: '3', learnerCount: 20 }],
  languages: ['fil'],
  profile: {
    materials: [],
    textbooks: [],
    electricity: null,
    projector: null,
    printing: null,
    outdoorSpace: null,
    notes: '',
  },
  isSample: false,
  archived: false,
});

test('records written on one device reach another through the real server', async () => {
  const t = createTestServer({ quiet: true });
  try {
    const teacher = await t.registerUser();
    const a = device(t, teacher.token, 'phone');
    const b = device(t, teacher.token, 'laptop');
    await a.put('class', cls('c1'));
    assert.equal((await a.status()).pending, 1);
    const r1 = await a.sync();
    assert.equal(r1.ok, true);
    assert.equal(r1.pushed, 1);
    const r2 = await b.sync();
    assert.equal(r2.ok, true);
    const seen = await b.get('class', 'c1');
    assert.equal(seen?.data.name, 'Grade 3 Sampaguita');
    assert.equal(seen?.rev && seen.rev > 0, true);
    assert.equal((await a.status()).pending, 0);
  } finally {
    t.close();
  }
});

test('a lock made on one device wins over an unsynced edit on another; the edit is kept as a draft copy (DOC-4)', async () => {
  const t = createTestServer({ quiet: true });
  try {
    const teacher = await t.registerUser();
    const a = device(t, teacher.token, 'phone');
    const b = device(t, teacher.token, 'laptop');
    const template = BUILTIN_TEMPLATES[0]!;
    const { plan, sections } = newPlan({
      template,
      cls: cls('c1'),
      assignment: null,
      dates: ['2026-11-17'],
      language: 'fil',
      newId,
    });
    await a.put('class', cls('c1'));
    await a.put('plan', plan);
    for (const s of sections) await a.put('plan_section', s);
    await a.sync();
    await b.sync();
    // Fill required sections on both, then lock on A.
    const filled = (await a.list('plan_section')).map((s) => ({
      ...s.data,
      content:
        s.data.content.type === 'list'
          ? { type: 'list' as const, items: ['x'] }
          : s.data.content.type === 'text'
            ? { type: 'text' as const, blocks: [{ t: 'p' as const, spans: [{ text: 'y' }] }] }
            : s.data.content.type === 'procedure'
              ? {
                  type: 'procedure' as const,
                  steps: [
                    {
                      id: newId(),
                      title: 's',
                      minutes: 5,
                      body: [{ t: 'p' as const, spans: [{ text: 'z' }] }],
                    },
                  ],
                }
              : s.data.content,
    }));
    for (const s of filled) await a.put('plan_section', s);
    const planA = {
      ...(await a.get('plan', plan.id))!.data,
      competencies: { g3: ['dev.science.g3.t1.1'] },
    };
    await a.put('plan', planA);
    const locked = lockPlan({
      plan: planA,
      sections: filled,
      template,
      class: cls('c1'),
      teacherName: 'T',
      at: new Date().toISOString(),
      revision: null,
    });
    await a.put('plan', locked);
    const ra = await a.sync();
    assert.equal(ra.ok, true);
    // Meanwhile B edits a section offline, then syncs.
    const sb = (await b.list('plan_section')).find((s) => s.data.key === 'assessment')!;
    await b.put('plan_section', {
      ...sb.data,
      content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'edited on B' }] }] },
    });
    const rb = await b.sync();
    assert.equal(rb.ok, true);
    assert.equal(rb.lockCopies.length, 1, 'the rejected edit becomes a draft copy');
    const copy = await b.get('plan', rb.lockCopies[0]!);
    assert.equal(copy?.data.conflictCopyOf, plan.id);
    assert.equal(copy?.data.state, 'draft');
    const original = await b.get('plan', plan.id);
    assert.equal(original?.data.state, 'locked');
  } finally {
    t.close();
  }
});

test('offline sync reports offline and keeps the outbox; nothing is lost', async () => {
  const t = createTestServer({ quiet: true });
  try {
    const teacher = await t.registerUser();
    const store = createIdbStore({ name: `off-${Math.random()}`, factory: new IDBFactory() });
    const failing = {
      push: async () =>
        Promise.reject(
          Object.assign(new Error('No connection.'), { code: 'network', retryable: true })
        ),
      pull: async () =>
        Promise.reject(
          Object.assign(new Error('No connection.'), { code: 'network', retryable: true })
        ),
    };
    const offline = createSyncEngine({
      store,
      transport: failing as never,
      deviceId: 'd',
      now: () => new Date(),
      newId,
    });
    await offline.put('class', cls('c9'));
    const r = await offline.sync();
    assert.equal(r.ok, false);
    assert.equal(r.error, 'offline');
    assert.equal((await offline.status()).pending, 1);
    // Same store, now online: the queued write goes through.
    const online = createSyncEngine({
      store,
      transport: t.client(teacher.token).syncTransport,
      deviceId: 'd',
      now: () => new Date(),
      newId,
    });
    const r2 = await online.sync();
    assert.equal(r2.ok, true);
    assert.equal(r2.pushed, 1);
  } finally {
    t.close();
  }
});

test('post-class sections stay writable on a locked plan; a new `results` record created after the lock is accepted; pre-class edits are refused', async () => {
  const t = createTestServer({ quiet: true });
  try {
    const teacher = await t.registerUser();
    const a = device(t, teacher.token, 'phone');
    const b = device(t, teacher.token, 'laptop');
    const template = BUILTIN_TEMPLATES[0]!;
    const { plan, sections } = newPlan({
      template,
      cls: cls('c1'),
      assignment: null,
      dates: ['2026-11-17'],
      language: 'fil',
      newId,
    });
    // Simulate an older plan: no `results` record yet.
    const older = sections.filter((s) => s.key !== 'results');
    const filled = older.map((s) => ({
      ...s,
      content:
        s.content.type === 'list'
          ? { type: 'list' as const, items: ['x'] }
          : s.content.type === 'text'
            ? { type: 'text' as const, blocks: [{ t: 'p' as const, spans: [{ text: 'y' }] }] }
            : s.content.type === 'procedure'
              ? {
                  type: 'procedure' as const,
                  steps: [
                    {
                      id: newId(),
                      title: 's',
                      minutes: 5,
                      body: [{ t: 'p' as const, spans: [{ text: 'z' }] }],
                    },
                  ],
                }
              : s.content,
    }));
    await a.batch([
      { op: 'put', entity: 'class', data: cls('c1') },
      {
        op: 'put',
        entity: 'plan',
        data: { ...plan, competencies: { g3: ['dev.science.g3.t1.1'] } },
      },
      ...filled.map((s) => ({ op: 'put' as const, entity: 'plan_section' as const, data: s })),
    ]);
    const planA = (await a.get('plan', plan.id))!.data;
    const locked = lockPlan({
      plan: planA,
      sections: filled,
      template,
      class: cls('c1'),
      teacherName: 'T',
      at: new Date().toISOString(),
      revision: null,
    });
    await a.put('plan', locked);
    assert.equal((await a.sync()).ok, true);
    await b.sync();
    // Post-class: reflection edit (existing outsideLock section) and a brand-new `results` section.
    const reflection = (await b.list('plan_section')).find(
      (s) => s.data.planId === plan.id && s.data.key === 'reflection'
    )!;
    await b.put('plan_section', {
      ...reflection.data,
      content: {
        type: 'text',
        blocks: [{ t: 'p', spans: [{ text: 'Nagustuhan ng klase ang ramp.' }] }],
      },
      editedByTeacher: true,
    });
    await b.put('plan_section', {
      id: newId(),
      planId: plan.id,
      key: 'results',
      content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: '18 of 25 scored 7+' }] }] },
      origin: 'manual',
      editedByTeacher: true,
      gen: null,
    });
    const rb = await b.sync();
    assert.equal(rb.ok, true);
    assert.equal(rb.lockCopies.length, 0, 'post-class writes must not fork a draft copy');
    assert.equal(rb.rejected, 0, 'post-class writes are accepted on a locked plan');
    await a.sync();
    const onA = (await a.list('plan_section')).filter((s) => s.data.planId === plan.id);
    assert.ok(
      onA.some((s) => s.data.key === 'results'),
      'the new results section reached the other device'
    );
    assert.equal((await a.get('plan', plan.id))!.data.state, 'locked');
    // Pre-class: an assessment edit on the locked plan is refused and kept as a draft copy (DOC-4).
    const assessment = onA.find((s) => s.data.key === 'assessment')!;
    await a.put('plan_section', {
      ...assessment.data,
      content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'changed after lock' }] }] },
    });
    const ra = await a.sync();
    assert.equal(ra.lockCopies.length, 1);
  } finally {
    t.close();
  }
});
