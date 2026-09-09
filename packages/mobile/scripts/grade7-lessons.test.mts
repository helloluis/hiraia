import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { grade7Lessons, planLesson, lessonFactId, lessonsForGrade } from '../src/data/lessonPlan';
import { loadCards } from './load-cards-node.mts';
const C = await loadCards();
const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const context = (c: any) => ({
  studentGrade: 7,
  currentQuarter: 1,
  now: 123,
  cardSeen: new Map(),
  competencySeen: new Map(),
  curriculum: { ids: c.idSet },
});
test('Grade 7 covers all 45 competencies, all categories and every core quiz slot', () => {
  const guide = read('../../../rag/sources/curriculum-guides/matatag-jhs-competencies.json');
  const expected = guide.quarters
    .filter((q: any) => q.grade === 7)
    .flatMap((q: any) => q.competencies.map((c: any) => c.code));
  assert.equal(expected.length, 45);
  assert.deepEqual(new Set(grade7Lessons.flatMap((l) => l.codes)), new Set(expected));
  assert.deepEqual(
    C.curriculumOutline(7).map((l: any) => l.key),
    grade7Lessons.map((l) => l.key)
  );
  for (const l of grade7Lessons) {
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
  const cross = read('../../../docs/grade7-subcategory-crosswalk.json').mapping;
  const inventory = read('../src/generated/cardsIndex.generated.json').cards;
  assert.deepEqual(
    new Set(cross.map((r: any) => r.subcategory_id)),
    new Set(
      inventory.flatMap((c: any) => (c.cats ?? []).filter((x: string) => x.startsWith('g7-')))
    )
  );
});
test('Grade 7 real feed walks each planned lesson, restores after every card and wraps', () => {
  let cursor = C.curriculumCursor(7, grade7Lessons[0]!.key);
  let current = null;
  const seen = new Set<string>();
  for (const lesson of grade7Lessons) {
    assert.equal(cursor.key, lesson.key);
    const order = [...cursor.lessonRun.cards];
    for (const id of order) {
      const next = C.jumpCard(current, seen, context(cursor));
      assert.equal(next.id, id);
      seen.add(id);
      current = id;
      cursor = C.advanceCurriculum(cursor, id, seen);
      cursor = C.curriculumCursor(
        7,
        cursor.key,
        seen,
        JSON.parse(JSON.stringify(cursor.lessonRun))
      );
      const choices = C.nextChoices(id, seen, 'english', { ctx: context(cursor) });
      assert.equal(choices.length, 1);
      assert.ok(cursor.idSet.has(choices[0].factId));
    }
  }
  assert.equal(cursor.key, grade7Lessons[0]!.key);
});
test('Grade 7 reserves are all eventually reachable without dropping coverage or duplicating facts', () => {
  for (const lesson of grade7Lessons) {
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
test('Grade 7 additions are offline, trilingual, scoped correctly and do not activate unsupported grades', () => {
  const extra = read('../src/data/grade7LessonSupplement.json');
  for (const c of extra.cards) {
    for (const lang of ['english', 'tagalog', 'cebuano'])
      assert.ok(C.cardText(C.getCard(c.id), lang).length > 20);
    assert.ok(C.competencyKeys(c.id).every((code: string) => code.startsWith('G7-')));
  }
  for (const q of Object.values(extra.questions) as any[])
    for (const lang of ['en', 'tl', 'bis']) {
      assert.ok(q.q[lang] && q.e[lang]);
      assert.equal(new Set(q.o.map((o: any) => o[lang])).size, q.o.length);
      assert.ok(q.a >= 0 && q.a < q.o.length);
    }
  assert.deepEqual(lessonsForGrade(11), []);
  assert.equal(C.curriculumCursor(7, 'Q1.0').key, 'g7:scientific-models');
  assert.equal(C.curriculumCursor(7, 'g5:matter'), null);
  for (const correction of read('../../../docs/grade7-tag-corrections.json'))
    for (const code of correction.codes) assert.ok(C.competencyKeys(correction.id).includes(code));
  const author = read('../../../rag/pipeline/grade7-lessons.authoring.json');
  for (const lesson of grade7Lessons)
    for (const id of author.excludedCardIds) assert.ok(!lesson.cardIds.includes(id));
  const unit = (key: string, id: string) =>
    grade7Lessons.find((l) => l.key === key)!.units.find((u) => u.id === id)!;
  assert.deepEqual(unit('g7:heat-electricity', 'G7-F-11:secondary-source').quizCardIds, [
    'g7-core-heat-device-source',
  ]);
  assert.deepEqual(unit('g7:cell-observation', 'G7-L-2:observation-limits').quizCardIds, [
    'g7-core-cell-observation',
  ]);
  assert.deepEqual(unit('g7:concentration', 'G7-M-9:calculation').quizCardIds, [
    'g7-core-concentration-example',
  ]);
  assert.deepEqual(unit('g7:tsunami-alerts', 'G7-E-8:natural-signs').quizCardIds, [
    'g7-core-tsunami-action',
  ]);
  for (const [key, id] of [
    ['g7:motion-graphs', 'g7-core-uniform-motion-graph'],
    ['g7:force-diagrams', 'g7-core-force-balance'],
    ['g7:particle-state-changes', 'g7-core-phase-particles'],
  ]) {
    const run = planLesson(grade7Lessons.find((l) => l.key === key)!, new Set());
    assert.ok(run.cards.includes(id), id);
  }
});
