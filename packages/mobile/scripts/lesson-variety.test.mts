import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { auditedGrades, lessonsForGrade, lessonFactId, planLesson } from '../src/data/lessonPlan';
import graph from '../src/generated/lessonSimilarity.generated.json';
import { lessonVariety } from '../src/data/lessonVariety';

const lessons = auditedGrades.flatMap(lessonsForGrade);
// Exercise optional-pool behavior independently of editorial inventory size.
// Editorial example pools can grow without changing the planner contract.
const optionalIds = Array.from({ length: 60 }, (_, i) => `fixture-optional-${i}`);
const richFixture = {
  ...lessons[0]!,
  key: 'fixture:rich',
  sourceKey: 'fixture:rich',
  target: 20,
  cardIds: optionalIds,
  coreCardIds: optionalIds.slice(0, 3),
  relatedCardIds: optionalIds.slice(3),
  units: optionalIds.slice(0, 3).map((id, i) => ({
    id: `fixture-unit-${i}`,
    competency: 'fixture',
    focus: 'fixture',
    cardIds: [id],
    quizCardIds: [id],
  })),
  relatedGroups: [0, 1, 2].map((n) => ({
    key: `group-${n}`,
    cardIds: optionalIds.slice(3 + n * 19, 22 + n * 19),
  })),
};

test('all grades retain objective quizzes, eligibility, bounds and distinct facts across seeds', () => {
  const start = performance.now();
  for (const lesson of lessons) {
    for (let seed = 0; seed < 8; seed++) {
      const seen = new Set(lesson.cardIds.filter((_, i) => i % 3 === 0));
      const before = [...seen];
      const run = planLesson(lesson, seen, undefined, seed);
      assert.ok(run.cards.length > 0 && run.cards.length <= lesson.target, lesson.key);
      assert.equal(new Set(run.cards.map(lessonFactId)).size, run.cards.length, lesson.key);
      assert.ok(
        run.cards.every((id) => lesson.cardIds.includes(id)),
        lesson.key
      );
      for (const unit of lesson.units) {
        const anchors = unit.quizCardIds.length ? unit.quizCardIds : unit.cardIds;
        assert.ok(
          anchors.some((id) => run.cards.includes(id)),
          `${lesson.key}: ${unit.id}`
        );
      }
      assert.deepEqual([...seen], before, 'planning must not mark unread cards as seen');
    }
  }
  console.log(
    `Planned ${lessons.length * 8} real lessons in ${(performance.now() - start).toFixed(0)} ms (Node, not phone)`
  );
});

test('rich lessons vary optional examples and order, including after everything has been seen', () => {
  for (const lesson of [richFixture]) {
    const key = lesson.key;
    for (const seen of [new Set<string>(), new Set(lesson.cardIds)]) {
      const runs = Array.from({ length: 12 }, (_, seed) =>
        planLesson(lesson, seen, undefined, seed)
      );
      assert.equal(new Set(runs.map((r) => r.cards.join(','))).size, 12, key);
      assert.ok(new Set(runs.flatMap((r) => r.cards)).size > lesson.target * 2, key);
      assert.deepEqual(planLesson(lesson, seen, undefined, 0), runs[0]);
    }
  }
});

test('old saves and new seeded saves resume exactly even with another seed or graph revision', () => {
  const lesson = lessons.find((l) => l.key === 'g5:heat-and-state')!;
  const run = planLesson(lesson, new Set(), undefined, 23);
  for (const legacy of [true, false]) {
    const saved = { ...run, completed: run.cards.slice(0, 5), revision: 'older-inventory' };
    if (legacy) delete saved.seed;
    const restored = planLesson(lesson, new Set(run.cards), JSON.parse(JSON.stringify(saved)), 99);
    assert.deepEqual(restored, { ...saved, revision: lesson.revision });
  }
});

test('remaining unseen optional facts win even when they are semantically repetitive', () => {
  const lesson = richFixture;
  const first = planLesson(lesson, new Set(), undefined, 1);
  const seen = new Set(lesson.cardIds);
  const reserved = lesson.relatedCardIds.slice(-3);
  const reservedFacts = new Set(reserved.map(lessonFactId));
  for (const id of seen) if (reservedFacts.has(lessonFactId(id))) seen.delete(id);
  const next = planLesson(lesson, seen, undefined, 2);
  for (const fact of reservedFacts) assert.ok(next.cards.some((id) => lessonFactId(id) === fact));
  assert.notDeepEqual(first.cards, next.cards);
});

test('LaBSE hints demote a known similar fact; absent and stale hints do not', () => {
  const from = graph.neighbors.findIndex((row) =>
    row.some((score, i) => i % 2 === 1 && score >= 850)
  );
  assert.ok(from >= 0, 'real graph must supply a known similar pair');
  const edge = graph.neighbors[from]!;
  const scorePosition = edge.findIndex((score, i) => i % 2 === 1 && score >= 850);
  const ids = [graph.facts[from]!, graph.facts[edge[scorePosition - 1]!]!, 'fixture-no-vector'];
  const [key, revision] = Object.entries(graph.lessons)[0]!;
  const guided = lessonVariety(
    key,
    revision,
    ids,
    (id) => id,
    () => 0.5
  );
  const stale = lessonVariety(
    key,
    'stale',
    ids,
    (id) => id,
    () => 0.5
  );
  const original = guided.score(ids[1]!);
  guided.selected(ids[0]!);
  stale.selected(ids[0]!);
  assert.ok(guided.score(ids[1]!) < original - 0.2);
  assert.equal(guided.score(ids[2]!), original);
  assert.equal(stale.score(ids[1]!), original);
});

test('similarity artifact matches all frozen content inputs and has bounded valid edges', () => {
  assert.equal(graph.version, 1);
  assert.equal(graph.facts.length, graph.neighbors.length);
  assert.equal(new Set(graph.facts).size, graph.facts.length);
  for (const [path, hash] of Object.entries(graph.sourceHashes)) {
    const file = readFileSync(new URL(`../../../${path}`, import.meta.url));
    assert.equal(
      createHash('sha256').update(file).digest('hex'),
      hash,
      `${path}: rebuild similarity artifact`
    );
  }
  for (const lesson of lessons)
    assert.equal((graph.lessons as Record<string, string>)[lesson.sourceKey], lesson.revision);
  for (const [from, row] of graph.neighbors.entries()) {
    assert.equal(row.length % 2, 0);
    assert.ok(row.length <= graph.maxNeighbors * 2);
    for (let i = 0; i < row.length; i += 2) {
      assert.ok(row[i]! >= 0 && row[i]! < graph.facts.length && row[i] !== from);
      assert.ok(row[i + 1]! >= 800 && row[i + 1]! <= 1000);
    }
  }
});
