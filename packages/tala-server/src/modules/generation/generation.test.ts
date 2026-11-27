import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GenerationInput, Plan, PlanSection, type GenerationJob } from '@hiraia/tala-core';
import { buildPrefilledDraft } from '@hiraia/tala-core/generation';
import { generationModule, runJob, withPlanWeekDays } from './index';
import { fakeCompactRaw } from '../../../eval/fixtures';
import { createLlmGateway, llmModule } from '../llm';
import { createTestServer } from '../../testing';
import type { BaseDeps, Ctx, Services, LlmGateway, LlmResult } from '../../kernel/types';
const input = () =>
  GenerationInput.parse({
    kind: 'full',
    templateId: 'tpl.dlp.v1',
    language: 'en',
    subjectName: 'Science',
    learningAreaId: null,
    timeBudgetMinutes: 30,
    gradeGroups: [{ id: 'group-002', grade: '2' }],
    competencies: {},
    curriculumVersion: null,
    customObjectives: ['Describe plants.'],
    classProfile: {},
  });
/** A class that lists what it has: materials may only name these (PRD rule, prompts and check). */
const withResources = () => ({
  ...input(),
  classProfile: { ...input().classProfile, materials: ['chalkboard', 'manila paper'] },
});
const sourcePlan = () =>
  Plan.parse({
    id: 'source-plan',
    title: 'Plants',
    templateId: 'tpl.dlp.v1',
    language: 'en',
    subjectName: 'Science',
    grades: ['2'],
    gradeGroupIds: ['group-002'],
    durationMinutes: 30,
    competencies: {},
    placements: [],
  });
const unavailable: LlmGateway = {
  routeFor: () => 'cloud',
  complete: async () => ({
    ok: false,
    reason: 'providers_unavailable',
    message: 'Use the pre-filled draft.',
  }),
};
function server(llm = unavailable) {
  return createTestServer({
    modules: [llmModule, generationModule],
    services: { llm },
    quiet: true,
  });
}
async function waitFor(
  t: ReturnType<typeof server>,
  token: string,
  id: string,
  status: GenerationJob['status']
) {
  for (let i = 0; i < 200; i++) {
    const job = await t.ok('generation.get', { params: { jobId: id }, token });
    if (job.status === status) return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`Job did not reach ${status}.`);
}
test('real routes persist jobs, validate failure responses and enforce ownership', async () => {
  const t = server();
  try {
    const teacher = await t.registerUser();
    const job = await t.ok('generation.create', { body: input(), token: teacher.token });
    assert.equal(job.status, 'queued');
    const failed = await waitFor(t, teacher.token, job.id, 'failed');
    assert.equal(failed.failure?.reason, 'providers_unavailable');
    assert.equal(
      (t.db.prepare('SELECT count(*) AS n FROM generation_jobs').get() as { n: number }).n,
      1
    );
    const other = await t.registerUser();
    const forbidden = await t.call('generation.get', {
      params: { jobId: job.id },
      token: other.token,
    });
    assert.equal(forbidden.status, 404);
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});
test('real cancel route prevents queued work', async () => {
  const t = server();
  try {
    const teacher = await t.registerUser();
    const job = await t.ok('generation.create', { body: input(), token: teacher.token });
    const cancelled = await t.ok('generation.cancel', {
      params: { jobId: job.id },
      token: teacher.token,
    });
    assert.equal(cancelled.status, 'cancelled');
    const again = await t.ok('generation.get', { params: { jobId: job.id }, token: teacher.token });
    assert.equal(again.status, 'cancelled');
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});
test('real create rejects unresolved competency ids and unauthenticated calls', async () => {
  const t = server();
  try {
    const teacher = await t.registerUser();
    const result = await t.call('generation.create', {
      body: {
        ...input(),
        competencies: { 'group-002': ['forged-text'] },
        curriculumVersion: 'test',
      },
      token: teacher.token,
    });
    assert.equal(result.status, 400);
    const anon = await t.call('generation.create', { body: input() });
    assert.equal(anon.status, 401);
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});
test('completed job route carries valid provenance without synced-record writes', async () => {
  const draft = buildPrefilledDraft(input());
  const fake: LlmGateway = {
    routeFor: () => 'cloud',
    complete: async () =>
      ({
        ok: true,
        data: draft,
        provider: 'qwen',
        model: 'fake',
        promptId: 'lesson/single',
        promptVersion: 1,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        fellBack: true,
      }) as never,
  };
  const t = server(fake);
  try {
    const teacher = await t.registerUser();
    const job = await t.ok('generation.create', { body: input(), token: teacher.token });
    const done = await waitFor(t, teacher.token, job.id, 'done');
    assert.equal(done.result?.sections[0]?.gen.provider, 'qwen');
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});
test('running cancellation wins over late provider response', async () => {
  let finish!: (v: LlmResult<never>) => void;
  const fake: LlmGateway = {
    routeFor: () => 'cloud',
    complete: () =>
      new Promise((r) => {
        finish = r;
      }),
  };
  const t = server(fake);
  try {
    const teacher = await t.registerUser();
    const job = await t.ok('generation.create', { body: input(), token: teacher.token });
    await waitFor(t, teacher.token, job.id, 'running');
    const cancelled = await t.ok('generation.cancel', {
      params: { jobId: job.id },
      token: teacher.token,
    });
    assert.equal(cancelled.status, 'cancelled');
    finish({ ok: false, reason: 'cancelled', message: 'Cancelled.' });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      (await t.ok('generation.get', { params: { jobId: job.id }, token: teacher.token })).status,
      'cancelled'
    );
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});
test('real allowance route is validated and reports degraded budget', async () => {
  const t = server();
  try {
    const teacher = await t.registerUser();
    const allowance = await t.ok('generation.allowance', { token: teacher.token });
    assert.ok(allowance.fullRemainingToday >= 0);
    assert.equal(allowance.degraded, false);
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});
test('account deletion removes generation inputs and quota/meter rows', async () => {
  const t = server();
  try {
    const teacher = await t.registerUser();
    const other = await t.registerUser();
    await t.ok('generation.create', { body: input(), token: teacher.token });
    await t.ok('generation.create', { body: input(), token: other.token });
    t.db.prepare('INSERT INTO llm_quota VALUES(?,?,?,1)').run('2026-11-16', teacher.id, 'full');
    t.db
      .prepare(
        'INSERT INTO llm_usage(day,month,user_id,feature,provider,input_tokens,output_tokens,cost) VALUES(?,?,?,?,?,?,?,?)'
      )
      .run('2026-11-16', '2026-11', teacher.id, 'lesson.generate', 'qwen', 1, 1, 0.001);
    await t.ok('account.delete', {
      body: { password: teacher.password, confirm: 'DELETE' },
      token: teacher.token,
    });
    assert.equal(
      (
        t.db
          .prepare('SELECT count(*) AS n FROM generation_jobs WHERE owner_id=?')
          .get(teacher.id) as { n: number }
      ).n,
      0
    );
    assert.equal(
      (
        t.db.prepare('SELECT count(*) AS n FROM llm_quota WHERE user_id=?').get(teacher.id) as {
          n: number;
        }
      ).n,
      0
    );
    assert.equal(
      (
        t.db.prepare('SELECT count(*) AS n FROM llm_usage WHERE user_id=?').get(teacher.id) as {
          n: number;
        }
      ).n,
      0
    );
    assert.equal(
      (t.db.prepare('SELECT SUM(cost) AS n FROM llm_deleted_spend').get() as { n: number }).n,
      0.001
    );
    assert.equal(
      (
        t.db
          .prepare('SELECT count(*) AS n FROM generation_jobs WHERE owner_id=?')
          .get(other.id) as { n: number }
      ).n,
      1
    );
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});
test('section generation reads the real owned source and leaves every existing section untouched', async () => {
  let sourceSeen = false;
  const fake: LlmGateway = {
    routeFor: () => 'cloud',
    complete: async (req) => {
      const payload = JSON.parse(req.vars.input!) as { source: { key: string }[] };
      sourceSeen = payload.source.some((s) => s.key === 'content');
      return {
        ok: true,
        data: {
          title: 'Plants',
          sections: [{ key: 'materials', content: { type: 'list', items: ['chalkboard'] } }],
        },
        provider: 'qwen',
        model: 'fake',
        promptId: 'lesson/section',
        promptVersion: 2,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        fellBack: true,
      } as never;
    },
  };
  const t = server(fake);
  try {
    const teacher = await t.registerUser();
    const plan = Plan.parse({
      id: 'source-plan',
      title: 'Plants',
      templateId: 'tpl.dlp.v1',
      language: 'en',
      subjectName: 'Science',
      grades: ['2'],
      gradeGroupIds: ['group-002'],
      durationMinutes: 30,
      competencies: {},
      placements: [],
    });
    t.services.records.put(teacher.id, 'plan', plan);
    const section = PlanSection.parse({
      id: 'source-content',
      planId: plan.id,
      key: 'content',
      content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'Original teacher text.' }] }] },
    });
    t.services.records.put(teacher.id, 'plan_section', section);
    const before = t.services.records.planSnapshot(teacher.id, plan.id);
    const job = await t.ok('generation.create', {
      body: { ...withResources(), kind: 'section', planId: plan.id, sectionKey: 'materials' },
      token: teacher.token,
    });
    const done = await waitFor(t, teacher.token, job.id, 'done');
    assert.equal(done.result?.sections.length, 1);
    assert.equal(sourceSeen, true);
    assert.deepEqual(t.services.records.planSnapshot(teacher.id, plan.id), before);
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});
test('lost create reply and finished-job replay reuse one job and consume quota once', async () => {
  let calls = 0;
  const instrumented = {
    ...llmModule,
    services: (deps: Parameters<NonNullable<typeof llmModule.services>>[0]) => ({
      llm: createLlmGateway(deps, {
        call: async () => {
          calls++;
          return {
            content: JSON.stringify(fakeCompactRaw({ ...input(), resolvedObjectives: {} })),
            inputTokens: 100,
            outputTokens: 200,
            costUsd: 0,
          };
        },
      }),
    }),
  };
  const t = createTestServer({ modules: [instrumented, generationModule], quiet: true });
  try {
    const teacher = await t.registerUser(),
      other = await t.registerUser();
    const body = { ...input(), idempotencyKey: 'lost-reply' };
    const first = await t.ok('generation.create', { body, token: teacher.token });
    const replay = await t.ok('generation.create', { body, token: teacher.token });
    assert.equal(replay.id, first.id);
    await waitFor(t, teacher.token, first.id, 'done');
    const finished = await t.ok('generation.create', {
      body: { ...body, customObjectives: [] },
      token: teacher.token,
    });
    assert.equal(finished.id, first.id);
    assert.equal(finished.status, 'done');
    assert.equal(calls, 1);
    const used = t.db
      .prepare("SELECT used FROM llm_quota WHERE user_id=? AND bucket='full'")
      .get(teacher.id) as { used: number };
    assert.equal(used.used, 1);
    const unrelated = await t.ok('generation.create', { body, token: other.token });
    assert.notEqual(unrelated.id, first.id);
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});
test('real account merge retains every job, isolates others, and preserves colliding replay anchors', async () => {
  const t = server();
  try {
    const from = await t.registerUser(),
      to = await t.registerUser(),
      other = await t.registerUser();
    const body = { ...input(), idempotencyKey: 'shared-key' };
    const source = await t.ok('generation.create', { body, token: from.token }),
      destination = await t.ok('generation.create', { body, token: to.token });
    await t.ok('generation.create', { body, token: other.token });
    const untouched = t.db.prepare('SELECT * FROM generation_jobs WHERE owner_id=?').all(other.id);
    await t.ok('account.merge', {
      body: {
        confirm: 'MERGE',
        currentPassword: to.password,
        email: from.email,
        password: from.password,
      },
      token: to.token,
    });
    assert.equal(
      (
        t.db.prepare('SELECT count(*) AS n FROM generation_jobs WHERE owner_id=?').get(to.id) as {
          n: number;
        }
      ).n,
      2
    );
    assert.deepEqual(
      t.db.prepare('SELECT * FROM generation_jobs WHERE owner_id=?').all(other.id),
      untouched
    );
    assert.equal(
      (await t.ok('generation.get', { params: { jobId: source.id }, token: to.token })).id,
      source.id
    );
    assert.equal((await t.ok('generation.create', { body, token: to.token })).id, destination.id);
    const deps = { db: t.db } as Parameters<
      NonNullable<typeof generationModule.onAccountMerged>
    >[0];
    const before = t.db.prepare('SELECT * FROM generation_jobs ORDER BY id').all();
    generationModule.onAccountMerged!(deps, from.id, to.id);
    generationModule.onAccountMerged!(deps, to.id, to.id);
    assert.deepEqual(t.db.prepare('SELECT * FROM generation_jobs ORDER BY id').all(), before);
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});
test('merge requeues running work without letting the old runner overwrite the moved job', async () => {
  let finish!: (result: LlmResult<never>) => void;
  const fake: LlmGateway = {
    routeFor: () => 'cloud',
    complete: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  };
  let deps!: BaseDeps & { services: Services };
  const t = createTestServer({
    modules: [
      llmModule,
      {
        ...generationModule,
        start: (base) => {
          deps = base;
          return () => {};
        },
      },
    ],
    services: { llm: fake },
    quiet: true,
  });
  try {
    const from = await t.registerUser(),
      to = await t.registerUser();
    const job = await t.ok('generation.create', {
      body: { ...input(), idempotencyKey: 'running-key' },
      token: from.token,
    });
    const context = {
      ...deps,
      user: {
        id: from.id,
        email: from.email,
        emailVerified: true,
        displayName: 'Teacher',
        sessionId: 'session',
      },
      requestId: 'test',
      ip: null,
    } as Ctx;
    const running = runJob(context, job.id);
    assert.equal(
      (await t.ok('generation.get', { params: { jobId: job.id }, token: from.token })).status,
      'running'
    );
    await t.ok('account.merge', {
      body: {
        confirm: 'MERGE',
        currentPassword: to.password,
        email: from.email,
        password: from.password,
      },
      token: to.token,
    });
    finish({ ok: false, reason: 'cancelled', message: 'Cancelled.' });
    await running;
    const moved = await t.ok('generation.get', { params: { jobId: job.id }, token: to.token });
    assert.equal(moved.status, 'queued');
    assert.equal(moved.id, job.id);
    assert.equal(
      (
        await t.ok('generation.create', {
          body: { ...input(), idempotencyKey: 'running-key' },
          token: to.token,
        })
      ).id,
      job.id
    );
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});
test('cancelled and failed idempotent jobs keep their replay identity', async () => {
  const t = server();
  try {
    const teacher = await t.registerUser();
    const cancelledBody = { ...input(), idempotencyKey: 'cancel-key' };
    const cancelled = await t.ok('generation.create', {
      body: cancelledBody,
      token: teacher.token,
    });
    await t.ok('generation.cancel', { params: { jobId: cancelled.id }, token: teacher.token });
    assert.equal(
      (await t.ok('generation.create', { body: cancelledBody, token: teacher.token })).status,
      'cancelled'
    );
    const failedBody = { ...input(), idempotencyKey: 'failure-key' };
    const failed = await t.ok('generation.create', { body: failedBody, token: teacher.token });
    await waitFor(t, teacher.token, failed.id, 'failed');
    assert.equal(
      (await t.ok('generation.create', { body: failedBody, token: teacher.token })).id,
      failed.id
    );
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});
test('generated sections show official codes or stored text while internal competency IDs stay in metadata', async () => {
  const ids = ['fixture-demo-v1.mathematics.g2.t2.3', 'fixture-demo-v1.mathematics.g4.t2.7'];
  const records = [
    { id: ids[0], code: 'M2NS-IIa-1', text: 'Describe and compare numbers.' },
    { id: ids[1], code: null, text: 'Compare fractions.' },
  ];
  const fake: LlmGateway = {
    routeFor: () => 'cloud',
    complete: async (req) => {
      const payload = JSON.parse(req.vars.input!) as {
        groups: { grade: string; objectives: { ref: string; text: string }[] }[];
        schedule: { slot: number }[];
      };
      for (const id of ids) assert.equal(req.vars.input!.includes(id), false);
      const groups = payload.groups.map((g) => ({
        grade: g.grade,
        targets: g.objectives.map((o) => o.ref),
        text: 'Ask learners to explain their comparison.',
      }));
      const raw = {
        title: 'Comparisons',
        sections: [
          { key: 'objectives', groups },
          { key: 'materials', groups: groups.map((g) => ({ grade: g.grade, items: [] })) },
          {
            key: 'multigrade',
            blocks: payload.schedule.map((s) => ({
              slot: s.slot,
              label: 'Compare',
              activities: groups.map((g) => ({
                grade: g.grade,
                text: 'Draw and compare the numbers independently when the teacher is with the other grade.',
              })),
            })),
          },
          { key: 'assessment', groups },
        ],
      };
      const data = req.schema.parse(raw);
      assert.deepEqual(req.check?.(data), []);
      return {
        ok: true,
        data,
        provider: 'qwen',
        model: 'fake',
        promptId: req.promptId,
        promptVersion: 2,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        fellBack: true,
      };
    },
  };
  const t = createTestServer({
    modules: [llmModule, generationModule],
    services: {
      llm: fake,
      curriculum: {
        getCompetencies: (_version, requested) =>
          records.filter((record) => requested.includes(record.id!)).reverse() as never,
        versionFor: () => null,
      },
    },
    quiet: true,
  });
  try {
    const teacher = await t.registerUser();
    const body = GenerationInput.parse({
      ...input(),
      templateId: 'tpl.multigrade.v1',
      gradeGroups: [
        { id: 'group-002', grade: '2' },
        { id: 'group-004', grade: '4' },
      ],
      competencies: { 'group-002': [ids[0]], 'group-004': [ids[1]] },
      curriculumVersion: 'fixture-demo-v1',
      customObjectives: [],
    });
    const job = await t.ok('generation.create', { body, token: teacher.token });
    const done = await waitFor(t, teacher.token, job.id, 'done');
    const content = JSON.stringify(done.result!.sections.map((s) => s.content));
    for (const id of ids) assert.equal(content.includes(id), false);
    assert.ok(content.includes('M2NS-IIa-1: Describe and compare numbers.'));
    assert.ok(content.includes('Compare fractions.'));
    const stored = JSON.parse(
      (
        t.db.prepare('SELECT input FROM generation_jobs WHERE id=?').get(job.id) as {
          input: string;
        }
      ).input
    ) as GenerationInput;
    assert.deepEqual(stored.competencies, body.competencies);
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});

test('27 Nov fix: a Materials rewrite for a class with no listed resources is refused at once (no job, no model call)', async () => {
  let calls = 0;
  const counting: LlmGateway = {
    routeFor: () => 'cloud',
    complete: async () => {
      calls++;
      return { ok: false, reason: 'providers_unavailable', message: 'down' } as never;
    },
  };
  const t = server(counting);
  try {
    const teacher = await t.registerUser();
    t.services.records.put(teacher.id, 'plan', sourcePlan());
    const refused = await t.call('generation.create', {
      body: { ...input(), kind: 'section', planId: 'source-plan', sectionKey: 'materials' },
      token: teacher.token,
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.error?.code, 'invalid_input');
    assert.equal((refused.error?.details as { reason?: string } | undefined)?.reason, 'no_class_resources');
    // Other parts need no listed resources and still run.
    const other = await t.call('generation.create', {
      body: { ...input(), kind: 'section', planId: 'source-plan', sectionKey: 'content' },
      token: teacher.token,
    });
    assert.equal(other.status, 200);
    await waitFor(t, teacher.token, other.data!.id, 'failed');
    assert.equal(calls, 1, 'only the content rewrite reached the model');
    assert.deepEqual(t.errors, []);
  } finally {
    t.close();
  }
});

test('27 Nov fix: a rewritten part that comes back empty fails as empty_output and is never offered as a result', async () => {
  for (const empty of [
    { type: 'list', items: [] },
    { type: 'list', items: ['  ', ''] },
  ] as const) {
    const blank: LlmGateway = {
      routeFor: () => 'cloud',
      complete: async () =>
        ({
          ok: true,
          data: { title: 'Plants', sections: [{ key: 'materials', content: empty }] },
          provider: 'deepseek',
          model: 'fake',
          promptId: 'lesson/section',
          promptVersion: 4,
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          fellBack: false,
        }) as never,
    };
    const t = server(blank);
    try {
      const teacher = await t.registerUser();
      t.services.records.put(teacher.id, 'plan', sourcePlan());
      const job = await t.ok('generation.create', {
        body: { ...withResources(), kind: 'section', planId: 'source-plan', sectionKey: 'materials' },
        token: teacher.token,
      });
      const failed = await waitFor(t, teacher.token, job.id, 'failed');
      assert.equal(failed.failure?.reason, 'empty_output');
      assert.equal(failed.result, null);
      assert.deepEqual(t.errors, []);
    } finally {
      t.close();
    }
  }
});

test('27 Nov: a week plan has as many sessions as days in its own week grid (a Saturday-only class: one)', async () => {
  const dll = { span: 'week' } as never;
  const grid = (weekdays: number[]) => [{ key: 'weekgrid', content: { type: 'weekgrid', days: weekdays.map((weekday) => ({ weekday })) } }];
  const base = { ...input(), templateId: 'tpl.dll.v1', sessions: 5 };
  assert.equal(withPlanWeekDays(base, dll, grid([6])).sessions, 1);
  assert.equal(withPlanWeekDays(base, dll, grid([1, 3, 6])).sessions, 3);
  assert.equal(withPlanWeekDays(base, dll, grid([1, 2, 3, 4, 5])).sessions, 5);
  assert.equal(withPlanWeekDays(base, dll, []).sessions, 5, 'no grid: the classic five');
  assert.equal(withPlanWeekDays(base, { span: 'session' } as never, grid([6])).sessions, 5, 'not a week plan');
  // Through a real job: the request the model gets names one Saturday session.
  let seen: { sessions?: number; schedule?: Array<{ weekday: number }> } = {};
  const capture: LlmGateway = {
    routeFor: () => 'cloud',
    complete: async (req) => {
      seen = JSON.parse(req.vars.input!);
      return { ok: false, reason: 'providers_unavailable', message: 'x' } as never;
    },
  };
  const t = server(capture);
  try {
    const teacher = await t.registerUser();
    const plan = Plan.parse({ ...sourcePlan(), templateId: 'tpl.dll.v1' });
    t.services.records.put(teacher.id, 'plan', plan);
    t.services.records.put(teacher.id, 'plan_section', PlanSection.parse({
      id: 'grid-1', planId: plan.id, key: 'weekgrid',
      content: { type: 'weekgrid', days: [{ date: '2026-11-28', weekday: 6, minutes: 30, body: [] }] },
    }));
    const job = await t.ok('generation.create', {
      body: { ...input(), templateId: 'tpl.dll.v1', sessions: 5, kind: 'full', planId: plan.id },
      token: teacher.token,
    });
    await waitFor(t, teacher.token, job.id, 'failed');
    assert.equal(seen.sessions, 1);
    assert.deepEqual(seen.schedule?.map((d) => d.weekday), [6]);
  } finally {
    t.close();
  }
});
