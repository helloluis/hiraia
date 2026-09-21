import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { auditedGrades, lessonsForGrade, lessonFactId, planLesson } from '../src/data/lessonPlan';
import graph from '../src/generated/lessonSimilarity.generated.json';

const lessons = auditedGrades.flatMap(lessonsForGrade);

test('all grades retain objective quizzes, eligibility, bounds and distinct facts across seeds', () => {
  const start = performance.now();
  for (const lesson of lessons) {
    for (let seed = 0; seed < 8; seed++) {
      const seen = new Set(lesson.cardIds.filter((_, i) => i % 3 === 0));
      const before = [...seen];
      const run = planLesson(lesson, seen, undefined, seed);
      assert.ok(run.cards.length > 0 && run.cards.length <= lesson.target, lesson.key);
      assert.equal(new Set(run.cards.map(lessonFactId)).size, run.cards.length, lesson.key);
      assert.ok(run.cards.every(id => lesson.cardIds.includes(id)), lesson.key);
      for (const unit of lesson.units) {
        const anchors = unit.quizCardIds.length ? unit.quizCardIds : unit.cardIds;
        assert.ok(anchors.some(id => run.cards.includes(id)), `${lesson.key}: ${unit.id}`);
      }
      assert.deepEqual([...seen], before, 'planning must not mark unread cards as seen');
    }
  }
  console.log(`Planned ${lessons.length * 8} real lessons in ${(performance.now() - start).toFixed(0)} ms (Node, not phone)`);
});

test('rich lessons vary optional examples and order, including after everything has been seen', () => {
  for (const key of ['g5:heat-and-state', 'g5:matter']) {
    const lesson = lessons.find(l => l.key === key)!;
    for (const seen of [new Set<string>(), new Set(lesson.cardIds)]) {
      const runs = Array.from({ length: 12 }, (_, seed) => planLesson(lesson, seen, undefined, seed));
      assert.equal(new Set(runs.map(r => r.cards.join(','))).size, 12, key);
      assert.ok(new Set(runs.flatMap(r => r.cards)).size > lesson.target * 2, key);
      assert.deepEqual(planLesson(lesson, seen, undefined, 0), runs[0]);
    }
  }
});

test('old saves and new seeded saves resume exactly even with another seed or graph revision', () => {
  const lesson = lessons.find(l => l.key === 'g5:heat-and-state')!;
  const run = planLesson(lesson, new Set(), undefined, 23);
  for (const legacy of [true, false]) {
    const saved = { ...run, completed: run.cards.slice(0, 5), revision: 'older-inventory' };
    if (legacy) delete saved.seed;
    const restored = planLesson(lesson, new Set(run.cards), JSON.parse(JSON.stringify(saved)), 99);
    assert.deepEqual(restored, { ...saved, revision: lesson.revision });
  }
});

test('remaining unseen optional facts win even when they are semantically repetitive', () => {
  const lesson = lessons.find(l => l.key === 'g5:heat-and-state')!;
  const first = planLesson(lesson, new Set(), undefined, 1);
  const seen = new Set(lesson.cardIds);
  const reserved = lesson.relatedCardIds.slice(-3);
  const reservedFacts = new Set(reserved.map(lessonFactId));
  for (const id of seen) if (reservedFacts.has(lessonFactId(id))) seen.delete(id);
  const next = planLesson(lesson, seen, undefined, 2);
  for (const fact of reservedFacts) assert.ok(next.cards.some(id => lessonFactId(id) === fact));
  assert.notDeepEqual(first.cards, next.cards);
});

test('LaBSE diversity reduces highly similar pairs compared with the same randomized planner without hints', () => {
  const ordinals = new Map(graph.facts.map((id, i) => [id, i]));
  const pairs = new Map<string, number>();
  graph.neighbors.forEach((row, from) => {
    for (let i = 0; i < row.length; i += 2) {
      const to = row[i]!;
      pairs.set(`${Math.min(from, to)}:${Math.max(from, to)}`, row[i + 1]!);
    }
  });
  const redundant = (cards: string[]) => {
    let total = 0;
    const ids = cards.map(id => ordinals.get(lessonFactId(id)));
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      if (a !== undefined && b !== undefined && (pairs.get(`${Math.min(a, b)}:${Math.max(a, b)}`) ?? 0) >= 850) total++;
    }
    return total;
  };
  let guided = 0, baseline = 0;
  for (const lesson of lessons.filter(l => l.cardIds.length >= l.target * 2)) {
    for (let seed = 0; seed < 4; seed++) {
      guided += redundant(planLesson(lesson, new Set(), undefined, seed).cards);
      // Stale graphs safely disable hints, keeping the exact same selection algorithm/seed.
      baseline += redundant(planLesson({ ...lesson, revision: 'not-in-graph' }, new Set(), undefined, seed).cards);
    }
  }
  console.log(`Known >=0.85 cosine pairs: ${baseline} random-only -> ${guided} with LaBSE diversity`);
  assert.ok(baseline > 100, 'real content has enough high-similarity pairs for comparison');
  assert.ok(guided < baseline * 0.85, 'at least 15% fewer known similar pairs across matched runs');
});

test('similarity artifact matches all frozen content inputs and has bounded valid edges', () => {
  assert.equal(graph.version, 1);
  assert.equal(graph.facts.length, graph.neighbors.length);
  assert.equal(new Set(graph.facts).size, graph.facts.length);
  for (const [path, hash] of Object.entries(graph.sourceHashes)) {
    const file = readFileSync(new URL(`../../../${path}`, import.meta.url));
    assert.equal(createHash('sha256').update(file).digest('hex'), hash, `${path}: rebuild similarity artifact`);
  }
  for (const lesson of lessons) assert.equal((graph.lessons as Record<string, string>)[lesson.key], lesson.revision);
  for (const [from, row] of graph.neighbors.entries()) {
    assert.equal(row.length % 2, 0);
    assert.ok(row.length <= graph.maxNeighbors * 2);
    for (let i = 0; i < row.length; i += 2) {
      assert.ok(row[i]! >= 0 && row[i]! < graph.facts.length && row[i] !== from);
      assert.ok(row[i + 1]! >= 800 && row[i + 1]! <= 1000);
    }
  }
});
