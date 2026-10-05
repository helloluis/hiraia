import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { lessonsForGrade } from '../../mobile/src/data/lessonPlan.ts';
import schedule from '../../shared/src/curriculum/three-term-2026.json';
const root = new URL('../../../', import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const catalogue = json('packages/web/public/competencies/ph-revised-k12.json');
const mapping = schedule.competencies as Record<string, { term: number; order: number }>;

test('all eight original PDFs match the pinned curriculum sources', () => {
  assert.equal(schedule.sources.length, 8);
  for (const source of schedule.sources) {
    const bytes = readFileSync(new URL(source.referenceFile, root));
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
  }
});
test('public browser and app share ordered lessons, codes, and term/week assignments', () => {
  assert.equal(catalogue.counts.mappedCompetencies, 322);
  assert.equal(catalogue.counts.referenceCompetencies, 322);
  for (const grade of catalogue.grades) {
    assert.deepEqual(
      grade.terms.map((t: any) => t.term),
      [1, 2, 3]
    );
    const topics = grade.terms.flatMap((t: any) => t.topics);
    assert.deepEqual(
      topics.map((t: any) => [t.key, t.term, t.weeks, t.competencies.map((c: any) => c.code)]),
      lessonsForGrade(grade.grade).map((l) => [l.key, l.term, l.weeks, l.codes])
    );
  }
});
test('demo seeds and grade packs contain only Term 1 cards in the new sequence', () => {
  const seed = json('packages/web/src/data/demo-q1-seed.json');
  for (let grade = 3; grade <= 10; grade++) {
    const pack = json(`packages/web/src/data/demo-q1-g${grade}.json`);
    assert.equal(pack.term, 1);
    const tags = { ...seed.tags, ...pack.tags };
    const cards = [...seed.cards.filter((c: any) => tags[c.id][1] === grade), ...pack.cards];
    assert.ok(cards.length > 5);
    for (const card of cards) assert.equal(mapping[tags[card.id][0]]!.term, 1, card.id);
    const order = cards.map((c: any) => mapping[tags[c.id][0]]!.order);
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b)
    );
    if (grade === 10) assert.equal(tags[cards[0].id][0], 'G10-M-1');
  }
});
