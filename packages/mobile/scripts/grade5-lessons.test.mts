import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { grade5Lessons, planLesson } from '../src/data/lessonPlan';
import { loadCards } from './load-cards-node.mts';
const C = await loadCards();
const base = {
  studentGrade: 5,
  currentQuarter: 1,
  now: Date.now(),
  cardSeen: new Map(),
  competencySeen: new Map(),
};
const context = (cursor: any) => ({ ...base, curriculum: { ids: cursor.idSet } });
test('all forty curriculum competencies have teaching and quiz candidates in the required calendar', () => {
  const guide = JSON.parse(
    readFileSync(
      new URL(
        '../../../rag/sources/curriculum-guides/matatag-elementary-competencies.json',
        import.meta.url
      ),
      'utf8'
    )
  );
  const expected = guide.quarters
    .filter((q: any) => q.grade === 5)
    .flatMap((q: any) => q.competencies.map((c: any) => c.code));
  assert.deepEqual(new Set(grade5Lessons.flatMap((l) => l.codes)), new Set(expected));
  assert.deepEqual(
    C.curriculumOutline(5).map((r: any) => r.key),
    grade5Lessons.map((l) => l.key)
  );
  for (const lesson of grade5Lessons) {
    assert.ok([20, 30].includes(lesson.target));
    const run = planLesson(lesson, new Set());
    assert.ok(run.cards.length <= lesson.target);
    assert.equal(new Set(run.cards.map((id) => C.getCard(id).factId)).size, run.cards.length);
    for (const unit of lesson.units) {
      assert.ok(
        unit.cardIds.some((id) => run.cards.includes(id)),
        unit.id
      );
      assert.ok(
        unit.quizCardIds.some((id) => run.cards.includes(id)),
        `quiz anchor: ${unit.id}`
      );
      for (const id of unit.quizCardIds) assert.ok(C.questionForFact(id), id);
    }
  }
});
test('real feed completes each bounded run in order, resumes exactly, and keeps reserve cards', () => {
  const seen = new Set<string>();
  let cursor = C.curriculumCursor(5, grade5Lessons[0]!.key);
  let current: string | null = null;
  for (const lesson of grade5Lessons) {
    assert.equal(cursor.key, lesson.key);
    const run = [...cursor.lessonRun.cards];
    if (lesson.cardIds.length > lesson.target) assert.ok(run.length < lesson.cardIds.length);
    const viewed: string[] = [];
    for (const expected of run) {
      const next = C.jumpCard(current, seen, context(cursor));
      assert.equal(next.id, expected);
      viewed.push(next.id);
      seen.add(next.id);
      current = next.id;
      cursor = C.advanceCurriculum(cursor, current, seen);
      // Simulate process death and JSON-backed profile restoration after every card.
      cursor = C.curriculumCursor(
        5,
        cursor.key,
        seen,
        JSON.parse(JSON.stringify(cursor.lessonRun))
      );
      const choices = C.nextChoices(current, seen, 'english', { ctx: context(cursor) });
      assert.equal(choices.length, 1);
      assert.ok(cursor.idSet.has(choices[0].factId));
    }
    assert.deepEqual(viewed, run);
  }
  assert.equal(cursor.key, grade5Lessons[0]!.key);
});
test('return visits prefer reserve cards; invalid saves rebuild; profiles do not share progress', () => {
  const lesson = grade5Lessons.find((l) => l.key === 'g5:heat-and-state')!;
  const first = planLesson(lesson, new Set(), undefined, 42);
  const second = planLesson(lesson, new Set(first.cards));
  assert.ok(second.cards.filter((id) => !first.cards.includes(id)).length >= 15);
  const independent = planLesson(lesson, new Set(), undefined, 42);
  assert.deepEqual(first, independent);
  assert.deepEqual(planLesson(lesson, new Set(), { ...first, cards: ['missing'] }, 42), first);
  assert.equal(C.curriculumCursor(5, 'Q1.1')?.key, 'g5:states-of-matter');
});
test('supplemental erosion activity and all new quizzes work offline in all three languages', () => {
  const extra = JSON.parse(
    readFileSync(new URL('../src/data/grade5LessonSupplement.json', import.meta.url), 'utf8')
  );
  const card = C.getCard('g5-erosion-tray-activity');
  assert.ok(card);
  for (const lang of ['english', 'tagalog', 'cebuano'])
    assert.ok(C.cardText(card, lang).length > 40);
  assert.deepEqual(C.competencyKeys(card.id), ['G5-E-5']);
  for (const q of Object.values(extra.questions) as any[]) {
    assert.ok(q.a >= 0 && q.a < q.o.length);
    for (const lang of ['en', 'tl', 'bis']) {
      assert.ok(q.q[lang] && q.e[lang]);
      assert.equal(new Set(q.o.map((o: any) => o[lang])).size, q.o.length);
    }
  }
  for (const id of ['ffct-11575', 'ffct-14543']) {
    assert.ok(C.getCard(id));
    assert.ok(!C.competencyKeys(id).includes('G5-E-3'));
  }
});

test('broader runs keep coverage, use additional examples and exhaust every eligible fact over revisits', () => {
  for (const lesson of grade5Lessons) {
    const seen = new Set<string>();
    const unique = new Set(lesson.cardIds.map((id) => C.getCard(id).factId));
    let last = -1;
    while (seen.size !== last) {
      last = seen.size;
      const run = planLesson(lesson, seen);
      assert.ok(run.cards.length <= lesson.target);
      assert.equal(new Set(run.cards.map((id) => C.getCard(id).factId)).size, run.cards.length);
      for (const unit of lesson.units)
        assert.ok(
          unit.quizCardIds.some((id) => run.cards.includes(id)),
          unit.id
        );
      for (const id of run.cards) seen.add(id);
      assert.deepEqual(planLesson(lesson, seen, JSON.parse(JSON.stringify(run))), run);
    }
    assert.equal(
      new Set([...seen].map((id) => C.getCard(id).factId)).size,
      unique.size,
      lesson.key
    );
    const first = planLesson(lesson, new Set());
    if (lesson.relatedCardIds.length)
      assert.ok(
        first.cards.some((id) => lesson.relatedCardIds.includes(id)),
        lesson.key
      );
  }
});

test('additional pools preserve relevance, exclusions, and generic-category access', () => {
  const author = JSON.parse(
    readFileSync(
      new URL('../../../rag/pipeline/grade5-lessons.authoring.json', import.meta.url),
      'utf8'
    )
  );
  let generic = 0;
  for (const lesson of grade5Lessons)
    for (const id of lesson.relatedCardIds) {
      assert.ok(
        C.competencyKeys(id).some((code: string) => lesson.codes.includes(code)),
        id
      );
      assert.ok(!author.excludedCardIds.includes(id), id);
      assert.ok(!lesson.coreCardIds.includes(id));
      if (C.getCard(id).cats?.some((cat: string) => !cat.startsWith('g'))) generic++;
    }
  assert.ok(generic > 0);
});

test('adding related inventory preserves a valid in-progress core-only saved run', () => {
  const lesson = grade5Lessons[0]!;
  const run = planLesson(lesson, new Set());
  const saved = {
    ...run,
    revision: 'previous-smaller-inventory',
    completed: run.cards.slice(0, 3),
  };
  const restored = planLesson(lesson, new Set(run.cards), saved);
  assert.deepEqual(restored.cards, saved.cards);
  assert.deepEqual(restored.completed, saved.completed);
  assert.equal(restored.revision, lesson.revision);
});
