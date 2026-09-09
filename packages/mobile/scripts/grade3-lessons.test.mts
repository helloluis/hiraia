import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { grade3Lessons, planLesson, lessonFactId, lessonsForGrade } from '../src/data/lessonPlan';
import { loadCards } from './load-cards-node.mts';
const C = await loadCards();
const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const context = (c: any) => ({
  studentGrade: 3,
  currentQuarter: 1,
  now: 123,
  cardSeen: new Map(),
  competencySeen: new Map(),
  curriculum: { ids: c.idSet },
});
test('Grade 3 covers all 34 competencies, all categories and every core quiz slot', () => {
  const guide = read('../../../rag/sources/curriculum-guides/matatag-elementary-competencies.json');
  const expected = guide.quarters
    .filter((q: any) => q.grade === 3)
    .flatMap((q: any) => q.competencies.map((c: any) => c.code));
  assert.equal(expected.length, 34);
  assert.deepEqual(new Set(grade3Lessons.flatMap((l) => l.codes)), new Set(expected));
  assert.deepEqual(
    C.curriculumOutline(3).map((l: any) => l.key),
    grade3Lessons.map((l) => l.key)
  );
  for (const l of grade3Lessons) {
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
  const cross = read('../../../docs/grade3-subcategory-crosswalk.json').mapping;
  const inventory = read('../src/generated/cardsIndex.generated.json').cards;
  assert.deepEqual(
    new Set(cross.map((r: any) => r.subcategory_id)),
    new Set(
      inventory.flatMap((c: any) => (c.cats ?? []).filter((x: string) => x.startsWith('g3-')))
    )
  );
});
test('Grade 3 real feed walks each planned lesson, restores after every card and wraps', () => {
  let cursor = C.curriculumCursor(3, grade3Lessons[0]!.key);
  let current = null;
  const seen = new Set<string>();
  for (const lesson of grade3Lessons) {
    assert.equal(cursor.key, lesson.key);
    const order = [...cursor.lessonRun.cards];
    for (const id of order) {
      const next = C.jumpCard(current, seen, context(cursor));
      assert.equal(next.id, id);
      seen.add(id);
      current = id;
      cursor = C.advanceCurriculum(cursor, id, seen);
      cursor = C.curriculumCursor(
        3,
        cursor.key,
        seen,
        JSON.parse(JSON.stringify(cursor.lessonRun))
      );
      const choices = C.nextChoices(id, seen, 'english', { ctx: context(cursor) });
      assert.equal(choices.length, 1);
      assert.ok(cursor.idSet.has(choices[0].factId));
    }
  }
  assert.equal(cursor.key, grade3Lessons[0]!.key);
});
test('Grade 3 reserves are all eventually reachable without dropping coverage or duplicating facts', () => {
  for (const lesson of grade3Lessons) {
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
test('Grade 3 additions are offline, trilingual, scoped correctly and do not activate unsupported grades', () => {
  const extra = read('../src/data/grade3LessonSupplement.json');
  for (const c of extra.cards) {
    for (const lang of ['english', 'tagalog', 'cebuano'])
      assert.ok(C.cardText(C.getCard(c.id), lang).length > 20);
    assert.ok(C.competencyKeys(c.id).every((code: string) => code.startsWith('G3-')));
  }
  for (const q of Object.values(extra.questions) as any[])
    for (const lang of ['en', 'tl', 'bis']) {
      assert.ok(q.q[lang] && q.e[lang]);
      assert.equal(new Set(q.o.map((o: any) => o[lang])).size, q.o.length);
      assert.ok(q.a >= 0 && q.a < q.o.length);
    }
  assert.deepEqual(lessonsForGrade(11), []);
  assert.equal(C.curriculumCursor(3, 'Q1.0').key, 'g3:everyday-science');
  assert.equal(C.curriculumCursor(3, 'g5:matter'), null);
  for (const correction of read('../../../docs/grade3-tag-corrections.json'))
    for (const code of correction.codes) assert.ok(C.competencyKeys(correction.id).includes(code));
  const materials = grade3Lessons.find((l) => l.key === 'g3:safe-materials')!;
  assert.ok(!materials.units.find((u) => u.id === 'G3-M-7:oil')!.cardIds.includes('ffct-04596'));
});
