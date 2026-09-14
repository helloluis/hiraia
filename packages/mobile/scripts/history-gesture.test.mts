import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHistoryPull, historyPullCommitted, historyPreviewStyle } from '../src/components/cards/historyGesture';

test('only inward horizontal pulls starting in the leftmost 20 percent select history', () => {
  assert.equal(isHistoryPull(72, 80, 10, 360), true);
  assert.equal(isHistoryPull(73, 80, 10, 360), false);
  assert.equal(isHistoryPull(20, -80, 10, 360), false);
  assert.equal(isHistoryPull(20, 10, 80, 360), false);
  assert.equal(isHistoryPull(20, 10, -80, 360), false);
});

test('back requires crossing the screen midpoint, regardless of starting position', () => {
  assert.equal(historyPullCommitted(20, 160, 360), false);
  assert.equal(historyPullCommitted(20, 161, 360), true);
  assert.equal(historyPullCommitted(72, 109, 360), true);
  assert.equal(historyPullCommitted(0, 179, 360), false);
});

test('older card enters from the left at 70 percent transparency without overshooting', () => {
  assert.deepEqual(historyPreviewStyle(0, 360), {opacity: 0, transform: [{translateX: -360}]});
  assert.deepEqual(historyPreviewStyle(90, 360), {opacity: 0.3, transform: [{translateX: -270}]});
  assert.deepEqual(historyPreviewStyle(500, 360), {opacity: 0.3, transform: [{translateX: 0}]});
  assert.equal(historyPreviewStyle(-10, 360).opacity, 0);
});

import fs from 'node:fs';
import ts from 'typescript';

test('production swipe commit browses history without advancing the live feed and blocks active quizzes', () => {
  const source = fs.readFileSync(new URL('../src/components/cards/CardFeedScreen.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('    (dir: SwipeDir, releaseX:');
  const end = source.indexOf('    },\n    [width, chooseFrom', start);
  assert.ok(start > 0 && end > start);
  const callback = source.slice(start, end + 5);
  let offset = 0;
  let question = false;
  let reviewOpen = false;
  const shared = () => ({value: 0});
  const runtime = {
    historyRef: {current: {entries: [{}, {}, {}], offset: 0}},
    returningHistory: {current: false}, release: {current: null},
    downRef: {current: false}, sideRef: {current: 'left'}, advanceDoneTs: {current: 0},
    width: 360, historyPull: shared(), dragX: shared(), dragY: shared(),
    flyX: shared(), flyY: shared(), flyPeel: shared(), handoff: shared(),
    cancelAnimation: () => {}, withSpring: (n: number) => n, SETTLE_SPRING: {}, settle: () => {},
    setHistoryOffset: (update: (n: number) => number) => { offset = update(offset); runtime.historyRef.current.offset = offset; },
    useCardStore: {getState: () => ({question})},
    useReviewStore: {getState: () => ({open: reviewOpen})},
  };
  const js = ts.transpileModule('const commit = ' + callback + ';', {compilerOptions: {target: ts.ScriptTarget.ES2020}}).outputText;
  const commit = new Function(...Object.keys(runtime), js + '; return commit;')(...Object.values(runtime));
  commit('back', 0, 0, 20, Date.now());
  assert.equal(offset, 1);
  commit('back', 0, 0, 20, Date.now());
  assert.equal(offset, 2);
  commit('back', 0, 0, 20, Date.now());
  assert.equal(offset, 2, 'oldest entry holds');
  commit('left', 0, 0, 200, Date.now());
  assert.equal(offset, 1, 'ordinary left swipe now goes forward');
  question = true;
  commit('back', 0, 0, 20, Date.now());
  assert.equal(offset, 1, 'active question blocks history');
  question = false; reviewOpen = true;
  commit('back', 0, 0, 20, Date.now());
  assert.equal(offset, 1, 'review series blocks history');
  reviewOpen = false;
  commit('right', 0, 0, 20, Date.now());
  assert.equal(offset, 0, 'returns to unchanged live card');
});
