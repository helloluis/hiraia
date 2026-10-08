import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lessonsForGrade, planLesson } from '../src/data/lessonPlan';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const reviews = ['term2-pilot', 'full-year'].map((name) =>
  read(`../../../rag/pipeline/${name}-review.json`)
);
const units = Object.assign({}, ...reviews.map((r) => r.units)) as Record<
  string,
  { cardIds: string[]; quizCardIds: string[] }
>;
const schedule = read('../../shared/src/curriculum/three-term-2026.json').competencies;
const codes = new Set(reviews.flatMap((r) => r.codes));
const examples = read('../../../rag/pipeline/lesson-examples-review.json').relatedCardIds;

test('all listed BOW competencies retain reviewed teaching and quiz anchors across all terms', () => {
  const expectedCodes = Object.keys(schedule).filter((code) => schedule[code].status === 'listed');
  assert.deepEqual(codes, new Set(expectedCodes));
  assert.equal(codes.size, 322);
  const seen = new Set<string>();
  const coveredCodes = new Set<string>();
  for (let grade = 3; grade <= 10; grade++) {
    const terms = new Set<number>();
    for (const lesson of lessonsForGrade(grade)) {
      if (!lesson.codes.some((code) => codes.has(code))) continue;
      terms.add(lesson.term);
      lesson.codes.forEach((code) => coveredCodes.add(code));
      const approved = new Set<string>([
        ...reviews.flatMap((r) => r.relatedCardIds[lesson.sourceKey] ?? []),
        ...(examples[lesson.sourceKey ?? lesson.key] ?? []),
      ]);
      for (const unit of lesson.units) {
        const decision = units[unit.id];
        assert.ok(decision, unit.id);
        assert.deepEqual(new Set(unit.cardIds), new Set(decision.cardIds), unit.id);
        assert.deepEqual(new Set(unit.quizCardIds), new Set(decision.quizCardIds), unit.id);
        decision.cardIds.forEach((id) => approved.add(id));
        seen.add(unit.id);
      }
      assert.ok(lesson.cardIds.length >= 3, `${lesson.key}: Calendar minimum`);
      assert.ok(
        lesson.cardIds.every((id) => approved.has(id)),
        `${lesson.key}: reserve leakage`
      );
      for (let seed = 0; seed < 20; seed++) {
        const run = planLesson(
          lesson,
          new Set(lesson.cardIds.filter((_, i) => i % 2 === 0)),
          undefined,
          seed
        );
        assert.ok(
          run.cards.every((id) => approved.has(id)),
          lesson.key
        );
        for (const unit of lesson.units)
          assert.ok(
            unit.quizCardIds.some((id) => run.cards.includes(id)),
            `${lesson.key}: ${unit.id}`
          );
      }
    }
    assert.deepEqual(terms, new Set([1, 2, 3]));
  }
  assert.deepEqual(coveredCodes, codes);
  assert.deepEqual(seen, new Set(Object.keys(units)));
});

test('known incidental matches cannot re-enter reviewed lessons', () => {
  for (const [grade, code, rejected] of [
    [7, 'G7-M-4', 'ffct-34345'],
    [9, 'G9-F-12', 'ffct-26679'],
    [10, 'G10-M-1', 'ffct-13716'],
  ] as const) {
    const matching = lessonsForGrade(grade).filter((l) => l.codes.includes(code));
    assert.ok(matching.length);
    for (const lesson of matching) assert.ok(!lesson.cardIds.includes(rejected), lesson.key);
  }
  // These retained legacy objectives are not counted as official BOW coverage.
  assert.ok(!codes.has('G6-F-7') && !codes.has('G6-F-9'));
});
