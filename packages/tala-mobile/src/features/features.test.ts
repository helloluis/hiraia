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
import { createCommunity, filterSaved } from './community';
import { taskStore } from './tasks';
import { applyPreviews } from './realignment';
import { CalendarDay, PacingTrack } from '@hiraia/tala-core/contracts';
import type { TimelineInput, RealignmentPreview } from '@hiraia/tala-core/contracts';
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
test('lost generation reply retries the same persisted key; fallback keeps request and original revision', async () => {
  const keys: string[] = [];
  let created = false;
  const f = await fixture(async (name, args) => {
    if (name === 'generation.create') {
      keys.push(args.body.idempotencyKey);
      if (!created) {
        created = true;
        throw Error('reply lost');
      }
      return GenerationJob.parse({
        id: 'remote-job',
        kind: 'full',
        planId: 'plan',
        createdAt: '2026-11-13T12:00:00Z',
        finishedAt: null,
        status: 'queued',
        result: null,
        failure: null,
      });
    }
    throw Error('unexpected');
  });
  const service = createGeneration(f),
    task = await service.request('plan', {}, { group: ['Official objective'] });
  await service.tick(false);
  assert.equal(keys.length, 0);
  await service.tick(true);
  assert.equal((await service.tasks.list())[0]?.state, 'queued');
  await service.tasks.update(task.id, { nextAt: 0 });
  await service.tick(true);
  assert.equal(keys.length, 2);
  assert.ok(keys[0]);
  assert.equal(keys[0], keys[1]);
  assert.equal((await service.tasks.list())[0]?.remoteId, 'remote-job');
  await service.apply(task.id, 'fallback', true);
  assert.deepEqual((await f.engine.list('section_revision'))[0]?.data.content, {
    type: 'list',
    items: ['Original teacher wording'],
  });
  assert.equal((await service.tasks.list())[0]?.state, 'polling');
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

test('cancel after a lost keyed create recovers the same job before cancelling', async () => {
  let calls = 0,
    cancelled = 0;
  const keys: string[] = [];
  const f = await fixture(async (name, args) => {
    if (name === 'generation.create') {
      keys.push(args.body.idempotencyKey);
      if (++calls === 1) throw Error('lost');
      return GenerationJob.parse({
        id: 'remote',
        kind: 'full',
        planId: 'plan',
        status: 'queued',
        createdAt: '2026-11-13T12:00:00Z',
        finishedAt: null,
        result: null,
        failure: null,
      });
    }
    if (name === 'generation.cancel') {
      cancelled++;
      return GenerationJob.parse({
        id: 'remote',
        kind: 'full',
        planId: 'plan',
        status: 'cancelled',
        createdAt: '2026-11-13T12:00:00Z',
        finishedAt: null,
        result: null,
        failure: null,
      });
    }
    throw Error('unexpected');
  });
  const service = createGeneration(f),
    task = await service.request('plan');
  await service.tick(true);
  await service.cancel(task.id);
  await service.tasks.update(task.id, { nextAt: 0 });
  await service.tick(true);
  await service.tick(true);
  assert.equal(keys[0], keys[1]);
  assert.equal(cancelled, 1);
  assert.equal((await service.tasks.list())[0]!.state, 'cancelled');
});
test('an interrupted generated-draft apply reuses its journal and does not overwrite a newer teacher edit', async () => {
  const f = await fixture();
  const service = createGeneration(f),
    task = await service.request('plan');
  const originalCommit = f.store.commit.bind(f.store);
  let failOnce = true;
  f.store.commit = async (batch) => {
    if (failOnce && batch.meta?.['feature.tasks']) {
      const list = JSON.parse(batch.meta['feature.tasks']);
      if (list[0]?.prepared) {
        failOnce = false;
        throw Error('disk full before applying');
      }
    }
    await originalCommit(batch);
  };
  await assert.rejects(service.apply(task.id, 'fallback', true));
  assert.deepEqual((await f.engine.get('plan_section', 'section'))!.data.content, {
    type: 'list',
    items: ['Original teacher wording'],
  });
  f.store.commit = originalCommit;
  // Fail the final task acknowledgement after the real atomic record batch.
  f.store.commit = async (batch) => {
    if (batch.meta?.['feature.tasks']) {
      const list = JSON.parse(batch.meta['feature.tasks']);
      if (!list[0]?.prepared && (await service.tasks.list())[0]?.prepared)
        throw Error('lost task acknowledgement');
    }
    await originalCommit(batch);
  };
  await assert.rejects(service.apply(task.id, 'fallback', true));
  assert.ok((await service.tasks.list())[0]!.prepared);
  const section = (await f.engine.get('plan_section', 'section'))!.data;
  await f.engine.put('plan_section', {
    ...section,
    content: { type: 'list', items: ['New teacher edit after reopening'] },
  });
  f.store.commit = originalCommit;
  await assert.rejects(service.apply(task.id, 'fallback', true));
  assert.deepEqual((await f.engine.get('plan_section', 'section'))!.data.content, {
    type: 'list',
    items: ['New teacher edit after reopening'],
  });
});
test('legacy unkeyed sends pause on recovery; keyed generation and idempotent posts resume', async () => {
  const f = await fixture(),
    tasks = taskStore(f.store);
  for (const [id, kind, input] of [
    ['old', 'generation', { input: {} }],
    ['new', 'generation', { input: { idempotencyKey: 'key' } }],
    ['post', 'post', {}],
  ] as const)
    await tasks.put({
      id,
      kind,
      input,
      state: 'sending',
      attempts: 0,
      nextAt: 0,
      createdAt: f.now().toISOString(),
    });
  await tasks.recover();
  const all = await tasks.list();
  assert.equal(all[0]!.state, 'uncertain');
  assert.equal(all[1]!.state, 'queued');
  assert.equal(all[2]!.state, 'queued');
});
test('roster confirmation freezes default group and changed-row acceptance across retries', async () => {
  const bodies: any[] = [];
  let attempt = 0;
  const f = await fixture(async (name, args) => {
    if (name === 'config.get') return { rosterLlmRoute: 'rules' };
    if (name === 'roster.import')
      return {
        importId: 'remote',
        classId: 'class',
        filename: 'list.txt',
        columns: [],
        droppedColumns: [],
        rows: [],
        counts: { linesRead: 0, students: 0, needsReview: 0, notStudents: 0 },
        route: 'rules',
        aiUsed: false,
        sheets: [],
        expiresAt: '2026-11-14T12:00:00Z',
      };
    if (name === 'roster.confirm') {
      bodies.push(args.body);
      if (++attempt === 1) throw Error('lost');
      return { students: [], pendingRows: [] };
    }
    throw Error('unexpected');
  });
  const roster = createRoster(f);
  await roster.online({
    classId: 'class',
    filename: 'list.txt',
    text: 'Sample',
    useAi: false,
    cloudFlagAcknowledged: false,
    exactlyAsWritten: false,
  });
  await assert.rejects(roster.confirm('class', 'group', false));
  await roster.confirm('class', null, true);
  assert.deepEqual(bodies[0], bodies[1]);
});
test('roster legacy encoding is flagged, review expires, and sensitive manual name edits are refused', async () => {
  const f = await fixture(),
    roster = createRoster(f);
  const review = await roster.parse('class', 'Juan Santos', 'names.txt', false, true);
  assert.ok(review.draft.rows[0]!.flags.includes('corrupted_characters'));
  await assert.rejects(
    roster.resolve('class', 0, 'edit', [
      {
        displayName: '123456789012',
        familyName: '',
        givenName: '',
        middleName: '',
        suffix: '',
        sex: null,
        grade: null,
        localId: null,
      },
    ])
  );
  const expired = { ...review, draft: { ...review.draft, expiresAt: '2026-11-12T00:00:00Z' } };
  await f.store.commit({ meta: { 'roster.review.class': JSON.stringify(expired) } });
  assert.equal(await roster.load('class'), null);
  assert.equal(await f.store.getMeta('roster.review.class'), null);
});

test('nested staging publishes sample-sized operations once, and a later validation failure publishes nothing', async () => {
  const f = await fixture();
  let commits = 0;
  const commit = f.store.commit.bind(f.store);
  f.store.commit = async (batch) => {
    commits++;
    await commit(batch);
  };
  await staged(f.engine, async (outer) => {
    await staged(outer, async (inner) => {
      await inner.put('day_note', {
        id: 'one',
        classId: 'class',
        date: '2026-11-13',
        text: 'First',
      });
    });
    await outer.put('day_note', {
      id: 'two',
      classId: 'class',
      date: '2026-11-13',
      text: 'Second',
    });
    assert.equal(await f.engine.get('day_note', 'one'), null);
  });
  assert.equal(commits, 1);
  assert.equal((await f.engine.list('day_note')).length, 2);
  await assert.rejects(
    staged(f.engine, async (outer) => {
      await staged(outer, async (inner) => {
        await inner.put('day_note', {
          id: 'three',
          classId: 'class',
          date: '2026-11-13',
          text: 'No partial save',
        });
      });
      throw Error('Later validation');
    })
  );
  assert.equal(await f.engine.get('day_note', 'three'), null);
});
function artifact() {
  return ArtifactDetail.parse({
    id: 'artifact',
    title: 'Teacher lesson',
    summary: 'A sample shared lesson',
    authorDisplayName: 'Another Teacher',
    authorSchool: null,
    tags: {
      grades: ['3'],
      learningAreaId: 'science',
      subjectName: 'Science',
      termIndex: 1,
      competencyIds: ['competency'],
      curriculumVersion: 'fixture',
      language: 'fil',
      templateKind: 'custom',
      durationMinutes: 50,
      multigrade: null,
      region: 'Region V',
    },
    license: 'CC-BY-NC-4.0',
    provenance: { aiDrafted: false, adapted: false },
    lineage: null,
    copyCount: 1,
    currentVersionId: 'version',
    versionNumber: 1,
    status: 'visible',
    mine: false,
    createdAt: '2026-11-13T12:00:00Z',
    updatedAt: '2026-11-13T12:00:00Z',
    version: {
      id: 'version',
      artifactId: 'artifact',
      number: 1,
      templateId: 'shared-template',
      gradeGroups: [{ id: 'public.g1', grade: '3' }],
      competencies: { 'public.g1': ['competency'] },
      customObjectives: [],
      sections: [
        {
          key: 'objectives',
          content: {
            type: 'pergroup',
            groups: { 'public.g1': [{ t: 'p', spans: [{ text: 'public.g1' }] }] },
          },
        },
      ],
      template: {
        id: 'shared-template',
        kind: 'custom',
        name: { fil: 'Banghay', en: 'Template' },
        builtIn: false,
        span: 'session',
        orientation: 'portrait',
        sections: [
          {
            key: 'objectives',
            label: { fil: 'Mga layunin', en: 'Objectives' },
            contentType: 'pergroup',
            required: true,
            outsideLock: false,
          },
        ],
      },
      createdAt: '2026-11-13T12:00:00Z',
    },
  });
}
test('offline copies remap structural IDs without changing prose, preserve lineage and isolate custom templates', async () => {
  const f = await fixture(),
    service = createCommunity({ ...f, tasks: taskStore(f.store) }),
    source = artifact();
  const first = await service.copy(source, false, 'class'),
    second = await service.copy(source, false, 'class');
  assert.equal(first.state, 'draft');
  assert.equal(first.lineage?.versionId, 'version');
  assert.equal(first.gradeGroupIds[0], 'group');
  assert.notEqual(first.templateId, source.version.templateId);
  assert.notEqual(first.templateId, second.templateId);
  assert.ok(await f.engine.get('template', first.templateId));
  assert.ok(await f.engine.get('template', second.templateId));
  const section = (await f.engine.list('plan_section')).find(
    (s) => s.data.planId === first.id
  )!.data;
  assert.deepEqual(section.content, {
    type: 'pergroup',
    groups: { group: [{ t: 'p', spans: [{ text: 'public.g1' }] }] },
  });
  assert.equal((await service.saved()).length, 1);
});
test('queued posts require the same reviewed public snapshot after profile or date changes', async () => {
  let posted = 0;
  const f = await fixture(async (name) => {
    if (name === 'community.post') posted++;
    throw Error('Must not publish changed snapshot');
  });
  await f.engine.put('profile', {
    id: 'profile',
    displayName: 'Teacher',
    uiLanguage: 'fil',
    schoolName: 'Original School',
    region: '',
    dataSaver: false,
    activeSchoolYearId: null,
    pacingParams: {},
  });
  const row = (await f.engine.get('plan', 'plan'))!.data;
  await f.engine.put('plan', {
    ...row,
    state: 'locked',
    lock: {
      lockedAt: f.now().toISOString(),
      lockedBy: 'Teacher',
      revisionCode: 'LOCK',
      revision: null,
    },
  });
  const service = createCommunity({ ...f, tasks: taskStore(f.store) });
  await assert.rejects(service.post({
    planId: 'plan', title: 'A lesson for sharing', summary: '', displayName: 'Teacher',
    showSchool: true, region: null, termIndex: null, licenseAccepted: true, affirmed: true,
  }, 'outdated review'), /Review changed/);
  await service.post({
    planId: 'plan',
    title: 'A lesson for sharing',
    summary: '',
    displayName: 'Teacher',
    showSchool: true,
    region: null,
    termIndex: null,
    licenseAccepted: true,
    affirmed: true,
  });
  const profile = (await f.engine.get('profile', 'profile'))!.data;
  await f.engine.put('profile', { ...profile, schoolName: 'Changed School' });
  await service.tick(true);
  assert.equal(posted, 0);
  assert.equal((await service.saved()).length, 0);
  const task = (await taskStore(f.store).list())[0]!;
  assert.equal(task.state, 'failed');
  assert.equal(task.error, 'reviewPostAgain');
});

test('offline saved search honours filters without contacting the server', () => {
  const source = artifact();
  assert.equal(
    filterSaved([source], {
      grade: '3',
      learningAreaId: 'science',
      termIndex: 1,
      competencyId: 'competency',
      language: 'fil',
      region: 'Region V',
      maxMinutes: 50,
    }).length,
    1
  );
  assert.equal(filterSaved([source], { grade: '4' }).length, 0);
  assert.equal(filterSaved([source], { mine: true }).length, 0);
  assert.equal(filterSaved([source], { maxMinutes: 40 }).length, 0);
});
test('realignment and Undo use atomic batches, preserve later submitted metadata and mark the day handled', async () => {
  const f = await fixture();
  const track = PacingTrack.parse({
    id: 'track',
    classId: 'class',
    assignmentId: 'assignment',
    gradeGroupId: 'group',
    termId: 'term',
  });
  await f.engine.put('pacing_track', track);
  const old = (await f.engine.get('plan', 'plan'))!.data;
  const day = CalendarDay.parse({
    id: 'day',
    schoolYearId: 'year',
    date: '2026-11-13',
    kind: 'suspension',
  });
  const preview = {
    nextTrack: { ...track, overrides: { sessions: { competency: 2 } } },
    newCalendarDays: [],
    planMoves: [{ planId: 'plan', classId: 'class', from: ['2026-11-13'], to: ['2026-11-16'] }],
  } as unknown as RealignmentPreview;
  const input = { tracks: [track], plans: [old] } as TimelineInput;
  const undo = await applyPreviews(f.engine, input, day, [preview]);
  assert.equal((await f.engine.get('calendar_day', 'day'))!.data.realigned, true);
  assert.deepEqual((await f.engine.get('plan', 'plan'))!.data.placements[0]!.dates, ['2026-11-16']);
  const moved = (await f.engine.get('plan', 'plan'))!.data;
  await f.engine.put('plan', {
    ...moved,
    submitted: { date: '2026-11-16', note: 'Kept after Undo' },
  });
  await undo();
  assert.equal(await f.engine.get('calendar_day', 'day'), null);
  assert.deepEqual((await f.engine.get('plan', 'plan'))!.data.placements[0]!.dates, ['2026-11-13']);
  assert.equal((await f.engine.get('plan', 'plan'))!.data.submitted?.note, 'Kept after Undo');
});
