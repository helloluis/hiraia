import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { grade10Lessons, planLesson, lessonFactId, lessonsForGrade } from '../src/data/lessonPlan';
import { loadCards } from './load-cards-node.mts';
const C = await loadCards();
const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const context = (c: any) => ({
  studentGrade: 10,
  currentQuarter: 1,
  now: 123,
  cardSeen: new Map(),
  competencySeen: new Map(),
  curriculum: { ids: c.idSet },
});
test('Grade 10 covers all 45 competencies, all categories and every core quiz slot', () => {
  const guide = read('../../../rag/sources/curriculum-guides/matatag-jhs-competencies.json');
  const expected = guide.quarters
    .filter((q: any) => q.grade === 10)
    .flatMap((q: any) => q.competencies.map((c: any) => c.code));
  assert.equal(expected.length, 45);
  assert.deepEqual(new Set(grade10Lessons.flatMap((l) => l.codes)), new Set(expected));
  assert.deepEqual(
    C.curriculumOutline(10).map((l: any) => l.key),
    grade10Lessons.map((l) => l.key)
  );
  for (const l of grade10Lessons) {
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
  const cross = read('../../../docs/grade10-subcategory-crosswalk.json').mapping;
  const inventory = read('../src/generated/cardsIndex.generated.json').cards;
  assert.deepEqual(
    new Set(cross.map((r: any) => r.subcategory_id)),
    new Set(
      inventory.flatMap((c: any) => (c.cats ?? []).filter((x: string) => x.startsWith('g10-')))
    )
  );
});
test('Grade 10 real feed walks each planned lesson, restores after every card and wraps', () => {
  let cursor = C.curriculumCursor(10, grade10Lessons[0]!.key);
  let current = null;
  const seen = new Set<string>();
  for (const lesson of grade10Lessons) {
    assert.equal(cursor.key, lesson.key);
    const order = [...cursor.lessonRun.cards];
    for (const id of order) {
      const next = C.jumpCard(current, seen, context(cursor));
      assert.equal(next.id, id);
      seen.add(id);
      current = id;
      cursor = C.advanceCurriculum(cursor, id, seen);
      cursor = C.curriculumCursor(
        10,
        cursor.key,
        seen,
        JSON.parse(JSON.stringify(cursor.lessonRun))
      );
      const choices = C.nextChoices(id, seen, 'english', { ctx: context(cursor) });
      assert.equal(choices.length, 1);
      assert.ok(cursor.idSet.has(choices[0].factId));
    }
  }
  assert.equal(cursor.key, grade10Lessons[0]!.key);
});
test('Grade 10 reserves are all eventually reachable without dropping coverage or duplicating facts', () => {
  for (const lesson of grade10Lessons) {
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
test('Grade 10 additions are offline, trilingual, scoped correctly and do not activate unsupported grades', () => {
  const extra = read('../src/data/grade10LessonSupplement.json');
  for (const c of extra.cards) {
    for (const lang of ['english', 'tagalog', 'cebuano'])
      assert.ok(C.cardText(C.getCard(c.id), lang).length > 20);
    assert.ok(C.competencyKeys(c.id).every((code: string) => code.startsWith('G10-')));
  }
  for (const q of Object.values(extra.questions) as any[])
    for (const lang of ['en', 'tl', 'bis']) {
      assert.ok(q.q[lang] && q.e[lang]);
      assert.equal(new Set(q.o.map((o: any) => o[lang])).size, q.o.length);
      assert.ok(q.a >= 0 && q.a < q.o.length);
    }
  assert.deepEqual(lessonsForGrade(11), []);
  assert.equal(C.curriculumCursor(10, 'Q1.0').key, 'g10:e-1');
  assert.equal(C.curriculumCursor(10, 'g5:matter'), null);
  for (const correction of read('../../../docs/grade10-tag-corrections.json'))
    for (const code of correction.codes) assert.ok(C.competencyKeys(correction.id).includes(code));
  const author = read('../../../rag/pipeline/grade10-lessons.authoring.json');
  for (const lesson of grade10Lessons)
    for (const id of author.excludedCardIds) assert.ok(!lesson.cardIds.includes(id));
  for (const [key, id] of [
    ['g10:e-4', 'g10-core-plate-projection'],
    ['g10:e-5', 'g10-core-plate-drivers'],
    ['g10:l-8', 'g10-core-modern-biotech'],
    ['g10:l-9', 'g10-core-biotech-debate'],
  ]) {
    assert.ok(
      planLesson(grade10Lessons.find((l) => l.key === key)!, new Set()).cards.includes(id),
      id
    );
  }
});

test('Grade 10 supplemental cards and lessons follow the rotated quarter order in real feed weights', () => {
  const guide = read('../../../rag/sources/curriculum-guides/matatag-jhs-competencies.json');
  const quarters = new Map<string, number>(
    guide.quarters
      .filter((q: any) => q.grade === 10)
      .flatMap((q: any) => q.competencies.map((c: any) => [c.code, q.quarter]))
  );
  assert.deepEqual(
    ['G10-E-1', 'G10-F-1', 'G10-M-1', 'G10-L-1'].map((code) => quarters.get(code)),
    [1, 2, 3, 4]
  );
  for (const l of grade10Lessons)
    for (const code of l.codes) assert.equal(l.quarter, quarters.get(code));
  const extra = read('../src/data/grade10LessonSupplement.json');
  for (const card of extra.cards) {
    const q = quarters.get(extra.competencies[card.id][0])!;
    const ctx = {
      studentGrade: 10,
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
