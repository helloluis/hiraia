import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine, createMemoryStore } from './index';
import { parseRecordData } from '../contracts/records';
import type { RecordEnvelope } from '../contracts/records';
import type { SyncTransport, MutationResult, Mutation, LocalStore } from '../contracts/sync';
const at = '2026-11-13T12:00:00.000Z';
class Server implements SyncTransport {
  records = new Map<string, RecordEnvelope>();
  results = new Map<string, MutationResult>();
  log: RecordEnvelope[] = [];
  offline = false;
  loseResponse = false;
  pullFailureAt = -1;
  pulls = 0;
  requests: Mutation[][] = [];
  async push({ mutations }: { mutations: Mutation[] }) {
    if (this.offline) throw new TypeError('Network unavailable');
    this.requests.push(JSON.parse(JSON.stringify(mutations)));
    const results = mutations.map((m) => {
      const previous = this.results.get(m.mutationId);
      if (previous) return previous;
      const key = `${m.entity}:${m.id}`,
        old = this.records.get(key);
      let result: MutationResult;
      const section = m.data as { planId?: string; key?: string } | undefined;
      const parent = section?.planId ? this.records.get(`plan:${section.planId}`) : null;
      if (
        m.entity === 'plan_section' &&
        (parent?.data as { state?: string })?.state === 'locked' &&
        section?.key !== 'reflection'
      )
        result = { mutationId: m.mutationId, status: 'locked', record: old ?? null };
      else if (old && m.baseRev !== old.rev && !(old.deletedAt && m.op === 'upsert'))
        result = { mutationId: m.mutationId, status: 'conflict', record: old };
      else {
        const r: RecordEnvelope = {
          entity: m.entity,
          id: m.id,
          rev: (old?.rev ?? 0) + 1,
          updatedAt: at,
          deletedAt: m.op === 'delete' ? at : null,
          data: parseRecordData(m.entity, m.op === 'delete' ? old?.data : m.data),
        };
        this.records.set(key, r);
        this.log.push(r);
        result = { mutationId: m.mutationId, status: 'applied', record: r };
      }
      this.results.set(m.mutationId, result);
      return result;
    });
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new TypeError('Lost response');
    }
    return { results };
  }
  async pull(query: { cursor?: string }) {
    if (this.offline || this.pulls++ === this.pullFailureAt)
      throw new TypeError('Network unavailable');
    const start = Number(query.cursor ?? 0),
      end = Math.min(start + 2, this.log.length);
    return {
      records: this.log.slice(start, end),
      cursor: String(end),
      hasMore: end < this.log.length,
      serverTime: at,
    };
  }
}
let device = 0;
function client(server: SyncTransport, store: LocalStore = createMemoryStore()) {
  const prefix = `device${++device}`;
  let n = 0;
  return {
    store,
    engine: createSyncEngine({
      store,
      transport: server,
      deviceId: prefix,
      newId: () => `${prefix}.${++n}`,
      now: () => new Date(at),
    }),
  };
}
const note = (id = 'note0001', text = 'first') =>
  parseRecordData('day_note', { id, classId: 'class001', date: '2026-11-13', text });
const plan = () =>
  parseRecordData('plan', {
    id: 'plan0001',
    templateId: 'tpl.dlp.v1',
    language: 'fil',
    grades: ['3'],
    durationMinutes: 50,
  });
const section = (id = 'section1', text = 'first') =>
  parseRecordData('plan_section', {
    id,
    planId: 'plan0001',
    key: 'content',
    content: { type: 'text', blocks: [{ t: 'p', spans: [{ text }] }] },
  });
test('local validation, durable outbox, detached reads, notification and unsubscribe', async () => {
  const s = new Server(),
    { engine: e, store } = client(s);
  let count = 0;
  const stop = e.subscribe(() => count++);
  e.subscribe(() => {
    throw new Error('observer');
  });
  await e.put('day_note', note());
  assert.equal((await store.outbox()).length, 1);
  const r = await e.get('day_note', 'note0001');
  r!.data.text = 'mutated';
  assert.equal((await e.get('day_note', 'note0001'))!.data.text, 'first');
  await assert.rejects(e.put('day_note', { ...note(), text: 'x'.repeat(4001) }));
  stop();
  await e.remove('day_note', 'note0001');
  assert.equal(count, 1);
  assert.equal((await e.list('day_note')).length, 0);
});
test('offline report keeps work; lost response replays identical payload after new edit and engine restart', async () => {
  const s = new Server(),
    { engine: e, store } = client(s);
  await e.put('day_note', note());
  s.offline = true;
  assert.equal((await e.sync()).error, 'offline');
  s.offline = false;
  s.loseResponse = true;
  assert.equal((await e.sync()).ok, false);
  await e.put('day_note', note('note0001', 'second'));
  const restarted = client(s, store).engine;
  assert.equal((await restarted.sync()).ok, true);
  assert.deepEqual(s.requests[0], s.requests[1]);
  assert.equal(s.records.get('day_note:note0001')!.rev, 2);
  assert.equal((await restarted.get('day_note', 'note0001'))!.data.text, 'second');
  assert.equal((await restarted.status()).pending, 0);
});
test('two devices merge changed fields without discarding unrelated remote edits', async () => {
  const s = new Server(),
    a = client(s).engine,
    b = client(s).engine;
  await a.put('day_note', note());
  await a.sync();
  await b.sync();
  await a.put('day_note', { ...note(), text: 'A' });
  await b.put('day_note', { ...note(), date: '2026-11-14' });
  await a.sync();
  await b.sync();
  await a.sync();
  assert.deepEqual((await a.get('day_note', 'note0001'))!.data, {
    ...note(),
    text: 'A',
    date: '2026-11-14',
  });
});
for (const choice of ['mine', 'theirs', 'both'] as const)
  test(`section conflicts retain versions and resolve ${choice}`, async () => {
    const s = new Server(),
      a = client(s).engine,
      b = client(s).engine;
    await a.put('plan_section', section());
    await a.sync();
    await b.sync();
    await a.put('plan_section', section('section1', 'A'));
    await b.put('plan_section', section('section1', 'B'));
    await a.sync();
    assert.equal((await b.sync()).conflicts, 1);
    assert.equal((await b.status()).conflicts, 1);
    await b.resolveConflict('plan_section', 'section1', choice);
    await b.sync();
    const content = (await b.get('plan_section', 'section1'))!.data.content;
    assert.equal(content.type, 'text');
    if (content.type === 'text')
      assert.deepEqual(
        content.blocks.map((x) => (x.t === 'p' ? x.spans[0]!.text : '')),
        choice === 'both' ? ['B', 'A'] : [choice === 'mine' ? 'B' : 'A']
      );
  });
test('edit wins against deletion', async () => {
  const s = new Server(),
    a = client(s).engine,
    b = client(s).engine;
  await a.put('day_note', note());
  await a.sync();
  await b.sync();
  await a.remove('day_note', 'note0001');
  await a.sync();
  await b.put('day_note', note('note0001', 'restored'));
  await b.sync();
  assert.equal(s.records.get('day_note:note0001')!.deletedAt, null);
});
test('pull page cursor and records survive interruption atomically', async () => {
  const s = new Server(),
    a = client(s).engine,
    b = client(s);
  for (let i = 0; i < 5; i++) await a.put('day_note', note(`note000${i}`));
  await a.sync();
  s.pulls = 0;
  s.pullFailureAt = 1;
  assert.equal((await b.engine.sync()).ok, false);
  assert.equal(await b.store.getMeta('sync.cursor'), '2');
  assert.equal((await b.engine.list('day_note')).length, 2);
  s.pullFailureAt = -1;
  await client(s, b.store).engine.sync();
  assert.equal((await b.engine.list('day_note')).length, 5);
});
test('lock creates a single full draft preserving all rejected section edits', async () => {
  const s = new Server(),
    a = client(s).engine,
    b = client(s).engine;
  await a.put('plan', plan());
  await a.put('plan_section', section());
  await a.put('plan_section', section('section2'));
  await a.sync();
  await b.sync();
  await a.put('plan', {
    ...plan(),
    state: 'locked',
    lock: { lockedBy: '', lockedAt: at, revisionCode: 'ABC', revision: 1 },
  });
  await a.sync();
  await b.put('plan_section', section('section1', 'B'));
  await b.put('plan_section', section('section2', 'C'));
  const report = await b.sync();
  assert.equal(report.ok, true);
  assert.equal(report.lockCopies.length, 1);
  const draft = (await b.get('plan', report.lockCopies[0]!))!;
  assert.equal(draft.data.conflictCopyOf, 'plan0001');
  assert.equal(draft.data.state, 'draft');
  assert.equal((await b.list('plan_section')).filter((x) => x.data.planId === draft.id).length, 2);
});
test('edits during a suspended push are saved immediately and not lost on acknowledgement', async () => {
  const s = new Server();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  let first = true;
  const e = client({
    pull: (q) => s.pull(q),
    push: async (q) => {
      if (first) {
        first = false;
        entered();
        await gate;
      }
      return s.push(q);
    },
  }).engine;
  await e.put('day_note', note());
  const syncing = e.sync();
  await started;
  await e.put('day_note', note('note0001', 'while sending'));
  assert.equal((await e.get('day_note', 'note0001'))!.data.text, 'while sending');
  release();
  await syncing;
  assert.equal(
    (s.records.get('day_note:note0001')!.data as { text: string }).text,
    'while sending'
  );
});
test('batches never exceed 100; repeated sync does not add revisions', async () => {
  const s = new Server(),
    e = client(s).engine;
  for (let i = 0; i < 205; i++) await e.put('day_note', note(`note000${i}`));
  assert.equal((await e.sync()).pushed, 205);
  await e.sync();
  assert.ok(s.requests.every((r) => r.length <= 100));
  assert.equal(s.log.length, 205);
});

test('real TalaApiError network and timeout are offline; authentication is distinct', async () => {
  const { TalaApiError } = await import('../contracts/client');
  for (const code of ['network', 'timeout', 'unauthenticated', 'unavailable'] as const) {
    const fail = async (): Promise<never> => {
      throw new TalaApiError(code, 'test');
    };
    const e = client({ push: fail, pull: fail }).engine;
    const report = await e.sync();
    assert.equal(
      report.error,
      code === 'unauthenticated' ? 'unauthenticated' : code === 'unavailable' ? 'server' : 'offline'
    );
  }
});
test('terminal rejection preserves text and does not poison later outbox work', async () => {
  const s = new Server();
  const { engine: e, store } = client({
    pull: (q) => s.pull(q),
    push: async (q) => ({
      results: await Promise.all(
        q.mutations.map(async (m) =>
          m.id === 'rejected'
            ? { mutationId: m.mutationId, status: 'invalid' as const, record: null }
            : (await s.push({ mutations: [m] })).results[0]!
        )
      ),
    }),
  });
  await e.put('day_note', note('rejected', 'keep this text'));
  await e.put('day_note', note('accepted'));
  const report = await e.sync();
  assert.equal(report.ok, true);
  assert.equal(report.conflicts, 1);
  assert.equal((await e.status()).pending, 0);
  assert.equal((await e.get('day_note', 'rejected'))!.data.text, 'keep this text');
  assert.ok(await store.getMeta('sync.rejected.rejected'));
  assert.ok(s.records.has('day_note:accepted'));
  assert.equal((await e.sync()).pushed, 0);
});
test('unknown entities and newer record shapes are skipped without pinning cursor', async () => {
  const { engine: e, store } = client({
    push: async () => ({ results: [] }),
    pull: async () => ({
      records: [
        {
          entity: 'future_entity',
          id: 'future01',
          rev: 1,
          updatedAt: at,
          deletedAt: null,
          data: {},
        },
        { entity: 'day_note', id: 'future02', rev: 1, updatedAt: at, deletedAt: null, data: {} },
        {
          entity: 'day_note',
          id: 'valid001',
          rev: 1,
          updatedAt: at,
          deletedAt: null,
          data: note('valid001'),
        },
      ],
      cursor: '3',
      hasMore: false,
      serverTime: at,
    }),
  } as unknown as SyncTransport);
  const report = await e.sync();
  assert.equal(report.ok, true);
  assert.equal(report.skipped, 2);
  assert.equal(await store.getMeta('sync.cursor'), '3');
  assert.ok(await e.get('day_note', 'valid001'));
});

test('failed durable commit never acknowledges or partially saves a local edit', async () => {
  const memory = createMemoryStore();
  const failing: LocalStore = {
    ...memory,
    commit: async () => {
      throw new Error('storage full');
    },
  };
  const e = client(new Server(), failing).engine;
  await assert.rejects(e.put('day_note', note()), /storage full/);
  assert.equal(await memory.get('day_note', 'note0001'), null);
  assert.equal((await memory.outbox()).length, 0);
});
test('status hydrates once rather than scanning records on every poll', async () => {
  const memory = createMemoryStore();
  let scans = 0;
  const store: LocalStore = {
    ...memory,
    list: async (...args) => {
      scans++;
      return memory.list(...args);
    },
  };
  const e = client(new Server(), store).engine;
  await e.status();
  const initial = scans;
  for (let i = 0; i < 20; i++) await e.status();
  assert.ok(initial > 0);
  assert.equal(scans, initial);
});
test('different sections edited on two devices need no teacher conflict', async () => {
  const s = new Server(),
    a = client(s).engine,
    b = client(s).engine;
  await a.put('plan_section', section('section1'));
  await a.put('plan_section', section('section2'));
  await a.sync();
  await b.sync();
  await a.put('plan_section', section('section1', 'A'));
  await b.put('plan_section', section('section2', 'B'));
  assert.equal((await a.sync()).conflicts, 0);
  assert.equal((await b.sync()).conflicts, 0);
  await a.sync();
  assert.deepEqual(
    (await a.list('plan_section')).map((r) => r.data),
    (await b.list('plan_section')).map((r) => r.data)
  );
});
test('student keep-both is atomic, including when the store is full', async () => {
  const s = new Server(),
    a = client(s).engine,
    memory = createMemoryStore();
  let full = false;
  const b = client(s, {
    ...memory,
    commit: async (batch) => {
      if (full) throw new Error('full');
      return memory.commit(batch);
    },
  }).engine;
  const student = parseRecordData('student', {
    id: 'student1',
    classId: 'class001',
    displayName: 'Original',
  });
  await a.put('student', student);
  await a.sync();
  await b.sync();
  await a.put('student', { ...student, displayName: 'A' });
  await b.put('student', { ...student, displayName: 'B' });
  await a.sync();
  await b.sync();
  full = true;
  await assert.rejects(b.resolveConflict('student', student.id, 'both'));
  assert.equal((await b.list('student')).length, 1);
  assert.equal((await b.status()).conflicts, 1);
  full = false;
  await b.resolveConflict('student', student.id, 'both');
  await b.sync();
  assert.deepEqual((await b.list('student')).map((r) => r.data.displayName).sort(), ['A', 'B']);
  assert.equal((await b.status()).conflicts, 0);
});
test('new rejected section exists only in lock draft, not as an unsynced ghost in locked original', async () => {
  const s = new Server(),
    a = client(s).engine,
    b = client(s).engine;
  await a.put('plan', plan());
  await a.sync();
  await b.sync();
  await a.put('plan', {
    ...plan(),
    state: 'locked',
    lock: { lockedBy: 'Guro Peña', lockedAt: at, revisionCode: 'ABC', revision: 1 },
  });
  await a.sync();
  await b.put('plan_section', section('newsect1', 'Keep new content'));
  const report = await b.sync();
  assert.equal(report.lockCopies.length, 1);
  assert.ok(!(await b.list('plan_section')).some((r) => r.data.planId === 'plan0001'));
  assert.equal(
    (await b.list('plan_section')).filter((r) => r.data.planId === report.lockCopies[0]).length,
    1
  );
});
for (const status of ['forbidden', 'locked'] as const)
  test(`terminal ${status} for non-section is retained without blocking next sync`, async () => {
    const s = new Server();
    let calls = 0;
    const { engine: e, store } = client({
      pull: (q) => s.pull(q),
      push: async (q) => {
        calls++;
        return {
          results: q.mutations.map((m) => ({ mutationId: m.mutationId, status, record: null })),
        };
      },
    });
    await e.put('day_note', note());
    const report = await e.sync();
    assert.equal(report.rejected, 1);
    await e.sync();
    assert.equal(calls, 1);
    assert.equal((await e.get('day_note', 'note0001'))!.data.text, 'first');
    assert.ok(await store.getMeta('sync.rejected.note0001'));
  });

test('created then deleted offline accepts applied/null and physically purges its tombstone', async () => {
  const s = new Server();
  const { engine: e, store } = client({
    pull: (q) => s.pull(q),
    push: async (q) => ({
      results: q.mutations.map((m) => ({
        mutationId: m.mutationId,
        status: 'applied' as const,
        record: null,
      })),
    }),
  });
  await e.put('day_note', note());
  await e.remove('day_note', 'note0001');
  const report = await e.sync();
  assert.equal(report.pushed, 1);
  assert.equal(report.rejected, 0);
  assert.equal(await store.get('day_note', 'note0001'), null);
  assert.equal((await store.outbox()).length, 0);
});
for (const entity of ['day_note', 'student'] as const)
  test(`live edit wins against stale ${entity} deletion`, async () => {
    const s = new Server(),
      a = client(s).engine,
      b = client(s).engine;
    const data =
      entity === 'day_note'
        ? note()
        : parseRecordData('student', {
            id: 'student1',
            classId: 'class001',
            displayName: 'Original',
          });
    await a.put(entity, data);
    await a.sync();
    await b.sync();
    await b.remove(entity, data.id);
    const edit =
      entity === 'day_note' ? { ...data, text: 'Edited' } : { ...data, displayName: 'Edited' };
    await a.put(entity, parseRecordData(entity, edit));
    await a.sync();
    const report = await b.sync();
    assert.equal(report.conflicts, 0);
    assert.deepEqual((await b.get(entity, data.id))!.data, parseRecordData(entity, edit));
    assert.equal(s.records.get(`${entity}:${data.id}`)!.deletedAt, null);
    assert.equal((await b.status()).pending, 0);
  });
test('minimal scrubbed learner tombstone purges private data and cannot be displayed or replay-resurrected', async () => {
  const s = new Server(),
    { engine: e, store } = client(s);
  await e.put(
    'student',
    parseRecordData('student', {
      id: 'student1',
      classId: 'class001',
      displayName: 'Private learner',
    })
  );
  await e.sync();
  // Even an older client's schema may not understand the scrubbed placeholder; envelope still carries deletion.
  s.log.push({
    entity: 'student',
    id: 'student1',
    rev: 2,
    updatedAt: at,
    deletedAt: at,
    data: {},
  } as RecordEnvelope);
  const report = await e.sync();
  assert.equal(report.skipped, 0);
  assert.equal(await e.get('student', 'student1'), null);
  assert.equal(await store.get('student', 'student1'), null);
  assert.deepEqual(await e.list('student'), []);
  // A replayed pre-deletion live revision must not revive the removed row.
  s.log.push(s.log[0]!);
  await e.sync();
  assert.equal(await e.get('student', 'student1'), null);
});
test('acknowledged scrubbed learner deletion physically removes local data', async () => {
  const s = new Server(),
    { engine: e, store } = client({
      pull: (q) => s.pull(q),
      push: async (q) => {
        const response = await s.push(q);
        return {
          results: response.results.map((r) =>
            r.record?.deletedAt ? { ...r, record: { ...r.record, data: {} } } : r
          ),
        };
      },
    });
  await e.put(
    'student',
    parseRecordData('student', {
      id: 'student1',
      classId: 'class001',
      displayName: 'Private learner',
    })
  );
  await e.sync();
  await e.remove('student', 'student1');
  assert.equal(await e.get('student', 'student1'), null);
  await e.sync();
  assert.equal(await store.get('student', 'student1'), null);
});

test('a deletion followed by a real restoration within one pull page keeps the newest live revision', async () => {
  const base = { entity: 'day_note' as const, id: 'note0001', updatedAt: at, data: note() };
  const e = client({
    push: async () => ({ results: [] }),
    pull: async () => ({
      records: [
        { ...base, rev: 1, deletedAt: null },
        { ...base, rev: 2, deletedAt: at, data: {} },
        { ...base, rev: 3, deletedAt: null, data: note('note0001', 'Restored') },
      ],
      cursor: '3',
      hasMore: false,
      serverTime: at,
    }),
  }).engine;
  assert.equal((await e.sync()).ok, true);
  assert.equal((await e.get('day_note', 'note0001'))!.data.text, 'Restored');
});

test('batch commits dependent records and outbox together with one notification', async () => {
  const memory = createMemoryStore();
  let commits = 0;
  const { engine: e } = client(new Server(), {
    ...memory,
    commit: async (b) => {
      commits++;
      await memory.commit(b);
    },
  });
  const changes: unknown[] = [];
  e.subscribe((value) => changes.push(value));
  await e.batch!([
    { op: 'put', entity: 'plan', data: plan() },
    { op: 'put', entity: 'plan_section', data: section() },
    { op: 'put', entity: 'day_note', data: note() },
    { op: 'remove', entity: 'day_note', id: 'note0001' },
  ]);
  assert.equal(commits, 1);
  assert.equal(changes.length, 1);
  assert.equal((changes[0] as unknown[]).length, 3);
  assert.equal((await memory.outbox()).length, 3);
  assert.equal(await e.get('day_note', 'note0001'), null);
  assert.ok(await e.get('plan_section', 'section1'));
});
test('batch rejects invalid later input before any write; failed mid-transaction stages publish nothing', async () => {
  const memory = createMemoryStore();
  let attempts = 0,
    notifications = 0,
    fail = true;
  const adapter: LocalStore = {
    ...memory,
    commit: async (b) => {
      attempts++;
      // A transactional adapter works on private staged state until COMMIT.
      const transaction = new Map();
      for (const record of b.put ?? []) {
        transaction.set(record.id, record);
        if (fail && transaction.size === 2) throw new Error('simulated crash before COMMIT');
      }
      await memory.commit(b);
    },
  };
  const e = client(new Server(), adapter).engine;
  e.subscribe(() => notifications++);
  await assert.rejects(
    e.batch!([
      { op: 'put', entity: 'plan', data: plan() },
      { op: 'put', entity: 'plan_section', data: {} },
    ])
  );
  assert.equal(attempts, 0);
  const ops = [
    { op: 'put' as const, entity: 'plan' as const, data: plan() },
    { op: 'put' as const, entity: 'plan_section' as const, data: section() },
  ];
  await assert.rejects(e.batch!(ops), /simulated crash/);
  const restarted = client(new Server(), memory).engine;
  assert.equal(await restarted.get('plan', 'plan0001'), null);
  assert.equal(await restarted.get('plan_section', 'section1'), null);
  assert.equal((await memory.outbox()).length, 0);
  assert.equal(notifications, 0);
  fail = false;
  await e.batch!(ops);
  assert.equal(notifications, 1);
  assert.equal((await memory.outbox()).length, 2);
});
test('batch during an uncertain push retains immutable replay and queues latest change', async () => {
  const s = new Server(),
    { engine: e, store } = client(s);
  await e.put('day_note', note());
  s.loseResponse = true;
  await e.sync();
  await e.batch!([{ op: 'put', entity: 'day_note', data: note('note0001', 'batched edit') }]);
  assert.equal((await store.outbox()).length, 2);
  await e.sync();
  assert.deepEqual(s.requests[0], s.requests[1]);
  assert.equal((await e.get('day_note', 'note0001'))!.data.text, 'batched edit');
});
test('fetchPlans paginates compatibility hydration without touching the main cursor or unsent edits', async () => {
  const requests: Array<{ cursor?: string; planIds?: string }> = [];
  const records = [
    {
      entity: 'plan' as const,
      id: 'plan0001',
      rev: 1,
      updatedAt: at,
      deletedAt: null,
      data: plan(),
    },
    {
      entity: 'plan_section' as const,
      id: 'section1',
      rev: 2,
      updatedAt: at,
      deletedAt: null,
      data: section('section1', 'remote'),
    },
  ];
  const { engine: e, store } = client({
    push: async () => {
      throw new Error('Fetch must not push');
    },
    pull: async (q) => {
      requests.push(q);
      return q.cursor
        ? { records: [records[1]!], cursor: '', hasMore: false, serverTime: at }
        : {
            records: [
              records[0]!,
              { entity: 'future', id: 'future1', rev: 1, updatedAt: at, deletedAt: null, data: {} },
            ],
            cursor: 'target-page2',
            hasMore: true,
            serverTime: at,
          };
    },
  });
  await store.commit({ meta: { 'sync.cursor': 'main-cursor', 'sync.lastSyncedAt': at } });
  await e.put('plan_section', section('section1', 'local edit'));
  const report = await e.fetchPlans!(['plan0001', 'plan0001']);
  assert.equal(report.ok, true);
  assert.equal(report.skipped, 1);
  assert.equal(report.pulled, 3);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.cursor, undefined);
  assert.equal(requests[1]!.cursor, 'target-page2');
  assert.ok(requests.every((q) => q.planIds === 'plan0001'));
  assert.equal(await store.getMeta('sync.cursor'), 'main-cursor');
  assert.equal(await store.getMeta('sync.lastSyncedAt'), at);
  assert.deepEqual(
    (await e.get('plan_section', 'section1'))!.data,
    section('section1', 'local edit')
  );
  assert.equal((await e.status()).pending, 1);
});
test('fetchPlans reports interrupted pages, can retry, and does not advance normal progress', async () => {
  let offline = true;
  const { engine: e, store } = client({
    push: async () => ({ results: [] }),
    pull: async () => {
      if (offline) throw new TypeError('offline');
      return { records: [], cursor: '', hasMore: false, serverTime: at };
    },
  });
  await store.commit({ meta: { 'sync.cursor': 'main' } });
  assert.equal((await e.fetchPlans!(['plan0001'])).error, 'offline');
  assert.equal(await store.getMeta('sync.cursor'), 'main');
  offline = false;
  assert.equal((await e.fetchPlans!(['plan0001'])).ok, true);
  assert.equal((await e.fetchPlans!([])).pulled, 0);
  await assert.rejects(e.fetchPlans!(['bad,id']));
});
