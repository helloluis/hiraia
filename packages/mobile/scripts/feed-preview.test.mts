import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/store/cardStore.ts', import.meta.url), 'utf8');
const start = source.indexOf('export function previewNextPage(');
const end = source.indexOf('/**\n * The last preview, keyed', start);
assert.ok(start > 0 && end > start);
const code = ts.transpileModule(source.slice(start, end).replace('export function', 'function'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
function fixture(patch: any = {}) {
  const state = {
    hydrated: true,
    current: { id: 'current' },
    pageKey: 40,
    pagesRead: 9,
    choices: [{ factId: 'next', kind: 'deep' }],
    seen: new Set(['current']),
    untilReward: 10,
    viewLog: [{ ts: Date.now() }],
    ...patch,
  };
  let review: any = null;
  const events: string[] = [];
  const dependencies = {
    useCardStore: { getState: () => state },
    useReviewStore: { getState: () => ({ data: review }) },
    reviewDue: () => !!review?.queue?.length,
    boundaryRecap: (s: any) => s.boundary ?? null,
    recentTopics: () => ['a', 'b', 'c'],
    REWARD_MIN_TOPICS: 3,
    recapTopics: () => ['a', 'b', 'c'],
    templateReward: () => ({ text: 'Well done' }),
    getCard: (id: string) => ({ id, slug: 'art' }),
    introduce: () => ({ titleCard: state.intro ?? null }),
    previewChoices: (_lang: string, choice: any) => {
      events.push(choice.factId);
      return [{ factId: 'after-next', kind: 'deep' }];
    },
  };
  const preview = new Function(...Object.keys(dependencies), code + '\nreturn previewNextPage;')(
    ...Object.values(dependencies)
  );
  return {
    state,
    events,
    preview: () => preview('english'),
    review: (value: any) => {
      review = value;
    },
  };
}
test('normal prefetch uses the already selected destination without marking it seen or advancing', () => {
  const f = fixture();
  const p = f.preview();
  assert.equal(p.fact.id, 'next');
  assert.equal(p.key, '41:fact');
  assert.equal(p.choices[0].factId, 'after-next');
  assert.deepEqual(f.events, ['next']);
  assert.equal(f.state.pageKey, 40);
  assert.equal(f.state.pagesRead, 9);
  assert.deepEqual([...f.state.seen], ['current']);
});
test('title continuation previews the existing fact, not a skipped next card', () => {
  const f = fixture({ titleCard: { key: 'lesson' } });
  assert.equal(f.preview().fact.id, 'current');
  assert.equal(f.preview().pagesRead, 9);
  assert.deepEqual(f.events, []);
});
test('a due quiz takes priority over lesson recap and reward without opening or grading it', () => {
  const f = fixture({ boundary: { key: 'recap' }, untilReward: 0 });
  const attempt = { id: 'attempt', question: { f: 'quiz' }, order: [1, 0], selected: null };
  f.review({ queue: [{ position: 0, items: [attempt] }] });
  const p = f.preview();
  assert.equal(p.question, attempt.question);
  assert.equal(p.order, attempt.order);
  assert.equal(p.selected, null);
  assert.equal(p.lessonRecap, null);
  assert.deepEqual(f.events, []);
});
test('recap precedes reward and its Continue previews the saved destination title', () => {
  const recap = { key: 'recap' };
  assert.equal(fixture({ boundary: recap, untilReward: 0 }).preview().lessonRecap, recap);
  const f = fixture({
    lessonRecap: recap,
    boundary: recap,
    pending: { factId: 'saved-dest' },
    intro: { key: 'new-topic' },
  });
  const p = f.preview();
  assert.equal(p.fact.id, 'saved-dest');
  assert.equal(p.key, '41:title');
  assert.equal(p.titleCard.key, 'new-topic');
});
test('reward prefetch reuses prepared text; quiz and reward continuations honor their pending choice', () => {
  const reward = { text: 'Prepared celebration' };
  assert.equal(fixture({ untilReward: 0, rewardPrefetch: reward }).preview().reward, reward);
  for (const extra of [{ reward }, { question: {}, questionAnswered: true }]) {
    const f = fixture({ ...extra, pending: { factId: 'pending-dest' } });
    assert.equal(f.preview().fact.id, 'pending-dest');
  }
});
test('unanswered quizzes, cold stores and generated followups do not speculate', () => {
  for (const patch of [
    { question: {}, questionAnswered: false },
    { hydrated: false },
    { asking: true },
    { response: { kind: 'generated' } },
  ]) {
    const f = fixture(patch);
    assert.equal(f.preview(), null);
    assert.deepEqual(f.events, []);
  }
});
