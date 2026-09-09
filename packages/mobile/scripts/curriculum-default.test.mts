import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCards } from './load-cards-node.mts';

const C = await loadCards();
const base = {
  studentGrade: 5,
  currentQuarter: 2,
  now: Date.now(),
  cardSeen: new Map(),
  competencySeen: new Map(),
};
test('calendar estimates stay in the selected grade and advance through quarter topics', () => {
  for (const grade of [3, 4, 5, 6, 7, 8, 9, 10]) {
    const rows = C.curriculumOutline(grade);
    if (!rows.length) continue;
    let prior = -1;
    for (const fraction of [0, 0.1, 0.25, 0.4, 0.5, 0.75, 0.99, 1]) {
      const c = C.estimatedCurriculumCursor(grade, fraction);
      assert.equal(c.grade, grade);
      assert.ok(c.idSet.size >= 3);
      assert.ok(c.index >= prior);
      prior = c.index;
    }
  }
});
test('curriculum successors stay in topic without keyword forks, then advance and review', () => {
  const rows = C.curriculumOutline(5);
  let cursor = C.curriculumCursor(5, rows[0].key);
  const seen = new Set<string>();
  let current = C.jumpCard(null, seen, { ...base, curriculum: { ids: cursor.idSet } });
  for (let i = 0; i < 40; i++) {
    seen.add(current.id);
    cursor = C.advanceCurriculum(cursor, current.id, seen);
    const next = C.nextChoices(current.id, seen, 'english', {
      threadDepth: 100,
      ctx: { ...base, curriculum: { ids: cursor.idSet } },
    });
    assert.equal(next.length, 1);
    assert.ok(cursor.idSet.has(next[0].factId));
    assert.ok(!seen.has(next[0].factId));
    current = C.getCard(next[0].factId);
  }
  const first = C.curriculumCursor(5, rows[0].key);
  const completedFirst = C.curriculumCursor(5, first.key, new Set(first.idSet), { ...first.lessonRun, completed: [...first.idSet] });
  const exhausted = C.advanceCurriculum(completedFirst, null, new Set(first.idSet));
  assert.equal(exhausted.key, rows[1].key);
  const all = new Set<string>();
  for (const row of rows) for (const id of C.curriculumCursor(5, row.key).idSet) all.add(id);
  const last = C.curriculumCursor(5, rows.at(-1).key);
  const completedLast = C.curriculumCursor(5, last.key, all, { ...last.lessonRun, completed: [...last.idSet] });
  const review = C.advanceCurriculum(completedLast, null, all);
  assert.equal(review.key, rows[0].key);
});

test('reviewed sleep-pressure card remains available but is excluded from plant reproduction', () => {
  assert.ok(C.getCard('ffct-10018'));
  assert.deepEqual(C.competencyKeys('ffct-10018'), ['off']);
  const plants = C.curriculumOutline(6).filter((t: any) => t.codes.some((code: string) => ['G6-L-2', 'G6-L-3'].includes(code)));
  assert.ok(plants.length > 0);
  for (const topic of plants) assert.ok(!C.cardsForTopic(topic).has('ffct-10018'));
});
