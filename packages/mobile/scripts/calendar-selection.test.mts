import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadCards } from './load-cards-node.mts';

const C = await loadCards();
// Exercise the real store action without booting native model, SQLite or React Native.
// Keep navigation as the observation boundary; all topic resolution and picking is real.
const source = readFileSync(new URL('../src/store/cardStore.ts', import.meta.url), 'utf8');
const start = source.indexOf('  enterCurriculum: (key, savedRun, shelfCat) => {');
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

for (const grade of [3, 4, 5, 6, 7, 8, 9, 10]) {
  test(`Calendar subcategories stay scoped and resume correctly: Grade ${grade}`, () => {
    let checked = 0;
    for (const topic of C.curriculumOutline(grade)) {
      for (const shelf of C.topicShelves(topic, 'english')) {
        const cursor = C.curriculumCursor(grade, topic.key, new Set(), undefined, shelf.cat)!;
        assert.ok(cursor.idSet.size > 0, shelf.cat);
        assert.ok([...cursor.idSet].every(id => shelf.ids.has(id)), shelf.cat);
        const first = [...cursor.idSet][0]!;
        const seen = new Set([first]);
        if (cursor.idSet.size > 1) {
          const next = C.advanceCurriculum(cursor, first, seen)!;
          assert.equal(next.lessonRun?.shelfCat, shelf.cat);
          assert.deepEqual([...next.idSet], [...cursor.idSet]);
          const resumed = C.curriculumCursor(grade, topic.key, seen, next.lessonRun)!;
          assert.deepEqual([...resumed.idSet], [...cursor.idSet]);
        }
        if (checked === 0) {
          let state: any = { seen: new Set(), current: null };
          let landing: any;
          const enter = makeAction(
            () => state, (patch: any) => { state = { ...state, ...patch }; },
            { getState: () => ({ grade }) }, C.curriculumCursor, C.advanceCurriculum,
            C.hasServableCurriculum, { cards: new Map() }, C.jumpCard,
            (_magnet: any, c: any) => ({ studentGrade: grade, currentQuarter: topic.quarter,
              now: Date.now(), cardSeen: new Map(), competencySeen: new Map(), curriculum: { ids: c.idSet } }),
            (fact: any, _set: any, _get: any, opts: any) => { landing = { fact, opts }; }
          );
          enter(topic.key, undefined, shelf.cat);
          assert.ok(shelf.ids.has(landing.fact.id));
          assert.equal(landing.opts.curriculum.lessonRun.shelfCat, shelf.cat);
          assert.equal(landing.opts.curriculum.manualSelection, true);
          const restored = C.curriculumCursor(grade, topic.key, new Set(), landing.opts.curriculum.lessonRun)!;
          assert.equal(restored.manualSelection, true);
        }
        checked++;
      }
    }
    assert.ok(checked > 0);
  });
}

// Execute the production reinforcement selector and review exit action without native UI.
test('manual Calendar selection defers old-topic reinforcement without dropping it', async () => {
  const ts = await import('typescript');
  const from = source.indexOf('function withReinforcement(');
  const to = source.indexOf('\n/**', from);
  const js = ts.transpileModule(source.slice(from, to), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const select = new Function('getCard', 'choiceLabel', 'useCardStore', `${js};return withReinforcement`)(
    (id: string) => ({ id }), (card: any) => card.id, { getState: () => ({ magnet: null }) }
  );
  const choices = [{ factId: 'animal-next', label: 'Animal', kind: 'deep' }];
  const queue = ['mixtures-repeat', 'animal-repeat'];
  const cursor = { manualSelection: true, idSet: new Set(['animal-next', 'animal-repeat']) };
  assert.equal(select(choices, queue, 'animal-current', 'english', cursor)[0].factId, 'animal-repeat');
  assert.deepEqual(select(choices, ['mixtures-repeat'], 'animal-current', 'english', cursor), choices);
  assert.deepEqual(queue, ['mixtures-repeat', 'animal-repeat']);
  assert.equal(select(choices, queue, 'animal-current', 'english', null)[0].factId, 'mixtures-repeat');
});

test('an old quiz continuation respects the latest manual Calendar destination', () => {
  const from = source.indexOf('  continueAfterReview: (choice) => {');
  const to = source.indexOf('  recordReviewGrade:', from);
  const factory = new Function('get', 'set', 'useReviewStore', 'remediationQueueFromReview',
    'jumpCard', 'feedContext', 'advance', `return ({${source.slice(from, to)}}).continueAfterReview`);
  const state = { current: { id: 'animal-first' }, seen: new Set(['animal-first']),
    curriculum: { manualSelection: true, idSet: new Set(['animal-next']) } };
  let landed: string | undefined;
  const resume = factory(() => state, () => {}, { getState: () => ({ data: { reinforcement: [] } }) }, () => [],
    () => ({ id: 'animal-next' }), () => ({}), (choice: any) => { landed = choice.factId; });
  resume({ factId: 'mixtures-old', kind: 'deep', label: '' });
  assert.equal(landed, 'animal-next');
  resume({ factId: 'animal-next', kind: 'deep', label: '' });
  assert.equal(landed, 'animal-next');
});
