import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadCards } from './load-cards-node.mts';

const C = await loadCards();
// Exercise the real store action without booting native model, SQLite or React Native.
// Keep navigation as the observation boundary; all topic resolution and picking is real.
const source = readFileSync(new URL('../src/store/cardStore.ts', import.meta.url), 'utf8');
const start = source.indexOf('  enterCurriculum: (key, savedRun) => {');
const end = source.indexOf('  exitCurriculum:', start);
assert.ok(start >= 0 && end > start, 'Calendar action is available to the harness');
const makeAction = new Function(
  'get', 'set', 'useEngineStore', 'curriculumCursor', 'advanceCurriculum',
  'hasServableCurriculum', 'seenStore', 'jumpCard', 'feedContext', 'navigateTo',
  `return ({${source.slice(start, end)}}).enterCurriculum`
);

for (const scenario of ['fresh', 'completed-persisted', 'completed-session', 'only-current-unseen']) {
  test(`Calendar tap honors every visible topic: ${scenario}`, () => {
    let checked = 0;
    for (const grade of [3, 4, 5, 6, 7, 8, 9, 10]) {
      for (const row of C.curriculumOutline(grade)) {
        const ids: Set<string> = new Set(C.cardsForTopic(row));
        const currentId = [...ids][0]!;
        const outside = C.curriculumOutline(grade).flatMap((t: any) => [...C.cardsForTopic(t)])
          .find((id: string) => !ids.has(id));
        const coverage = scenario === 'fresh' ? new Set<string>() : new Set(ids);
        if (scenario === 'only-current-unseen') coverage.delete(currentId);
        if (outside) coverage.add(outside);
        const persisted = new Map([...coverage].map(id => [id, { count: 3, lastSeen: 123 }]));
        if (scenario === 'completed-session') persisted.clear();
        const before = [...persisted];
        let state: any = {
          seen: scenario === 'completed-session' ? new Set(coverage) : new Set(),
          current: scenario === 'fresh' ? null : C.getCard(currentId),
        };
        let landing: any;
        const feedContext = (_magnet: any, cursor: any) => ({
          studentGrade: grade, currentQuarter: row.quarter, now: Date.now(),
          cardSeen: new Map(), competencySeen: new Map(), curriculum: { ids: cursor.idSet },
        });
        const enter = makeAction(
          () => state, (patch: any) => { state = { ...state, ...patch }; },
          { getState: () => ({ grade }) }, C.curriculumCursor, C.advanceCurriculum,
          C.hasServableCurriculum, { cards: persisted }, C.jumpCard, feedContext,
          (fact: any, _set: any, _get: any, opts: any) => { landing = { fact, opts }; }
        );
        enter(row.key);
        const label = `Grade ${grade} ${row.key} ${row.title.en}`;
        assert.ok(landing, label);
        assert.equal(landing.opts.curriculum.key, row.key, `${label}: tapped topic retained`);
        assert.ok(ids.has(landing.fact.id), `${label}: landing belongs to tapped topic`);
        if (scenario !== 'fresh') assert.notEqual(landing.fact.id, currentId, label);
        assert.deepEqual([...persisted], before, `${label}: persisted activity untouched`);
        if (outside) assert.ok(state.seen.has(outside), `${label}: other topics stay seen`);
        // A completed topic must permit a review run, not one card followed by a redirect.
        state.seen.add(landing.fact.id);
        const cursor = C.advanceCurriculum(landing.opts.curriculum, landing.fact.id, state.seen);
        assert.equal(cursor.key, row.key, `${label}: next page remains in topic`);
        const next = C.nextChoices(landing.fact.id, state.seen, 'english', {
          ctx: feedContext(null, cursor), recentIds: [landing.fact.id],
        });
        assert.equal(next.length, 1, label);
        assert.ok(ids.has(next[0].factId), `${label}: successor belongs to tapped topic`);
        checked++;
      }
    }
    assert.ok(checked > 100, 'covers the full visible outline, not a few sample topics');
  });
}
