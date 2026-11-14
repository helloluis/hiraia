import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TEMPLATES, type ClassRecord } from '@hiraia/tala-core/contracts';
import { lockProblems, newPlan, planDates, isSectionEmpty } from './plans';
import { backoffDelay, withRetry } from './retry';

let n = 0;
const newId = () => `id${++n}`;
const cls: ClassRecord = {
  id: 'c',
  schoolYearId: 'y',
  name: 'X',
  curriculum: 'deped',
  gradeGroups: [
    { id: 'g3', grade: '3', learnerCount: null },
    { id: 'g4', grade: '4', learnerCount: null },
  ],
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
};

test('newPlan builds a multigrade plan with per-group sections and a DLL with dated week days', () => {
  const mg = BUILTIN_TEMPLATES.find((t) => t.kind === 'multigrade')!;
  const { plan, sections } = newPlan({
    template: mg,
    cls,
    assignment: null,
    dates: ['2026-11-18'],
    language: 'fil',
    newId,
  });
  assert.deepEqual(plan.gradeGroupIds, ['g3', 'g4']);
  assert.deepEqual(plan.grades, ['3', '4']);
  const per = sections.find((s) => s.key === 'objectives')!;
  assert.equal(per.content.type, 'pergroup');
  assert.deepEqual(Object.keys((per.content as { groups: Record<string, unknown> }).groups), [
    'g3',
    'g4',
  ]);
  const dll = BUILTIN_TEMPLATES.find((t) => t.kind === 'dll')!;
  const week = newPlan({
    template: dll,
    cls,
    assignment: null,
    dates: ['2026-11-18'],
    language: 'en',
    newId,
  });
  const grid = week.sections.find((s) => s.key === 'weekgrid')!.content;
  assert.equal(grid.type, 'weekgrid');
  assert.deepEqual(
    (grid as { days: Array<{ date: string | null }> }).days.map((d) => d.date),
    ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']
  );
  assert.deepEqual(planDates(plan), ['2026-11-18']);
});

test('lockProblems lists empty required sections and the missing competency (DOC-1)', () => {
  const dlp = BUILTIN_TEMPLATES[0]!;
  const { plan, sections } = newPlan({
    template: dlp,
    cls,
    assignment: null,
    dates: [],
    language: 'fil',
    newId,
  });
  const problems = lockProblems(plan, sections, dlp, cls);
  const keys = problems
    .filter((p) => p.kind === 'empty')
    .map((p) => (p as { key: string }).key)
    .sort();
  assert.deepEqual(keys, ['assessment', 'materials', 'objectives', 'procedure']);
  assert.ok(problems.some((p) => p.kind === 'competency'));
  assert.equal(
    isSectionEmpty({ type: 'text', blocks: [{ t: 'p', spans: [{ text: '  ' }] }] }),
    true
  );
  assert.equal(isSectionEmpty({ type: 'list', items: ['a'] }), false);
});

test('withRetry retries retryable errors with capped, jittered backoff and gives up at max', async () => {
  const delays: number[] = [];
  let calls = 0;
  const err = Object.assign(new Error('x'), { retryable: true });
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        throw err;
      },
      {
        max: 4,
        baseMs: 1000,
        capMs: 60_000,
        sleep: async (ms) => void delays.push(ms),
        random: () => 0.5,
      }
    )
  );
  assert.equal(calls, 4);
  assert.deepEqual(delays, [750, 1500, 3000]);
  assert.equal(
    backoffDelay(10, 1000, 60_000, () => 1),
    60_000
  );
  let once = 0;
  const v = await withRetry(
    async () =>
      once++ === 0 ? Promise.reject(Object.assign(new Error('n'), { retryable: false })) : 1,
    { sleep: async () => {} }
  ).catch((e) => e);
  assert.equal(v instanceof Error, true, 'non-retryable errors are thrown at once');
});
