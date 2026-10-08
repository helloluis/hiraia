import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  auditedGrades,
  lessonsForGrade,
  lessonFactId,
  lessonObjectives,
  planLesson,
} from '../src/data/lessonPlan';
import { loadCards } from './load-cards-node.mts';

const review = JSON.parse(
  readFileSync(
    new URL('../../../rag/pipeline/lesson-examples-review.json', import.meta.url),
    'utf8'
  )
);
const examples = review.relatedCardIds as Record<string, string[]>;
const C = await loadCards();

for (const grade of auditedGrades) {
  test(`Grade ${grade}: every reviewed example reaches its intended topic with all three languages`, () => {
    const lessons = lessonsForGrade(grade);
    const topics = C.curriculumOutline(grade);
    const reachable = new Map<string, Set<string>>();
    for (const topic of topics) {
      const lesson = lessons.find((l) => l.key === topic.key)!;
      assert.ok(lesson, topic.key);
      const ids = new Set<string>(C.cardsForTopic(topic));
      assert.deepEqual(ids, new Set(lesson.cardIds), `${topic.key}: feed drops a lesson card`);
      const key = lesson.sourceKey;
      if (!reachable.has(key)) reachable.set(key, new Set());
      for (const id of ids) reachable.get(key)!.add(id);
      for (const id of lesson.relatedCardIds)
        assert.deepEqual(
          lessonObjectives(lesson.key, id),
          [],
          `${topic.key}/${id}: false objective credit`
        );
    }
    const selected = Object.entries(examples).filter(([key]) => key.startsWith(`g${grade}:`));
    assert.ok(selected.length > 0, `missing Grade ${grade} review`);
    for (const [key, ids] of selected)
      for (const id of ids) {
        assert.ok(reachable.get(key)?.has(id), `${key}/${id}: unreachable reviewed example`);
        const card = C.getCard(id);
        assert.ok(card, id);
        for (const lang of ['english', 'tagalog', 'cebuano'])
          assert.ok(C.cardText(card, lang).trim().length > 10, `${id}/${lang}`);
      }
  });

  test(`Grade ${grade}: repeated visits eventually expose every eligible fact`, () => {
    for (const lesson of lessonsForGrade(grade)) {
      const seen = new Set<string>();
      const seenFacts = new Set<string>();
      const expected = new Set(lesson.cardIds.map(lessonFactId));
      for (let visit = 0; seenFacts.size < expected.size; visit++) {
        assert.ok(visit < expected.size, `${lesson.key}: nonterminating revisit`);
        const previous = seenFacts.size;
        const run = planLesson(lesson, seen, undefined, visit);
        assert.ok(run.cards.length <= lesson.target, lesson.key);
        assert.equal(new Set(run.cards.map(lessonFactId)).size, run.cards.length);
        for (const unit of lesson.units)
          assert.ok(
            unit.quizCardIds.some((id) => run.cards.includes(id)),
            unit.id
          );
        for (const id of run.cards) {
          assert.ok(expected.has(lessonFactId(id)), id);
          seen.add(id);
          seenFacts.add(lessonFactId(id));
        }
        assert.ok(seenFacts.size > previous, `${lesson.key}: unseen examples stranded`);
      }
      assert.deepEqual(seenFacts, expected, lesson.key);
    }
  });

  test(`Grade ${grade}: old core-only saved sessions preserve sequence and completed cards`, () => {
    for (const lesson of lessonsForGrade(grade)) {
      const oldLesson = {
        ...lesson,
        cardIds: lesson.coreCardIds,
        relatedCardIds: [],
        relatedGroups: [],
      };
      const run = planLesson(oldLesson, new Set(), undefined, 17);
      const saved = {
        ...run,
        revision: 'older-core-only-inventory',
        completed: run.cards.slice(0, 1),
      };
      const restored = C.curriculumCursor(
        grade,
        lesson.key,
        new Set(saved.completed),
        JSON.parse(JSON.stringify(saved))
      ).lessonRun;
      assert.deepEqual(restored.cards, saved.cards, lesson.key);
      assert.deepEqual(restored.completed, saved.completed, lesson.key);
      assert.equal(restored.revision, lesson.revision);
    }
  });
}

test('nonadmissions cannot enter the additional reading catalog through a different grade', () => {
  for (const hold of review.notAdmitted)
    assert.ok(
      !review.cards[hold.id],
      `${hold.id}: rejected additional copy was admitted elsewhere`
    );
});
