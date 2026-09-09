import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { grade4Lessons, planLesson, lessonFactId, lessonsForGrade } from '../src/data/lessonPlan';
import { loadCards } from './load-cards-node.mts';
const C = await loadCards();
const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const context = (c: any) => ({
  studentGrade: 4,
  currentQuarter: 1,
  now: 123,
  cardSeen: new Map(),
  competencySeen: new Map(),
  curriculum: { ids: c.idSet },
});
test('Grade 4 covers all 33 competencies, all categories and every core quiz slot', () => {
  const guide = read('../../../rag/sources/curriculum-guides/matatag-elementary-competencies.json');
  const expected = guide.quarters
    .filter((q: any) => q.grade === 4)
    .flatMap((q: any) => q.competencies.map((c: any) => c.code));
  assert.equal(expected.length, 33);
  assert.deepEqual(new Set(grade4Lessons.flatMap((l) => l.codes)), new Set(expected));
  assert.deepEqual(
    C.curriculumOutline(4).map((l: any) => l.key),
    grade4Lessons.map((l) => l.key)
  );
  for (const l of grade4Lessons) {
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
  const cross = read('../../../docs/grade4-subcategory-crosswalk.json').mapping;
  const inventory = read('../src/generated/cardsIndex.generated.json').cards;
  assert.deepEqual(
    new Set(cross.map((r: any) => r.subcategory_id)),
    new Set(
      inventory.flatMap((c: any) => (c.cats ?? []).filter((x: string) => x.startsWith('g4-')))
    )
  );
});
test('Grade 4 real feed walks each planned lesson, restores after every card and wraps', () => {
  let cursor = C.curriculumCursor(4, grade4Lessons[0]!.key);
  let current = null;
  const seen = new Set<string>();
  for (const lesson of grade4Lessons) {
    assert.equal(cursor.key, lesson.key);
    const order = [...cursor.lessonRun.cards];
    for (const id of order) {
      const next = C.jumpCard(current, seen, context(cursor));
      assert.equal(next.id, id);
      seen.add(id);
      current = id;
      cursor = C.advanceCurriculum(cursor, id, seen);
      cursor = C.curriculumCursor(
        4,
        cursor.key,
        seen,
        JSON.parse(JSON.stringify(cursor.lessonRun))
      );
      const choices = C.nextChoices(id, seen, 'english', { ctx: context(cursor) });
      assert.equal(choices.length, 1);
      assert.ok(cursor.idSet.has(choices[0].factId));
    }
  }
  assert.equal(cursor.key, grade4Lessons[0]!.key);
});
test('Grade 4 reserves are all eventually reachable without dropping coverage or duplicating facts', () => {
  for (const lesson of grade4Lessons) {
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
test('Grade 4 additions are offline, trilingual, scoped correctly and do not activate unsupported grades', () => {
  const extra = read('../src/data/grade4LessonSupplement.json');
  for (const c of extra.cards) {
    for (const lang of ['english', 'tagalog', 'cebuano'])
      assert.ok(C.cardText(C.getCard(c.id), lang).length > 20);
    assert.ok(C.competencyKeys(c.id).every((code: string) => code.startsWith('G4-')));
  }
  for (const q of Object.values(extra.questions) as any[])
    for (const lang of ['en', 'tl', 'bis']) {
      assert.ok(q.q[lang] && q.e[lang]);
      assert.equal(new Set(q.o.map((o: any) => o[lang])).size, q.o.length);
      assert.ok(q.a >= 0 && q.a < q.o.length);
    }
  assert.deepEqual(lessonsForGrade(11), []);
  assert.equal(C.curriculumCursor(4, 'Q1.0').key, 'g4:scientists');
  assert.equal(C.curriculumCursor(4, 'g5:matter'), null);
  for (const correction of read('../../../docs/grade4-tag-corrections.json'))
    for (const code of correction.codes) assert.ok(C.competencyKeys(correction.id).includes(code));
  const graph = grade4Lessons.find((l) => l.key === 'g4:speed-graphs')!;
  const uniform = graph.units.find((u) => u.id === 'G4-F-4:uniform')!;
  assert.ok(uniform.quizCardIds.includes('g4-core-uniform-graph'));
  const text = C.cardText(C.getCard('g4-core-uniform-graph'), 'english');
  assert.ok(text.includes('distance–time') && text.includes('(3, 6)'));
  for (const lesson of grade4Lessons)
    for (const id of ['ffct-39814', 'ffct-39424']) assert.ok(!lesson.cardIds.includes(id));
});
