import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createSyncEngine } from '@hiraia/tala-core/sync';
import {
  BUILTIN_TEMPLATES,
  type ClassRecord,
  type GenerationJob,
} from '@hiraia/tala-core/contracts';
import { applyGenerationJob, buildGenerationInput, hasObjectives, prefillPlan } from './generation';
import { newPlan } from './plans';

let n = 0;
const newId = () => `id${++n}`;
const cls: ClassRecord = {
  id: 'c',
  schoolYearId: 'y',
  name: 'Multigrade A',
  curriculum: 'deped',
  gradeGroups: [
    { id: 'g2', grade: '2', learnerCount: 11 },
    { id: 'g4', grade: '4', learnerCount: 8 },
  ],
  languages: ['fil'],
  profile: {
    materials: ['chalkboard'],
    textbooks: [],
    electricity: false,
    projector: null,
    printing: null,
    outdoorSpace: true,
    notes: '',
  },
  isSample: false,
  archived: false,
};
const offline = {
  push: () =>
    Promise.reject(Object.assign(new Error('offline'), { code: 'network', retryable: true })),
  pull: () =>
    Promise.reject(Object.assign(new Error('offline'), { code: 'network', retryable: true })),
};
const engineFor = () =>
  createSyncEngine({
    store: createMemoryStore(),
    transport: offline as never,
    deviceId: 'd',
    now: () => new Date(),
    newId,
  });

test('buildGenerationInput carries counts only, competencies per group, class profile and time budget', () => {
  const mg = BUILTIN_TEMPLATES.find((t) => t.kind === 'multigrade')!;
  const { plan } = newPlan({
    template: mg,
    cls,
    assignment: null,
    dates: ['2026-11-18'],
    language: 'fil',
    competencies: { g2: ['sci.g2.1'], g4: ['sci.g4.1', 'sci.g4.2'] },
    curriculumVersion: 'v1',
    newId,
  });
  const input = buildGenerationInput({
    plan,
    cls,
    template: mg,
    language: 'fil',
    guidance: 'use the garden',
  });
  assert.equal(input.kind, 'full');
  assert.deepEqual(input.gradeGroups, [
    { id: 'g2', grade: '2', learnerCount: 11 },
    { id: 'g4', grade: '4', learnerCount: 8 },
  ]);
  assert.deepEqual(input.competencies, { g2: ['sci.g2.1'], g4: ['sci.g4.1', 'sci.g4.2'] });
  assert.equal(input.timeBudgetMinutes, 50);
  assert.equal(input.classProfile.materials[0], 'chalkboard');
  assert.equal(JSON.stringify(input).includes('learnerName'), false);
  assert.equal(hasObjectives(input), true);
  assert.equal(hasObjectives({ ...input, competencies: {}, customObjectives: [] }), false);
});

test('a week plan asks for five sessions, or one per day for a Saturday or Sunday class', () => {
  const dll = BUILTIN_TEMPLATES.find((t) => t.kind === 'dll')!;
  const dlp = BUILTIN_TEMPLATES.find((t) => t.kind === 'dlp')!;
  const single: ClassRecord = { ...cls, gradeGroups: [cls.gradeGroups[1]!] };
  const subject = (weekdays: number[]) => ({
    id: 'sci',
    classId: 'c',
    learningAreaId: 'science',
    subjectName: 'Science',
    gradeGroupIds: ['g4'],
    language: 'fil' as const,
    slots: weekdays.map((weekday) => ({
      id: `sci-${weekday}`,
      weekday,
      startTime: null,
      minutes: 40,
      rotation: null,
    })),
  });
  const sessions = (template: typeof dll, weekdays: number[] | null, date: string) =>
    buildGenerationInput({
      plan: newPlan({
        template,
        cls: single,
        assignment: weekdays ? subject(weekdays) : null,
        dates: [date],
        language: 'fil',
        newId,
      }).plan,
      cls: single,
      template,
      language: 'fil',
    }).sessions;
  // Weekday-only week plans are five sessions, as before, whatever their date.
  assert.equal(sessions(dll, null, '2026-11-25'), 5);
  assert.equal(sessions(dll, [1, 3, 5], '2026-11-25'), 5);
  assert.equal(sessions(dll, [1, 2, 3, 4, 5], '2026-11-28'), 5); // a DLL made on a Saturday
  // Week plans laid out on Saturday or Sunday classes: one session per day the subject meets.
  assert.equal(sessions(dll, [1, 3, 6], '2026-11-25'), 3);
  assert.equal(sessions(dll, [6, 7], '2026-11-29'), 2);
  assert.equal(sessions(dll, [1, 2, 3, 4, 5, 6], '2026-11-23'), 6);
  assert.equal(sessions(dlp, [1, 3, 6], '2026-11-28'), 1);
});

test('applyGenerationJob writes revisions before replacements, marks the plan AI draft, as one batch', async () => {
  const engine = engineFor();
  const mg = BUILTIN_TEMPLATES.find((t) => t.kind === 'multigrade')!;
  const { plan, sections } = newPlan({
    template: mg,
    cls,
    assignment: null,
    dates: ['2026-11-18'],
    language: 'fil',
    newId,
  });
  await engine.batch([
    { op: 'put', entity: 'plan', data: plan },
    ...sections.map((s) => ({ op: 'put' as const, entity: 'plan_section' as const, data: s })),
  ]);
  const gen = {
    provider: 'fake',
    model: 'fake-1',
    promptId: 'lesson/multigrade',
    promptVersion: 2,
    curriculumVersion: null,
    at: '2026-11-16T00:00:00.000Z',
  };
  const job: GenerationJob = {
    id: 'job1',
    status: 'done',
    kind: 'full',
    planId: plan.id,
    createdAt: gen.at,
    finishedAt: gen.at,
    failure: null,
    result: {
      title: 'Mga Anyo ng Bagay',
      provider: 'fake',
      model: 'fake-1',
      warnings: [],
      sections: [
        {
          key: 'objectives',
          content: {
            type: 'pergroup',
            groups: {
              g2: [{ t: 'p', spans: [{ text: 'G2 goal' }] }],
              g4: [{ t: 'p', spans: [{ text: 'G4 goal' }] }],
            },
          },
          gen,
        },
        {
          key: 'reflection',
          content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'after' }] }] },
          gen,
        },
      ],
    },
  };
  const applied = await applyGenerationJob(engine, plan, sections, job, newId);
  assert.equal(applied.aiDraft, true);
  assert.equal(applied.title, 'Mga Anyo ng Bagay');
  const stored = await engine.list('plan_section');
  const obj = stored.find((s) => s.data.key === 'objectives')!;
  assert.equal(obj.data.origin, 'ai');
  assert.equal(obj.data.gen?.model, 'fake-1');
  const revs = await engine.list('section_revision');
  assert.ok(revs.length >= 1, 'previous text kept as section_revision (LLM-4)');
  assert.ok(revs.every((r) => r.data.planId === plan.id));
});

test('prefillPlan fills empty sections from the pre-filled template and never touches teacher text', async () => {
  const engine = engineFor();
  const dlp = BUILTIN_TEMPLATES[0]!;
  const single: ClassRecord = { ...cls, gradeGroups: [cls.gradeGroups[0]!] };
  const { plan, sections } = newPlan({
    template: dlp,
    cls: single,
    assignment: null,
    dates: [],
    language: 'en',
    competencies: { g2: ['sci.g2.1'] },
    newId,
  });
  const edited = sections.map((s) =>
    s.key === 'assessment'
      ? {
          ...s,
          editedByTeacher: true,
          content: {
            type: 'text' as const,
            blocks: [{ t: 'p' as const, spans: [{ text: 'mine' }] }],
          },
        }
      : s
  );
  await engine.batch([
    { op: 'put', entity: 'plan', data: plan },
    ...edited.map((s) => ({ op: 'put' as const, entity: 'plan_section' as const, data: s })),
  ]);
  const input = buildGenerationInput({ plan, cls: single, template: dlp, language: 'en' });
  await prefillPlan(engine, plan, edited, input, dlp, [
    {
      id: 'sci.g2.1',
      text: 'Describe solids',
      code: null,
      learningAreaId: 'science',
      grade: '2',
      termIndex: 1,
      sequence: 0,
      textLang: 'en',
      contentStandard: null,
      performanceStandard: null,
      domain: null,
      weight: null,
      weightSource: 'estimated',
      source: { document: 'x', edition: null, page: null, url: null },
    },
  ]);
  const stored = await engine.list('plan_section');
  const objectives = stored.find((s) => s.data.key === 'objectives')!.data.content;
  assert.equal(objectives.type, 'list');
  assert.deepEqual((objectives as { items: string[] }).items, ['Describe solids']);
  const procedure = stored.find((s) => s.data.key === 'procedure')!.data.content as {
    steps: Array<{ minutes: number }>;
  };
  assert.equal(procedure.steps[0]?.minutes, 50);
  const assessment = stored.find((s) => s.data.key === 'assessment')!.data.content as {
    blocks: Array<{ spans: Array<{ text: string }> }>;
  };
  assert.equal(assessment.blocks[0]?.spans[0]?.text, 'mine');
});

test('27 Nov fix: a queued request that ends without a result is kept for the lesson to show, never dropped silently', async () => {
  const { recordFailure, listFailures, clearFailure, failureReason } = await import('./generation');
  const { TalaApiError } = await import('@hiraia/tala-core/contracts');
  const store = new Map<string, unknown>();
  const cache = {
    get: async <T,>(k: string) => (store.has(k) ? (store.get(k) as T) : null),
    set: async <T,>(k: string, v: T) => void store.set(k, v),
    remove: async (k: string) => void store.delete(k),
    keys: async () => [...store.keys()],
    clear: async () => store.clear(),
  };
  await recordFailure(cache, { id: 'q1', planId: 'p1', sectionKey: 'materials', reason: 'empty_output', at: 'x' });
  await recordFailure(cache, { id: 'q2', planId: 'p2', sectionKey: null, reason: 'providers_unavailable', at: 'y' });
  await recordFailure(cache, { id: 'q1', planId: 'p1', sectionKey: 'materials', reason: 'empty_output', at: 'z' });
  assert.deepEqual((await listFailures(cache)).map((f) => f.id), ['q2', 'q1']);
  await clearFailure(cache, 'q2');
  assert.deepEqual((await listFailures(cache)).map((f) => f.id), ['q1']);
  assert.equal(failureReason(new TalaApiError('invalid_input', 'x', 400, { reason: 'no_class_resources' })), 'no_class_resources');
  assert.equal(failureReason(new TalaApiError('invalid_input', 'x', 400)), 'invalid_input');
  assert.equal(failureReason(new Error('boom')), 'providers_unavailable');
});

test('27 Nov: the pre-filled fallback keeps a week plan’s own days (a Mon/Wed/Sat class is never moved to Mon–Wed)', async () => {
  const engine = engineFor();
  const dll = BUILTIN_TEMPLATES.find((t) => t.kind === 'dll')!;
  const single: ClassRecord = { ...cls, gradeGroups: [cls.gradeGroups[0]!] };
  const { plan, sections } = newPlan({ template: dll, cls: single, assignment: null, dates: [], language: 'en', competencies: { g2: ['sci.g2.1'] }, newId });
  const grid = sections.map((s) =>
    s.key === 'weekgrid'
      ? { ...s, content: { type: 'weekgrid' as const, days: [1, 3, 6].map((weekday, i) => ({ date: ['2026-11-23', '2026-11-25', '2026-11-28'][i]!, weekday, minutes: null, body: [] })) } }
      : s
  );
  await engine.batch([{ op: 'put', entity: 'plan', data: plan }, ...grid.map((s) => ({ op: 'put' as const, entity: 'plan_section' as const, data: s }))]);
  const input = { ...buildGenerationInput({ plan, cls: single, template: dll, language: 'en' }), sessions: 3 };
  await prefillPlan(engine, plan, grid, input, dll, []);
  const stored = (await engine.list('plan_section')).find((s) => s.data.key === 'weekgrid')!.data.content as { days: Array<{ date: string | null; weekday: number; minutes: number | null }> };
  assert.deepEqual(stored.days.map((d) => [d.date, d.weekday]), [['2026-11-23', 1], ['2026-11-25', 3], ['2026-11-28', 6]]);
  assert.ok(stored.days.every((d) => d.minutes !== null), 'minutes filled from the template');
});
