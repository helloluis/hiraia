import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeneratedSection, SectionContent } from '@hiraia/tala-core';
import { validateGeneratedSections } from '@hiraia/tala-core/generation';
import { evaluationCases, objectivesFor } from '../../../eval/cases';
import { fakeCompact, fakeCompactRaw } from '../../../eval/fixtures';
import { convertCompact, lessonRequest, multigradeSchedule, weekSchedule } from './compact';
const fixture = () => {
  const c = evaluationCases[0]!;
  return { ...c.input, resolvedObjectives: objectivesFor(c.input) };
};
const newId = (() => {
  let n = 0;
  return () => `local-id-${++n}`;
})();
test('compact format converts all fixtures into validated storage data with authoritative objectives', () => {
  for (const c of evaluationCases) {
    const input = { ...c.input, resolvedObjectives: objectivesFor(c.input) };
    const result = convertCompact(input, fakeCompact(input), newId);
    assert.deepEqual(validateGeneratedSections(input, result.sections), [], c.id);
    for (const s of result.sections)
      assert.equal(SectionContent.safeParse(s.content).success, true);
  }
});
test('server rotation is exact across all group counts and budgets; every grade gets a focus slot', () => {
  for (const n of [2, 3, 4])
    for (const minutes of [10, 30, 50, 60, 240, 480]) {
      const input = {
        ...fixture(),
        timeBudgetMinutes: minutes,
        gradeGroups: Array.from({ length: n }, (_, i) => ({
          id: `group-00${i + 1}`,
          grade: String(i + 1) as '1',
          learnerCount: 10,
        })),
      };
      const schedule = multigradeSchedule(input);
      assert.equal(
        schedule.reduce((sum, b) => sum + b.minutes, 0),
        minutes
      );
      for (const g of input.gradeGroups)
        assert.equal(schedule.filter((b) => b.teacherWith === g.grade).length, 1);
    }
});
test('a week plan’s schedule follows its own grid for a Saturday or Sunday class, else Monday onwards', () => {
  const week = evaluationCases.find((c) => c.id === 'weekly-dll-fil')!;
  const input = { ...week.input, resolvedObjectives: objectivesFor(week.input) };
  const grid = (weekdays: number[]) => [
    { key: 'objectives', content: { type: 'list', items: [] } },
    {
      key: 'weekgrid',
      content: {
        type: 'weekgrid',
        days: weekdays.map((weekday, i) => ({ date: `2026-11-2${3 + i}`, weekday, body: [] })),
      },
    },
  ];
  const days = (sessions: number, source?: unknown) =>
    weekSchedule({ ...input, sessions }, source).map((d) => d.weekday);
  // The classic DLL, with or without its own grid: Monday to Friday, as before.
  assert.deepEqual(days(5), [1, 2, 3, 4, 5]);
  assert.deepEqual(days(5, grid([1, 2, 3, 4, 5])), [1, 2, 3, 4, 5]);
  // Monday, Wednesday and Saturday; Saturday and Sunday: the plan's own days.
  assert.deepEqual(days(3, grid([1, 3, 6])), [1, 3, 6]);
  assert.deepEqual(days(2, grid([7, 6])), [6, 7]);
  // A grid that does not have one day per session is not trusted.
  assert.deepEqual(days(5, grid([1, 3, 6])), [1, 2, 3, 4, 5]);
  assert.deepEqual(days(3, 'not a plan'), [1, 2, 3]);
  assert.ok(
    weekSchedule({ ...input, sessions: 3 }, grid([1, 3, 6])).every((d) => d.minutes === 40)
  );
  // The request tells the model those days and accepts three days back.
  const req = lessonRequest(
    { ...input, sessions: 3 },
    { userId: 'teacher-001', newId, source: grid([1, 3, 6]) }
  );
  const vars = JSON.parse(req.vars.input!) as { sessions: number; schedule: { weekday: number }[] };
  assert.equal(vars.sessions, 3);
  assert.deepEqual(
    vars.schedule.map((d) => d.weekday),
    [1, 3, 6]
  );
  const wire = fakeCompactRaw({ ...input, sessions: 3 });
  const days3 = wire.sections.find((x) => x.key === 'weekgrid')! as { days: { weekday: number }[] };
  days3.days = days3.days.map((d, i) => ({ ...d, weekday: [1, 3, 6][i]! }));
  const parsed = req.schema.safeParse(wire);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(req.check!(parsed.data), []);
    const out = parsed.data.sections.find((x) => x.key === 'weekgrid')!.content;
    assert.deepEqual(out.type === 'weekgrid' && out.days.map((d) => d.weekday), [1, 3, 6]);
  }
});
test('missing/duplicate slots and hallucinated objective refs are refused, never repaired silently', () => {
  const input = fixture(),
    raw = fakeCompact(input);
  const block = raw.sections.find((s) => s.key === 'multigrade')!;
  block.blocks[0]!.slot = 2;
  assert.throws(() => convertCompact(input, raw, newId), /schedule_slots/);
  const bad = fakeCompact(input);
  bad.sections.find((s) => s.key === 'objectives')!.groups[0]!.targets = ['invented'];
  assert.throws(() => convertCompact(input, bad, newId), /objective_reference/);
});
test('request validation checks missing groups and is shared by all providers', () => {
  const input = fixture(),
    req = lessonRequest(input, { userId: 'teacher-001', newId });
  assert.equal(req.version, 4);
  assert.equal(req.maxOutputTokens, 8192);
  const raw = fakeCompact(input);
  raw.sections.find((s) => s.key === 'multigrade')!.blocks[0]!.activities.pop();
  const wire = fakeCompactRaw(input);
  const block = wire.sections.find((s) => s.key === 'multigrade')!;
  if ('blocks' in block) block.blocks!.at(0)!.activities.pop();
  const converted = req.schema.safeParse(wire);
  assert.equal(converted.success, true);
  if (converted.success) assert.ok(req.check!(converted.data).some((e) => e.includes('activity')));
});
test('v1 rollback keeps the storage-format schema', () => {
  const input = fixture(),
    req = lessonRequest(input, { userId: 'teacher-001', newId, version: 1 });
  const output = convertCompact(input, fakeCompact(input), newId);
  assert.equal(req.version, 1);
  assert.equal(req.schema.safeParse(output).success, true);
});
test('translation changes only allowlisted text leaves and preserves IDs and timeline structure', () => {
  const input = fixture(),
    source = convertCompact(input, fakeCompact(input), newId).sections;
  const req = lessonRequest(
    { ...input, kind: 'translate', targetLanguage: 'fil' },
    { userId: 'teacher-001', newId, source }
  );
  const vars = JSON.parse(req.vars.input!) as { leaves: { path: string; text: string }[] };
  const parsed = req.schema.safeParse({
    translations: vars.leaves.map((l) => ({ ...l, text: 'Isinaling teksto.' })),
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    for (const s of parsed.data.sections)
      assert.equal(SectionContent.safeParse(s.content).success, true);
    const original = source.find((s) => s.key === 'multigrade')!.content;
    const translated = parsed.data.sections.find((s) => s.key === 'multigrade')!.content;
    if (original.type === 'multigrade' && translated.type === 'multigrade') {
      assert.equal(original.blocks[0]!.id, translated.blocks[0]!.id);
      assert.equal(original.blocks[0]!.minutes, translated.blocks[0]!.minutes);
    }
  }
  assert.equal(req.schema.safeParse({ translations: [] }).success, false);
});

test('every lesson prompt receives per-grade counts and the 15-learner total, never roster fields', () => {
  const input = {
    ...fixture(),
    gradeGroups: [
      {
        id: 'grade-3',
        grade: '3' as const,
        learnerCount: 6,
        students: [{ name: 'Roster Canary Never Send' }],
      },
      { id: 'grade-4', grade: '4' as const, learnerCount: 5 },
      { id: 'grade-5', grade: '5' as const, learnerCount: 4 },
    ],
    roster: [{ name: 'Roster Canary Never Send' }],
  };
  for (const kind of ['full', 'section', 'adapt', 'translate'] as const) {
    const request = lessonRequest(
      { ...input, kind, sectionKey: 'materials', targetLanguage: 'fil' },
      { userId: 'teacher', newId, version: 3, source: [] }
    );
    const data = JSON.parse(request.vars.input!) as {
      groups: { grade: string; learnerCount?: number }[];
      totalLearnerCount: number;
    };
    assert.deepEqual(
      data.groups.map((g) => [g.grade, g.learnerCount]),
      [
        ['3', 6],
        ['4', 5],
        ['5', 4],
      ]
    );
    assert.equal(data.totalLearnerCount, 15);
    assert.equal(request.version, 3);
    assert.equal(request.vars.input!.includes('Roster Canary Never Send'), false);
    assert.equal(request.vars.input!.includes('students'), false);
    assert.equal(request.vars.input!.includes('roster'), false);
  }
  for (const templateId of ['tpl.dlp.v1', 'tpl.dll.v1']) {
    const request = lessonRequest(
      { ...input, templateId, gradeGroups: [input.gradeGroups[0]!] },
      { userId: 'teacher', newId, version: 3 }
    );
    const data = JSON.parse(request.vars.input!);
    assert.equal(data.totalLearnerCount, 6);
    assert.equal(data.groups[0].learnerCount, 6);
    assert.equal(request.vars.input!.includes('Roster Canary Never Send'), false);
  }
});

test('unknown learner counts and unknown class totals are omitted rather than guessed', () => {
  const input = {
    ...fixture(),
    gradeGroups: [
      { id: 'grade-3', grade: '3' as const, learnerCount: 6 },
      { id: 'grade-4', grade: '4' as const, learnerCount: null },
      { id: 'grade-5', grade: '5' as const, learnerCount: 0 },
    ],
  };
  for (const kind of ['full', 'translate'] as const) {
    const request = lessonRequest(
      { ...input, kind },
      { userId: 'teacher', newId, version: 3, source: [] }
    );
    const data = JSON.parse(request.vars.input!);
    assert.equal(data.groups[0].learnerCount, 6);
    assert.equal(Object.hasOwn(data.groups[1], 'learnerCount'), false);
    assert.equal(data.groups[2].learnerCount, 0);
    assert.equal(Object.hasOwn(data, 'totalLearnerCount'), false);
  }
});

test('v4 is the default while explicit v2 remains available for rollback', () => {
  const input = fixture();
  for (const kind of ['full', 'translate'] as const) {
    const options = { userId: 'teacher', newId, source: [] };
    assert.equal(lessonRequest({ ...input, kind }, options).version, 4);
    assert.equal(lessonRequest({ ...input, kind }, { ...options, version: 2 }).version, 2);
  }
});

test('authoritative objectives and assessment discard exact and partial repeats but retain genuine additions', () => {
  const input = fixture();
  for (const key of ['objectives', 'assessment']) {
    for (const mode of ['exact', 'partial', 'addition']) {
      const raw = fakeCompact(input);
      const group = raw.sections.find((s) => s.key === key)!.groups[0]!;
      const baseline = convertCompact(input, raw, newId).sections.find((s) => s.key === key)!;
      assert.equal(baseline.content.type, 'pergroup');
      if (baseline.content.type !== 'pergroup') throw Error('fixture');
      const blocks = Object.values(baseline.content.groups)[0]!;
      const stored = (blocks[0] as { spans: { text: string }[] }).spans[0]!.text;
      group.text =
        mode === 'exact'
          ? stored.toUpperCase() + '!!!'
          : mode === 'partial'
            ? stored.split(/\s+/).slice(-4).join(' ')
            : 'Ipaliwanag gamit ang sariling halimbawa.';
      const result = convertCompact(input, raw, newId).sections.find((s) => s.key === key)!;
      assert.equal(result.content.type, 'pergroup');
      if (result.content.type !== 'pergroup') throw Error('fixture');
      const actual = Object.values(result.content.groups)[0]!;
      assert.equal(actual.length, group.targets.length + (mode === 'addition' ? 1 : 0));
      assert.equal((actual[0] as { spans: { text: string }[] }).spans[0]!.text, stored);
    }
  }
});

test('post-class sections never reach the model or generated output; pre-class notes use their own field', () => {
  const input = fixture();
  const source = [
    {
      key: 'reflection',
      content: {
        type: 'text',
        blocks: [{ t: 'p', spans: [{ text: 'Private after-class observation' }] }],
      },
    },
  ];
  for (const kind of ['full', 'adapt', 'translate'] as const) {
    const req = lessonRequest(
      { ...input, kind },
      { userId: 'teacher', newId, source, prior: source }
    );
    assert.equal(req.vars.input!.includes('Private after-class observation'), false);
    if (kind === 'translate') continue;
    const raw = fakeCompactRaw(input);
    const flow = raw.sections.find((s) => s.key === 'multigrade')!;
    Object.assign(flow, { note: 'Each grade has one focused turn today.' });
    const result = req.schema.parse(raw);
    assert.ok(result.sections.every((s) => !['results', 'reflection'].includes(s.key)));
    const content = result.sections.find((s) => s.key === 'multigrade')!.content;
    assert.equal(
      content.type === 'multigrade' && content.note,
      'Each grade has one focused turn today.'
    );
    assert.equal(
      req.schema.safeParse({
        ...raw,
        sections: [...raw.sections, { key: 'reflection', text: 'Invented after class.' }],
      }).success,
      false
    );
    Object.assign(flow, { note: 'x'.repeat(601) });
    assert.equal(req.schema.safeParse(raw).success, false);
  }
  assert.throws(
    () =>
      lessonRequest(
        { ...input, kind: 'section', sectionKey: 'reflection' },
        { userId: 'teacher', newId }
      ),
    /post_class_section/
  );
});
