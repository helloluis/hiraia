import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createSyncEngine } from '@hiraia/tala-core/sync';
import {
  ClassRecord,
  Plan,
  PlanSection,
  GenerationJob,
  ArtifactDetail,
} from '@hiraia/tala-core/contracts';
import type { TalaClient, SyncTransport } from '@hiraia/tala-core/contracts';
import { createGeneration } from './generation';
import { createRoster } from './roster';
import { createCommunity } from './community';
import { taskStore } from './tasks';
import { staged } from './atomic';
async function fixture(
  handler: (name: string, args: any) => Promise<unknown> = async () => {
    throw Error('offline');
  }
) {
  let n = 0;
  const newId = () => `fixture-${++n}`,
    now = () => new Date('2026-11-13T12:00:00Z'),
    store = createMemoryStore();
  const transport: SyncTransport = {
    async push(body) {
      return {
        results: body.mutations.map((m) => ({
          mutationId: m.mutationId,
          status: 'applied' as const,
          record:
            m.op === 'delete'
              ? null
              : {
                  entity: m.entity,
                  id: m.id,
                  rev: m.baseRev + 1,
                  updatedAt: now().toISOString(),
                  deletedAt: null,
                  data: m.data,
                },
        })),
      };
    },
    async pull() {
      return {
        records: [],
        cursor: 'cursor-main',
        hasMore: false,
        serverTime: now().toISOString(),
      };
    },
  };
  const engine = createSyncEngine({ store, transport, deviceId: 'device', newId, now });
  const client = { call: handler, syncTransport: transport } as TalaClient;
  await engine.put(
    'class',
    ClassRecord.parse({
      id: 'class',
      schoolYearId: 'year',
      name: 'Grade 3 - Sampaguita',
      gradeGroups: [{ id: 'group', grade: '3' }],
    })
  );
  await engine.put(
    'plan',
    Plan.parse({
      id: 'plan',
      title: 'Original lesson',
      templateId: 'tpl.dlp.v1',
      language: 'fil',
      grades: ['3'],
      gradeGroupIds: ['group'],
      durationMinutes: 50,
      placements: [{ classId: 'class', assignmentId: null, dates: ['2026-11-13'] }],
      competencies: { group: ['competency'] },
      curriculumVersion: 'fixture',
    })
  );
  await engine.put(
    'plan_section',
    PlanSection.parse({
      id: 'section',
      planId: 'plan',
      key: 'objectives',
      content: { type: 'list', items: ['Original teacher wording'] },
      editedByTeacher: true,
    })
  );
  return { engine, store, client, newId, now };
}
test('staging commits through one real engine batch and rolls back a failed logical operation', async () => {
  const f = await fixture();
  await assert.rejects(
    staged(f.engine, async (view) => {
      await view.put('day_note', {
        id: 'note',
        classId: 'class',
        date: '2026-11-13',
        text: 'must not survive',
      });
      throw Error('validation');
    })
  );
  assert.equal(await f.engine.get('day_note', 'note'), null);
  await staged(f.engine, async (view) => {
    await view.put('day_note', { id: 'note', classId: 'class', date: '2026-11-13', text: 'saved' });
    assert.equal((await view.get('day_note', 'note'))?.data.text, 'saved');
  });
  assert.ok(await f.engine.get('day_note', 'note'));
});
test('generation lost create reply is never replayed automatically; fallback keeps request and section revision', async () => {
  let calls = 0;
  const f = await fixture(async (name) => {
    if (name === 'generation.create') {
      calls++;
      throw Error('reply lost');
    }
    throw Error('unexpected');
  });
  const service = createGeneration(f);
  const task = await service.request('plan', {}, { group: ['Official objective'] });
  await service.tick(false);
  assert.equal(calls, 0);
  await service.tick(true);
  assert.equal(calls, 1);
  assert.equal((await service.tasks.list())[0]?.state, 'uncertain');
  await createGeneration(f).tasks.recover();
  await service.tick(true);
  assert.equal(calls, 1);
  await service.apply(task.id, 'fallback', true);
  assert.equal((await f.engine.list('section_revision'))[0]?.data.content.type, 'list');
  assert.deepEqual((await f.engine.list('section_revision'))[0]?.data.content, {
    type: 'list',
    items: ['Original teacher wording'],
  });
  assert.equal((await service.tasks.list())[0]?.state, 'uncertain');
});
test('generation result resumes by remote ID, requires review, atomically preserves teacher text and marks AI draft', async () => {
  const gen = {
    provider: 'fixture',
    model: 'fixture',
    promptId: 'lesson/single',
    promptVersion: 2,
    curriculumVersion: 'fixture',
    at: '2026-11-13T12:00:00Z',
  };
  let created = 0;
  const job = GenerationJob.parse({
    id: 'remote-job',
    kind: 'full',
    planId: 'plan',
    createdAt: gen.at,
    finishedAt: gen.at,
    status: 'done',
    failure: null,
    result: {
      title: 'New draft',
      sections: [{ key: 'objectives', content: { type: 'list', items: ['Generated text'] }, gen }],
      provider: 'fixture',
      model: 'fixture',
    },
  });
  const f = await fixture(async (name) => {
    if (name === 'generation.create') {
      created++;
      return { ...job, status: 'queued', result: null };
    }
    if (name === 'generation.get') return job;
    throw Error('unexpected');
  });
  const service = createGeneration(f);
  const task = await service.request('plan');
  await service.tick(true);
  await service.tasks.update(task.id, { nextAt: 0 });
  await createGeneration(f).tick(true);
  assert.equal(created, 1);
  assert.equal((await service.tasks.list())[0]?.state, 'ready');
  await assert.rejects(service.apply(task.id, 'result', false));
  await service.apply(task.id, 'result', true);
  assert.equal((await f.engine.get('plan', 'plan'))?.data.aiDraft, true);
  assert.equal((await f.engine.list('section_revision')).length, 1);
  assert.equal((await service.tasks.list())[0]?.state, 'done');
});
test('offline roster removes sensitive cells, retains ambiguous rows, and saves only explicit resolutions atomically', async () => {
  const f = await fixture();
  const roster = createRoster(f);
  let review = await roster.parse(
    'class',
    'Name,LRN,Grade\nDELA CRUZ,123456789012,3\nMaria Santos,999999999999,3',
    'list.csv'
  );
  assert.ok(!JSON.stringify(review).includes('123456789012'));
  assert.ok(!JSON.stringify(review).includes('999999999999'));
  assert.ok(review.draft.rows.some((r) => r.flags.includes('uncertain_split')));
  const row = review.draft.rows.find((r) => r.original === 'DELA CRUZ')!;
  await roster.resolve('class', row.rowIndex, 'keep_original');
  const result = await roster.confirm('class', 'group');
  assert.ok(result);
  const learners = await f.engine.list('student');
  assert.equal(learners.length, 1);
  assert.equal(learners[0]!.data.displayName, 'DELA CRUZ');
  assert.equal(learners[0]!.data.familyName, '');
  assert.ok(result!.draft.rows.some((r) => !result!.savedRows.includes(r.rowIndex)));
});
test('server roster confirm reuses idempotency key across a lost response', async () => {
  const bodies: any[] = [];
  let tries = 0;
  const f = await fixture(async (name, args) => {
    if (name === 'config.get') return { rosterLlmRoute: 'rules' };
    if (name === 'roster.import')
      return {
        importId: 'remote-import',
        classId: 'class',
        filename: 'names.txt',
        columns: [],
        droppedColumns: [],
        rows: [],
        counts: { linesRead: 1, students: 1, needsReview: 0, notStudents: 0 },
        route: 'rules',
        aiUsed: false,
        sheets: [],
        expiresAt: '2026-11-14T12:00:00Z',
      };
    if (name === 'roster.confirm') {
      bodies.push(args.body);
      if (++tries === 1) throw Error('lost');
      return {
        students: [
          {
            displayName: 'Juan Santos',
            familyName: 'Santos',
            givenName: 'Juan',
            middleName: '',
            suffix: '',
            sex: null,
            grade: '3',
            localId: null,
            gradeGroupId: 'group',
            rowIndex: 0,
          },
        ],
        pendingRows: [],
      };
    }
    throw Error('unexpected');
  });
  const roster = createRoster(f);
  await roster.online({
    classId: 'class',
    filename: 'names.txt',
    text: 'Juan Santos',
    useAi: false,
    exactlyAsWritten: false,
    cloudFlagAcknowledged: false,
  });
  await assert.rejects(roster.confirm('class', 'group'));
  await roster.confirm('class', 'group');
  assert.equal(bodies[0].idempotencyKey, bodies[1].idempotencyKey);
  assert.equal((await f.engine.list('student')).length, 1);
});
test('pre-post exact privacy transform removes school, class, dates and reflection; detectors block learner names', async () => {
  const f = await fixture();
  await f.engine.put('profile', {
    id: 'profile',
    displayName: 'Teacher',
    schoolName: 'Rizal Elementary School',
    region: '',
    uiLanguage: 'fil',
    dataSaver: false,
    activeSchoolYearId: null,
    pacingParams: {},
  });
  const p = (await f.engine.get('plan', 'plan'))!.data;
  await f.engine.put('plan', {
    ...p,
    state: 'locked',
    lock: {
      lockedAt: f.now().toISOString(),
      lockedBy: 'Teacher',
      revisionCode: 'CODE',
      revision: null,
    },
  });
  await f.engine.put(
    'plan_section',
    PlanSection.parse({
      id: 'reflection',
      planId: 'plan',
      key: 'reflection',
      content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'Private reflection' }] }] },
    })
  );
  const service = createCommunity({ ...f, tasks: taskStore(f.store) });
  const body = {
    planId: 'plan',
    title: 'Rizal Elementary School - lesson',
    summary: 'Grade 3 - Sampaguita 2026-11-13',
    displayName: 'Teacher',
    showSchool: false,
    region: null,
    termIndex: null,
    licenseAccepted: true as const,
    affirmed: true as const,
  };
  const preview = await service.preview(body);
  assert.ok(!JSON.stringify(preview.publicContent).includes('Private reflection'));
  assert.ok(!preview.title.includes('Rizal'));
  assert.ok(!preview.summary.includes('Sampaguita'));
  assert.ok(!preview.summary.includes('2026-11-13'));
  await f.engine.put('student', {
    id: 'student',
    classId: 'class',
    gradeGroupId: 'group',
    displayName: 'Juan Santos',
    givenName: 'Juan',
    familyName: 'Santos',
    middleName: '',
    suffix: '',
    sex: null,
    localId: null,
    order: 0,
    importId: null,
  });
  const section = (await f.engine.get('plan_section', 'section'))!.data;
  await f.engine.put('plan_section', {
    ...section,
    content: { type: 'list', items: ['Juan Santos'] },
  });
  assert.equal((await service.preview(body)).blocked, true);
  await assert.rejects(service.post(body));
});
