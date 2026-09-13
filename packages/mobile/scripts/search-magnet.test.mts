import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { loadCards } from './load-cards-node.mts';
const C = await loadCards();
const source = readFileSync(new URL('../src/store/cardStore.ts', import.meta.url), 'utf8');
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function action(name: string, next: string, deps: Record<string, any>) {
  const a = source.indexOf(`  ${name}: `, source.indexOf("export const useCardStore")), b = source.indexOf(`\n  ${next}:`, a);
  assert.ok(a >= 0 && b > a);
  return new Function(...Object.keys(deps), compile(`const actions = {${source.slice(a, b)}}; return actions.${name};`))(...Object.values(deps));
}
function helper(name: string, deps: Record<string, any>) {
  const a = source.indexOf(`function ${name}(`), b = source.indexOf('\n}', a) + 2;
  return new Function(...Object.keys(deps), compile(`${source.slice(a, b)}; return ${name};`))(...Object.values(deps));
}
test('brain search takes priority over an active curriculum and serves five distinct topic cards', async () => {
  const curriculum = C.curriculumCursor(5, C.curriculumOutline(5)[0].key)!;
  const state: any = { current: null, seen: new Set(), curriculum, pageKey: 1, asking: false };
  const engine = { getState: () => ({ grade: 5, language: 'english' }) };
  const feedContext = helper('feedContext', { useCardStore: { getState: () => state }, useEngineStore: engine,
    inferCurriculumQuarter: () => ({ quarter: 1 }), seenStore: { cards: new Map(), competencies: new Map() } });
  const ask = action('ask', 'dismissQuery', { get: () => state, set: (patch: any) => Object.assign(state, patch),
    useEngineStore: engine, abortRewardPrefetch: () => {}, searchCards: C.searchCards, feedContext,
    formMagnet: helper('formMagnet', {}), navigateTo: (fact: any, _s: any, _g: any, opts: any) => {
      state.current = fact; state.magnet = opts.magnet;
    } });
  await ask('brain');
  assert.equal(state.magnet.query, 'brain');
  assert.equal(state.curriculum, curriculum);
  assert.equal(feedContext().curriculum, undefined);
  let current = state.current.id;
  const seen = new Set<string>([current]);
  for (let served = 1; served < 5; served++) {
    state.magnet.served = served;
    const choices = C.nextChoices(current, seen, 'english', { threadDepth: 9, recentIds: [current], ctx: feedContext() });
    assert.equal(choices.length, 1);
    assert.ok(state.magnet.idSet.has(choices[0].factId));
    assert.ok(!seen.has(choices[0].factId));
    current = choices[0].factId; seen.add(current);
  }
  assert.equal(seen.size, 5);
});
function responseHarness(answer: (...args: any[]) => Promise<any>) {
  const state: any = { asking: false, current: { id: 'previous' }, seen: new Set(), pageKey: 10,
    magnet: { query: 'unusual topic', idSet: new Set(['adjacent']), served: 0,
      dynamic: { attempts: 1, sourceFactIds: ['source-1'], texts: ['First fact.'] } },
    response: { kind: 'generated', query: 'unusual topic', text: 'First fact.', slug: null }, responseAnchorId: 'adjacent' };
  const landed: string[] = [];
  const run = action('continueAfterResponse', 'warmModel', { get: () => state,
    set: (patch: any) => Object.assign(state, patch),
    useEngineStore: { getState: () => ({ language: 'english', engine: { isReady: () => true, answerQuery: answer } }) },
    sanitizeCardAnswer: (text: string) => text?.trim() || null, getCard: (id: string) => ({ id }),
    jumpCard: () => ({ id: 'fallback' }), feedContext: () => ({}), navigateTo: (fact: any) => landed.push(fact.id) });
  return { state, landed, run };
}
test('dynamic search requests new grounding, stops at three cards, then uses adjacent inventory', async () => {
  const exclusions: string[][] = [];
  const h = responseHarness(async (_q, _l, opts) => {
    exclusions.push([...opts.excludeFactIds]);
    const n = exclusions.length + 1;
    return { grounded: true, text: `Fact number ${n}.`, sourceFactIds: [`source-${n}`] };
  });
  await h.run(); await h.run(); await h.run();
  assert.deepEqual(exclusions, [['source-1'], ['source-1', 'source-2']]);
  assert.deepEqual(h.landed, ['adjacent']);
  assert.equal(h.state.magnet.query, 'unusual topic');
  assert.equal(h.state.asking, false);
});
for (const outcome of ['repeat', 'failure', 'ungrounded']) test(`dynamic ${outcome} falls back without a repeated card`, async () => {
  const h = responseHarness(async () => {
    if (outcome === 'failure') throw new Error('unavailable');
    return { text: 'First fact.', grounded: outcome !== 'ungrounded', sourceFactIds: ['source-2'] };
  });
  await h.run();
  assert.deepEqual(h.landed, ['adjacent']);
  assert.equal(h.state.asking, false);
});
test('dismissing a search while a follow-up is generating prevents stale navigation', async () => {
  let resolve!: (value: any) => void;
  const h = responseHarness(() => new Promise(r => { resolve = r; }));
  const pending = h.run();
  h.state.magnet = null; h.state.asking = false;
  resolve({ grounded: true, text: 'Late fact', sourceFactIds: ['new'] });
  await pending;
  assert.deepEqual(h.landed, []);
  assert.equal(h.state.response.text, 'First fact.');
});
test('dismissal removes the keyword and immediately redraws choices from the paused curriculum', () => {
  const curriculum = { idSet: new Set(['curriculum-next']) };
  const state: any = { magnet: { query: 'brain' }, asking: false, current: { id: 'brain' },
    curriculum, seen: new Set(), recent: [], response: null };
  const dismiss = action('dismissQuery', 'enterCurriculum', { get: () => state,
    set: (patch: any) => Object.assign(state, patch),
    useEngineStore: { getState: () => ({ language: 'english' }) },
    feedContext: (magnet: any, cursor: any) => { assert.equal(magnet, null); assert.equal(cursor, curriculum); return {}; },
    nextChoices: () => [{ factId: 'curriculum-next' }] });
  dismiss();
  assert.equal(state.magnet, null);
  assert.equal(state.choices[0].factId, 'curriculum-next');
});

test('the local engine refuses previously used grounding even if retrieval returns it again', async () => {
  const engineSource = readFileSync(new URL('../src/engine/LocalEngine.ts', import.meta.url), 'utf8');
  const a = engineSource.indexOf('  async answerQuery(');
  const b = engineSource.indexOf('\n  }', a) + 4;
  const answer = new Function(compile(`const engine = {${engineSource.slice(a, b)}}; return engine.answerQuery;`))();
  let excluded: Set<string> | undefined;
  const result = await answer.call({ modelId: 'model', isReadyFlag: true,
    ragSearchDiag: async (_q: string, _k: number, _ctx: string, seen: Set<string>) => {
      excluded = seen;
      return { hits: [{ content: 'Old fact' }], facts: [{ id: 'used' }], semantic: false, lexEmpty: false };
    } }, 'brain', 'english', { excludeFactIds: ['used'] });
  assert.ok(excluded?.has('used'));
  assert.equal(result.grounded, false);
  assert.equal(result.text, '');
});
