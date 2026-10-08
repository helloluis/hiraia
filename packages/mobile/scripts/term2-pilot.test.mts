import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { lessonsForGrade, planLesson } from '../src/data/lessonPlan';
import { installBundledArt, hasArt } from '../src/data/artPresence';
import { supplement } from '../src/data/lessonSupplement';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const review = read('../../../rag/pipeline/term2-pilot-review.json');
const schedule = read('../../shared/src/curriculum/three-term-2026.json');
const units = review.units as Record<string, { cardIds: string[]; quizCardIds: string[] }>;
const examples = read('../../../rag/pipeline/lesson-examples-review.json').relatedCardIds;

test('pilot scope includes every official block overlapping Term 2 weeks 4–9', () => {
  const expected = Object.entries(schedule.competencies)
    .filter(
      ([, c]: any) => c.term === 2 && c.weeks[0] <= 9 && c.weeks[1] >= 4 && c.status === 'listed'
    )
    .map(([code]) => code);
  assert.equal(expected.length, 65);
  assert.deepEqual(new Set(review.codes), new Set(expected));
  for (const source of schedule.sources) {
    const bytes = readFileSync(new URL('../../../' + source.referenceFile, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
  }
});

test('scheduled pilot lessons use reviewed candidates and preserve quiz anchors across seeds', () => {
  const seenUnits = new Set<string>();
  for (let grade = 3; grade <= 10; grade++) {
    for (const lesson of lessonsForGrade(grade)) {
      if (!lesson.codes.some((code) => review.codes.includes(code))) continue;
      const approved = new Set<string>([
        ...(review.relatedCardIds[lesson.sourceKey ?? lesson.key] ?? []),
        ...(examples[lesson.sourceKey ?? lesson.key] ?? []),
      ]);
      for (const unit of lesson.units) {
        const expected = units[unit.id];
        assert.ok(expected, unit.id);
        seenUnits.add(unit.id);
        assert.deepEqual(new Set(unit.cardIds), new Set(expected.cardIds), unit.id);
        assert.deepEqual(new Set(unit.quizCardIds), new Set(expected.quizCardIds), unit.id);
        expected.cardIds.forEach((id) => approved.add(id));
      }
      assert.ok(lesson.cardIds.length >= 3, lesson.key);
      assert.ok(
        lesson.cardIds.every((id) => approved.has(id)),
        lesson.key
      );
      for (let seed = 0; seed < 20; seed++) {
        const run = planLesson(lesson, new Set(), undefined, seed);
        for (const unit of lesson.units) {
          assert.ok(
            unit.quizCardIds.some((id) => run.cards.includes(id)),
            `${lesson.key}: ${unit.id}`
          );
        }
      }
    }
  }
  assert.deepEqual(seenUnits, new Set(Object.keys(units)));
});

test('known false matches cannot return through core or reserve selections', () => {
  const graph = lessonsForGrade(4).find((l) => l.key === 'g4:speed-graphs')!;
  for (const id of ['ffct-09588', 'ffct-01381']) assert.ok(!graph.cardIds.includes(id));
  const measuring = lessonsForGrade(4).find((l) => l.key === 'g4:distance-time')!;
  for (const id of ['ffct-26505', 'ffct-33811', 'ffct-34671', 'ffct-03784'])
    assert.ok(!measuring.cardIds.includes(id));
  assert.ok(!units['G4-F-4:stationary'].cardIds.includes('dcard-04689'));
  const shape = lessonsForGrade(4).find((l) => l.key === 'g4:change-shape')!;
  for (const action of ['push', 'pull', 'stretch', 'bend', 'twist', 'squeeze'])
    assert.ok(shape.units.some((u) => u.id === `G4-F-6:${action}`));
});

test('new teaching diagram remains available with optional art absent', () => {
  installBundledArt(new Set());
  assert.equal(hasArt('pilot-distance-time'), true);
  assert.equal(hasArt('uninstalled-illustration'), false);
  const graph = supplement.cards.find((c) => c.id === 'g4-pilot-graph-compare')!;
  assert.equal(graph.slug, 'pilot-distance-time');
  const png = readFileSync(
    new URL('../assets/curriculum/pilot-distance-time.png', import.meta.url)
  );
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
});
