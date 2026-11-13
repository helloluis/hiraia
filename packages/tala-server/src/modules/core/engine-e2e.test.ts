/**
 * The real client sync engine (workstream H, @hiraia/tala-core/sync) against the real server, through the
 * real typed client. Two devices of one teacher, with nothing faked in between.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUILTIN_TEMPLATES,
  parseRecordData,
  plan as planHelpers,
  sync as syncEngine,
} from '@hiraia/tala-core';
import type { Plan, PlanSection, SyncEngine, SyncTransport } from '@hiraia/tala-core';
import { createTestServer } from '../../testing';
import type { TestServer } from '../../testing';

const DLP = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl.dlp.v1')!;

function device(
  t: TestServer,
  token: string,
  name: string,
  wrap: (transport: SyncTransport) => SyncTransport = (x) => x
) {
  let n = 0;
  const store = syncEngine.createMemoryStore();
  const engine: SyncEngine = syncEngine.createSyncEngine({
    store,
    transport: wrap(t.client(token).syncTransport),
    deviceId: `device-${name}`,
    now: () => t.clock.now(),
    newId: () => `${name}-${String(++n).padStart(8, '0')}`,
  });
  return { engine, store };
}

const text = (value: string) => ({
  type: 'text' as const,
  blocks: [{ t: 'p' as const, spans: [{ text: value }] }],
});

async function writePlan(engine: SyncEngine, planId = 'plan-0001') {
  await engine.put(
    'plan',
    parseRecordData('plan', {
      id: planId,
      templateId: DLP.id,
      language: 'fil',
      grades: ['4'],
      durationMinutes: 50,
      title: 'Mga Halaman',
    })
  );
  const contents: Record<string, PlanSection['content']> = {
    objectives: { type: 'list', items: ['Natutukoy ang mga bahagi ng halaman'] },
    materials: { type: 'list', items: ['Tunay na halaman'] },
    procedure: {
      type: 'procedure',
      steps: [
        {
          id: 'step-0001',
          title: 'Panimula',
          minutes: 10,
          body: text('Ipakita ang halaman.').blocks,
        },
      ],
    },
    assessment: text('Iguhit ang halaman.'),
    content: text('Mga bahagi ng halaman'),
    reflection: { type: 'text', blocks: [] },
  };
  for (const [key, content] of Object.entries(contents)) {
    await engine.put(
      'plan_section',
      parseRecordData('plan_section', { id: `${planId}-${key}`, planId, key, content })
    );
  }
}

const sectionText = async (engine: SyncEngine, id: string) =>
  JSON.stringify((await engine.get('plan_section', id))?.data.content);

test('two devices: what one writes offline, the other receives', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  const phone = device(t, u.token, 'phone');
  const laptop = device(t, u.token, 'laptop');

  await writePlan(phone.engine);
  await phone.engine.put(
    'day_note',
    parseRecordData('day_note', {
      id: 'note-0001',
      classId: 'class-0001',
      date: '2026-11-16',
      text: 'Walang pasok dahil sa bagyo',
    })
  );
  const first = await phone.engine.sync();
  assert.deepEqual([first.ok, first.error, first.pushed, first.conflicts], [true, null, 8, 0]);
  assert.equal((await phone.engine.status()).pending, 0);

  const second = await laptop.engine.sync();
  assert.equal(second.ok, true);
  assert.equal((await laptop.engine.get('plan', 'plan-0001'))!.data.title, 'Mga Halaman');
  assert.equal((await laptop.engine.list('plan_section')).length, 6);
  assert.equal((await laptop.engine.get('day_note', 'note-0001'))!.rev, 1);

  // Different parts of the same lesson edited on each device: both survive, nobody is asked anything (§10.5).
  const onPhone = (await phone.engine.get('plan_section', 'plan-0001-assessment'))!.data;
  const onLaptop = (await laptop.engine.get('plan_section', 'plan-0001-content'))!.data;
  await phone.engine.put('plan_section', { ...onPhone, content: text('Pagtataya mula sa phone') });
  await laptop.engine.put('plan_section', {
    ...onLaptop,
    content: text('Nilalaman mula sa laptop'),
  });
  assert.equal((await phone.engine.sync()).conflicts, 0);
  assert.equal((await laptop.engine.sync()).conflicts, 0);
  await phone.engine.sync();
  for (const d of [phone, laptop]) {
    assert.match(await sectionText(d.engine, 'plan-0001-assessment'), /mula sa phone/);
    assert.match(await sectionText(d.engine, 'plan-0001-content'), /mula sa laptop/);
  }

  // Different fields of the plan record: merged field by field.
  await phone.engine.put('plan', {
    ...(await phone.engine.get('plan', 'plan-0001'))!.data,
    title: 'Mga Bahagi ng Halaman',
  });
  await laptop.engine.put('plan', {
    ...(await laptop.engine.get('plan', 'plan-0001'))!.data,
    durationMinutes: 40,
  });
  await phone.engine.sync();
  await laptop.engine.sync();
  await phone.engine.sync();
  for (const d of [phone, laptop]) {
    const plan = (await d.engine.get('plan', 'plan-0001'))!.data;
    assert.deepEqual([plan.title, plan.durationMinutes], ['Mga Bahagi ng Halaman', 40]);
  }
  t.close();
});

test('the same part edited on two devices: both versions are kept until the teacher chooses', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  const phone = device(t, u.token, 'phone');
  const laptop = device(t, u.token, 'laptop');
  await writePlan(phone.engine);
  await phone.engine.sync();
  await laptop.engine.sync();

  const base = (await phone.engine.get('plan_section', 'plan-0001-assessment'))!.data;
  await phone.engine.put('plan_section', { ...base, content: text('Bersyon sa phone') });
  await laptop.engine.put('plan_section', { ...base, content: text('Bersyon sa laptop') });
  assert.equal((await phone.engine.sync()).conflicts, 0);
  const report = await laptop.engine.sync();
  assert.equal(report.conflicts, 1);

  const held = (await laptop.engine.get('plan_section', 'plan-0001-assessment'))!;
  assert.match(
    JSON.stringify(held.data.content),
    /Bersyon sa laptop/,
    'the laptop’s words are not lost'
  );
  assert.match(
    JSON.stringify(held.conflict!.server.data),
    /Bersyon sa phone/,
    'and it holds the other version beside them'
  );
  assert.match(
    JSON.stringify(t.services.records.get(u.id, 'plan_section', 'plan-0001-assessment')!.data),
    /Bersyon sa phone/,
    'nothing was overwritten on the server'
  );

  await laptop.engine.resolveConflict('plan_section', 'plan-0001-assessment', 'both');
  assert.equal((await laptop.engine.sync()).conflicts, 0);
  await phone.engine.sync();
  const final = await sectionText(phone.engine, 'plan-0001-assessment');
  assert.match(final, /Bersyon sa laptop/);
  assert.match(final, /Bersyon sa phone/);
  t.close();
});

test('a lock made on one device wins; the other device’s edit becomes a separate draft copy (DOC-4)', async () => {
  const t = createTestServer();
  const u = await t.registerUser({ displayName: 'Gng. Reyes' });
  const phone = device(t, u.token, 'phone');
  const laptop = device(t, u.token, 'laptop');
  await writePlan(phone.engine);
  await phone.engine.sync();
  await laptop.engine.sync();

  // Phone locks, with the shared helper the apps use.
  const plan = (await phone.engine.get('plan', 'plan-0001'))!.data;
  const sections = (await phone.engine.list('plan_section')).map((r) => r.data);
  const locked: Plan = planHelpers.lockPlan({
    plan,
    sections,
    template: DLP,
    teacherName: 'Gng. Reyes',
    at: t.clock.now().toISOString(),
    revision: null,
  });
  await phone.engine.put('plan', locked);
  const lockReport = await phone.engine.sync();
  assert.deepEqual([lockReport.ok, lockReport.conflicts, lockReport.rejected], [true, 0, 0]);
  const afterLock = (await phone.engine.get('plan', 'plan-0001'))!.data;
  assert.equal(afterLock.state, 'locked');
  assert.equal(
    typeof afterLock.lock!.revision,
    'number',
    'the phone now knows the server revision of its lock'
  );

  // Laptop, not having synced, edits a locked part and the reflection.
  const assessment = (await laptop.engine.get('plan_section', 'plan-0001-assessment'))!.data;
  await laptop.engine.put('plan_section', {
    ...assessment,
    content: text('Binago sa laptop pagkatapos i-lock sa phone'),
  });
  const report = await laptop.engine.sync();
  assert.equal(report.ok, true);
  assert.equal(report.lockCopies.length, 1);

  const copyId = report.lockCopies[0]!;
  const copy = (await laptop.engine.get('plan', copyId))!.data;
  assert.deepEqual([copy.state, copy.lock, copy.conflictCopyOf], ['draft', null, 'plan-0001']);
  await laptop.engine.sync();

  // Server: the locked plan is untouched, and the copy with the laptop's words is there as a draft.
  const original = t.services.records.planSnapshot(u.id, 'plan-0001')!;
  assert.equal(original.plan.data.state, 'locked');
  assert.match(JSON.stringify(original.sections), /Iguhit ang halaman/);
  assert.doesNotMatch(JSON.stringify(original.sections), /Binago sa laptop/);
  const copied = t.services.records.planSnapshot(u.id, copyId)!;
  assert.equal(copied.plan.data.state, 'draft');
  assert.match(JSON.stringify(copied.sections), /Binago sa laptop/);

  // The reflection is outside the lock and syncs normally afterwards.
  const reflection = (await laptop.engine.get('plan_section', 'plan-0001-reflection'))!.data;
  await laptop.engine.put('plan_section', {
    ...reflection,
    content: text('Naging masigla ang klase.'),
  });
  const later = await laptop.engine.sync();
  assert.deepEqual([later.ok, later.conflicts, later.lockCopies.length], [true, 0, 0]);
  assert.match(
    JSON.stringify(t.services.records.get(u.id, 'plan_section', 'plan-0001-reflection')!.data),
    /masigla/
  );
  t.close();
});

test('a lost reply is replayed without applying anything twice (RES-5)', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  let dropNextReply = false;
  const flaky = (inner: SyncTransport): SyncTransport => ({
    pull: (query) => inner.pull(query),
    async push(body) {
      const reply = await inner.push(body);
      if (dropNextReply) {
        dropNextReply = false;
        throw new TypeError('connection dropped after the server answered');
      }
      return reply;
    },
  });
  const phone = device(t, u.token, 'phone', flaky);
  await phone.engine.put(
    'day_note',
    parseRecordData('day_note', {
      id: 'note-0001',
      classId: 'class-0001',
      date: '2026-11-16',
      text: 'isang beses lang',
    })
  );

  dropNextReply = true;
  const failed = await phone.engine.sync();
  assert.deepEqual([failed.ok, failed.error], [false, 'offline']);
  assert.equal(
    t.services.records.get(u.id, 'day_note', 'note-0001')!.rev,
    1,
    'the server did apply it'
  );
  assert.equal((await phone.engine.status()).pending, 1, 'the phone does not know that yet');

  const retried = await phone.engine.sync();
  assert.deepEqual([retried.ok, retried.pushed, retried.conflicts], [true, 1, 0]);
  assert.equal(t.services.records.get(u.id, 'day_note', 'note-0001')!.rev, 1, 'applied once');
  assert.equal((await phone.engine.get('day_note', 'note-0001'))!.rev, 1);
  assert.equal((await phone.engine.status()).pending, 0);
  t.close();
});

test('deletes travel between devices, and an edit made elsewhere brings a deleted record back', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  const phone = device(t, u.token, 'phone');
  const laptop = device(t, u.token, 'laptop');
  const note = (text: string) =>
    parseRecordData('day_note', {
      id: 'note-0001',
      classId: 'class-0001',
      date: '2026-11-16',
      text,
    });
  await phone.engine.put('day_note', note('una'));
  await phone.engine.put('day_note', { ...note('ikalawa'), id: 'note-0002' });
  await phone.engine.sync();
  await laptop.engine.sync();

  await phone.engine.remove('day_note', 'note-0002');
  await phone.engine.sync();
  await laptop.engine.sync();
  assert.deepEqual(
    (await laptop.engine.list('day_note')).map((r) => r.id),
    ['note-0001']
  );

  // Phone deletes note 1; laptop, not knowing, edits it. The edit wins (§10.5).
  await phone.engine.remove('day_note', 'note-0001');
  await phone.engine.sync();
  await laptop.engine.put('day_note', note('inayos sa laptop'));
  const report = await laptop.engine.sync();
  assert.equal(report.ok, true);
  await laptop.engine.sync();
  await phone.engine.sync();
  assert.equal(
    t.services.records.get(u.id, 'day_note', 'note-0001')!.data.text,
    'inayos sa laptop'
  );
  assert.equal((await phone.engine.get('day_note', 'note-0001'))!.data.text, 'inayos sa laptop');
  assert.equal((await phone.engine.get('day_note', 'note-0001'))!.deletedAt, null);
  t.close();
});

test('a first sync with a window, then everything else on later syncs', async () => {
  const t = createTestServer({ now: '2026-11-16T00:00:00.000Z' });
  const u = await t.registerUser();
  const phone = device(t, u.token, 'phone');
  const placed = (id: string, date: string) =>
    parseRecordData('plan', {
      id,
      templateId: DLP.id,
      language: 'fil',
      grades: ['4'],
      durationMinutes: 50,
      placements: [{ classId: 'class-0001', assignmentId: null, dates: [date] }],
    });
  for (let i = 0; i < 30; i++)
    await phone.engine.put('plan', placed(`plan-old-${String(i).padStart(4, '0')}`, '2026-06-22'));
  await phone.engine.put('plan', placed('plan-this-week', '2026-11-18'));
  assert.equal((await phone.engine.sync()).ok, true);

  const tablet = device(t, u.token, 'tablet');
  const report = await tablet.engine.sync({ windowFrom: '2026-10-19', windowTo: '2027-01-11' });
  assert.equal(report.ok, true);
  assert.deepEqual(
    (await tablet.engine.list('plan')).map((r) => r.id),
    ['plan-this-week']
  );

  // A change to an old plan after that reaches the tablet even though it is outside the window.
  await phone.engine.put('plan', { ...placed('plan-old-0007', '2026-06-22'), title: 'Binago' });
  await phone.engine.sync();
  await tablet.engine.sync({ windowFrom: '2026-10-19', windowTo: '2027-01-11' });
  assert.deepEqual((await tablet.engine.list('plan')).map((r) => r.id).sort(), [
    'plan-old-0007',
    'plan-this-week',
  ]);
  t.close();
});
