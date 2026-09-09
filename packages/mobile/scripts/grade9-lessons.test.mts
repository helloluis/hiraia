import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { grade9Lessons, planLesson, lessonFactId, lessonsForGrade } from '../src/data/lessonPlan';
import { loadCards } from './load-cards-node.mts';
const C = await loadCards();
const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const context = (c: any) => ({
  studentGrade: 9,
  currentQuarter: 1,
  now: 123,
  cardSeen: new Map(),
  competencySeen: new Map(),
  curriculum: { ids: c.idSet },
});
test('Grade 9 covers all 46 competencies, all categories and every core quiz slot', () => {
  const guide = read('../../../rag/sources/curriculum-guides/matatag-jhs-competencies.json');
  const expected = guide.quarters
    .filter((q: any) => q.grade === 9)
    .flatMap((q: any) => q.competencies.map((c: any) => c.code));
  assert.equal(expected.length, 46);
  assert.deepEqual(new Set(grade9Lessons.flatMap((l) => l.codes)), new Set(expected));
  assert.deepEqual(
    C.curriculumOutline(9).map((l: any) => l.key),
    grade9Lessons.map((l) => l.key)
  );
  for (const l of grade9Lessons) {
    const run = planLesson(l, new Set());
    assert.ok([20, 30].includes(l.target));
    assert.ok(run.cards.length <= l.target);
    for (const u of l.units) {
      assert.ok(
        u.quizCardIds.some((id) => run.cards.includes(id)),
        u.id
      );
      for (const id of u.quizCardIds) assert.ok(C.questionForFact(id), id);
    }
  }
  const cross = read('../../../docs/grade9-subcategory-crosswalk.json').mapping;
  const inventory = read('../src/generated/cardsIndex.generated.json').cards;
  assert.deepEqual(
    new Set(cross.map((r: any) => r.subcategory_id)),
    new Set(
      inventory.flatMap((c: any) => (c.cats ?? []).filter((x: string) => x.startsWith('g9-')))
    )
  );
});
test('Grade 9 real feed walks each planned lesson, restores after every card and wraps', () => {
  let cursor = C.curriculumCursor(9, grade9Lessons[0]!.key);
  let current = null;
  const seen = new Set<string>();
  for (const lesson of grade9Lessons) {
    assert.equal(cursor.key, lesson.key);
    const order = [...cursor.lessonRun.cards];
    for (const id of order) {
      const next = C.jumpCard(current, seen, context(cursor));
      assert.equal(next.id, id);
      seen.add(id);
      current = id;
      cursor = C.advanceCurriculum(cursor, id, seen);
      cursor = C.curriculumCursor(
        9,
        cursor.key,
        seen,
        JSON.parse(JSON.stringify(cursor.lessonRun))
      );
      const choices = C.nextChoices(id, seen, 'english', { ctx: context(cursor) });
      assert.equal(choices.length, 1);
      assert.ok(cursor.idSet.has(choices[0].factId));
    }
  }
  assert.equal(cursor.key, grade9Lessons[0]!.key);
});
test('Grade 9 reserves are all eventually reachable without dropping coverage or duplicating facts', () => {
  for (const lesson of grade9Lessons) {
    const seen = new Set<string>();
    let previous = -1;
    while (previous !== seen.size) {
      previous = seen.size;
      const run = planLesson(lesson, seen);
      assert.equal(new Set(run.cards.map(lessonFactId)).size, run.cards.length);
      for (const u of lesson.units)
        assert.ok(
          u.quizCardIds.some((id) => run.cards.includes(id)),
          u.id
        );
      run.cards.forEach((id) => seen.add(id));
    }
    assert.equal(
      new Set([...seen].map(lessonFactId)).size,
      new Set(lesson.cardIds.map(lessonFactId)).size,
      lesson.key
    );
  }
});
test('Grade 9 additions are offline, trilingual, scoped correctly and do not activate unsupported grades', () => {
  const extra = read('../src/data/grade9LessonSupplement.json');
  for (const c of extra.cards) {
    for (const lang of ['english', 'tagalog', 'cebuano'])
      assert.ok(C.cardText(C.getCard(c.id), lang).length > 20);
    assert.ok(C.competencyKeys(c.id).every((code: string) => code.startsWith('G9-')));
  }
  for (const q of Object.values(extra.questions) as any[])
    for (const lang of ['en', 'tl', 'bis']) {
      assert.ok(q.q[lang] && q.e[lang]);
      assert.equal(new Set(q.o.map((o: any) => o[lang])).size, q.o.length);
      assert.ok(q.a >= 0 && q.a < q.o.length);
    }
  assert.deepEqual(lessonsForGrade(11), []);
  assert.equal(C.curriculumCursor(9, 'Q1.0').key, 'g9:f-1');
  assert.equal(C.curriculumCursor(9, 'g5:matter'), null);
  for (const correction of read('../../../docs/grade9-tag-corrections.json'))
    for (const code of correction.codes) assert.ok(C.competencyKeys(correction.id).includes(code));
  const author = read('../../../rag/pipeline/grade9-lessons.authoring.json');
  for (const lesson of grade9Lessons)
    for (const id of author.excludedCardIds) assert.ok(!lesson.cardIds.includes(id));
  for (const [key, id] of [
    ['g9:f-10', 'g9-core-transverse-em'],
    ['g9:e-8', 'g9-core-earth-scale'],
    ['g9:l-6', 'g9-core-dated-conservation'],
    ['g9:l-11', 'g9-core-survey-plan'],
  ]) {
    assert.ok(
      planLesson(grade9Lessons.find((l) => l.key === key)!, new Set()).cards.includes(id),
      id
    );
  }
});

test('Grade 9 supplemental cards and lessons follow the rotated quarter order in real feed weights', () => {
  const guide = read('../../../rag/sources/curriculum-guides/matatag-jhs-competencies.json');
  const quarters = new Map<string, number>(
    guide.quarters
      .filter((q: any) => q.grade === 9)
      .flatMap((q: any) => q.competencies.map((c: any) => [c.code, q.quarter]))
  );
  assert.deepEqual(
    ['G9-F-1', 'G9-E-1', 'G9-L-1', 'G9-M-1'].map((code) => quarters.get(code)),
    [1, 2, 3, 4]
  );
  for (const l of grade9Lessons)
    for (const code of l.codes) assert.equal(l.quarter, quarters.get(code));
  const extra = read('../src/data/grade9LessonSupplement.json');
  for (const card of extra.cards) {
    const q = quarters.get(extra.competencies[card.id][0])!;
    const ctx = {
      studentGrade: 9,
      currentQuarter: q,
      now: 123,
      cardSeen: new Map(),
      competencySeen: new Map(),
    };
    const preferred = C.weightOf(C.getCard(card.id), ctx);
    for (const other of [1, 2, 3, 4].filter((x) => x !== q))
      assert.ok(
        preferred > C.weightOf(C.getCard(card.id), { ...ctx, currentQuarter: other }),
        card.id
      );
  }
});
