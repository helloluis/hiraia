import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  inferCurriculumTerm,
  termCurriculumMultiplier,
  TERM_SCHEDULE,
  SY_2026_27,
} from '../../shared/src/curriculum/index.ts';
import { lessonsForGrade, lessonByKey, planLesson } from '../src/data/lessonPlan.ts';

const date = (value: string) => new Date(`${value}T12:00:00`);
test('term inference respects boundaries, Christmas review, and year-end blocks', () => {
  for (const [day, term, week] of [
    ['2026-06-07', null, 1],
    ['2026-06-08', 1, 1],
    ['2026-06-22', 1, 2],
    ['2026-09-15', 1, 11],
    ['2026-09-16', 2, 1],
    ['2026-12-25', 2, 11],
    ['2027-01-04', 3, 1],
    ['2027-04-08', 3, 11],
    ['2027-04-09', null, 1],
  ] as const) {
    assert.deepEqual(
      inferCurriculumTerm(date(day), SY_2026_27),
      { term, week, inSchoolYear: term !== null },
      day
    );
  }
});
test('all old codes remain addressable; BOW coverage excludes supporting objectives', () => {
  const codes = ['elementary', 'jhs'].flatMap((part) =>
    JSON.parse(
      readFileSync(
        new URL(
          `../../../rag/sources/curriculum-guides/matatag-${part}-competencies.json`,
          import.meta.url
        ),
        'utf8'
      )
    ).quarters.flatMap((q: any) => q.competencies.map((c: any) => c.code))
  );
  assert.deepEqual(new Set(Object.keys(TERM_SCHEDULE)), new Set(codes));
  assert.equal(Object.values(TERM_SCHEDULE).filter((x) => x.status === 'listed').length, 322);
  assert.deepEqual(
    Object.entries(TERM_SCHEDULE)
      .filter(([, v]) => v.status === 'supporting')
      .map(([k]) => k)
      .sort(),
    ['G6-F-7', 'G6-F-9']
  );
  for (const row of Object.values(TERM_SCHEDULE)) {
    assert.ok([1, 2, 3].includes(row.term));
    assert.ok(row.weeks[0]! >= 1 && row.weeks[1]! <= 11 && row.weeks[0]! <= row.weeks[1]!);
  }
});
test('Grade 3 uses the official 10/10/14 split; Grade 10 starts with chemistry', () => {
  assert.deepEqual(
    [1, 2, 3].map(
      (term) => Object.values(TERM_SCHEDULE).filter((r) => r.grade === 3 && r.term === term).length
    ),
    [10, 10, 14]
  );
  assert.equal(TERM_SCHEDULE['G3-L-1']!.term, 1);
  assert.equal(TERM_SCHEDULE['G3-F-3']!.term, 2);
  assert.equal(TERM_SCHEDULE['G3-F-4']!.term, 3);
  assert.equal(lessonsForGrade(10)[0]!.codes[0], 'G10-M-1');
  for (const grade of [3, 4, 5, 6, 7, 8, 9, 10]) {
    const lessons = lessonsForGrade(grade);
    assert.equal(new Set(lessons.map((l) => l.key)).size, lessons.length);
    assert.deepEqual(
      lessons.map((l) => l.order),
      lessons.map((l) => l.order).sort((a, b) => a - b)
    );
    for (const lesson of lessons)
      for (const code of lesson.codes) assert.equal(TERM_SCHEDULE[code]!.term, lesson.term);
  }
});
test('Grade 5 adaptations split by term, retaining old key and objective IDs', () => {
  assert.deepEqual(lessonByKey('g5:adaptations')!.codes, ['G5-L-8']);
  assert.deepEqual(lessonByKey('g5:adaptations:term2')!.codes, ['G5-L-9']);
  const old = JSON.parse(
    readFileSync(new URL('../src/generated/grade5Lessons.generated.json', import.meta.url), 'utf8')
  ).lessons.find((l: any) => l.key === 'g5:adaptations');
  assert.deepEqual(
    new Set(
      ['g5:adaptations', 'g5:adaptations:term2'].flatMap((key) =>
        lessonByKey(key)!.units.map((u) => u.id)
      )
    ),
    new Set(old.units.map((u: any) => u.id))
  );
});
test('unchanged lesson saved runs preserve exact cards and completion after rescheduling', () => {
  const lesson = lessonsForGrade(10)[0]!;
  const run = planLesson(lesson, new Set(), undefined, 42);
  run.completed = run.cards.slice(0, 4);
  assert.deepEqual(planLesson(lesson, new Set(run.completed), run), run);
});
test('feed favours actual terms even when two competencies share the same old quarter', () => {
  const tag = (code: string) => ({
    competency: code,
    codes: [code],
    grade: 3,
    quarter: 3 as const,
    confidence: 1,
  });
  assert.ok(
    termCurriculumMultiplier(tag('G3-F-3'), 3, 2) > termCurriculumMultiplier(tag('G3-F-4'), 3, 2)
  );
  assert.ok(
    termCurriculumMultiplier(tag('G3-F-4'), 3, 3) > termCurriculumMultiplier(tag('G3-F-3'), 3, 3)
  );
  assert.equal(
    termCurriculumMultiplier(tag('G3-F-4'), 3, null),
    termCurriculumMultiplier(tag('G3-F-3'), 3, null)
  );
});
