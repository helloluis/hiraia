import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TEMPLATES, type ClassRecord } from '@hiraia/tala-core/contracts';
import { lockProblems, newPlan, planDates, isSectionEmpty, weekPlanDays } from './plans';
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

const subject = (weekdays: number[]) => ({
  id: 'sci',
  classId: 'c',
  learningAreaId: 'science',
  subjectName: 'Science',
  gradeGroupIds: ['g3'],
  language: 'fil' as const,
  slots: weekdays.map((weekday) => ({
    id: `sci-${weekday}`,
    weekday,
    startTime: null,
    minutes: 50,
    rotation: null,
  })),
});
const gridOf = (sections: Array<{ key: string; content: unknown }>) =>
  (sections.find((s) => s.key === 'weekgrid')!.content as { days: Array<{ date: string | null; weekday: number }> })
    .days;

test('a DLL for a weekday-only subject is the classic Monday-to-Friday grid, placed on its one date', () => {
  const dll = BUILTIN_TEMPLATES.find((t) => t.kind === 'dll')!;
  for (const days of [
    [1, 2, 3, 4, 5],
    [1, 3, 5],
  ]) {
    const { plan, sections } = newPlan({
      template: dll,
      cls,
      assignment: subject(days),
      dates: ['2026-11-25'],
      language: 'en',
      newId,
    });
    assert.deepEqual(
      gridOf(sections).map((d) => [d.weekday, d.date]),
      [
        [1, '2026-11-23'],
        [2, '2026-11-24'],
        [3, '2026-11-25'],
        [4, '2026-11-26'],
        [5, '2026-11-27'],
      ]
    );
    assert.deepEqual(planDates(plan), ['2026-11-25']);
  }
  assert.deepEqual(
    weekPlanDays(null, null).map((d) => [d.weekday, d.date]),
    [1, 2, 3, 4, 5].map((w) => [w, null])
  );
});

test('a DLL for a Saturday or Sunday class lays out the days the subject meets and is placed on each of them', () => {
  const dll = BUILTIN_TEMPLATES.find((t) => t.kind === 'dll')!;
  const mws = newPlan({
    template: dll,
    cls,
    assignment: subject([1, 3, 6]),
    dates: ['2026-11-28'],
    language: 'fil',
    newId,
  });
  assert.deepEqual(
    gridOf(mws.sections).map((d) => [d.weekday, d.date]),
    [
      [1, '2026-11-23'],
      [3, '2026-11-25'],
      [6, '2026-11-28'],
    ]
  );
  assert.deepEqual(planDates(mws.plan), ['2026-11-23', '2026-11-25', '2026-11-28']);
  assert.equal(mws.plan.placements[0]!.assignmentId, 'sci');
  // Made from a Sunday: the week is the Monday-to-Sunday week that Sunday ends.
  const weekend = newPlan({
    template: dll,
    cls,
    assignment: subject([7, 6]),
    dates: ['2026-11-29'],
    language: 'fil',
    newId,
  });
  assert.deepEqual(planDates(weekend.plan), ['2026-11-28', '2026-11-29']);
  assert.deepEqual(gridOf(weekend.sections).map((d) => d.weekday), [6, 7]);
  // Without a date the days are still the subject's own, undated.
  assert.deepEqual(
    weekPlanDays(subject([1, 3, 6]), null).map((d) => [d.weekday, d.date]),
    [
      [1, null],
      [3, null],
      [6, null],
    ]
  );
  // A session plan for a Saturday class is just that Saturday.
  const dlp = BUILTIN_TEMPLATES.find((t) => t.kind === 'dlp')!;
  const one = newPlan({
    template: dlp,
    cls,
    assignment: subject([1, 3, 6]),
    dates: ['2026-11-28'],
    language: 'fil',
    newId,
  });
  assert.deepEqual(planDates(one.plan), ['2026-11-28']);
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
