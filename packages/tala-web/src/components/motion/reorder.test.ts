import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DURATION,
  MIN_DURATION,
  cubicBezier,
  durationFor,
  ease,
  focusAfterMove,
  planReorder,
  type Box,
} from './reorder';

/** Four cards stacked with a 12 px gap, as the Session Flow lays its time blocks out. */
function stack(ids: string[], heights: Record<string, number>, top = 1000): Map<string, Box> {
  const out = new Map<string, Box>();
  let y = top;
  for (const id of ids) {
    out.set(id, { top: y, left: 40, width: 760, height: heights[id]! });
    y += heights[id]! + 12;
  }
  return out;
}
const H = { a: 666, b: 666, c: 666, d: 666 };

test('moving a block up: the two blocks trade places and the others stay still', () => {
  const plan = planReorder(stack(['a', 'b', 'c', 'd'], H), stack(['a', 'c', 'b', 'd'], H), {
    anchorId: 'c',
    scrollY: 2715,
    maxScrollY: 4733,
  });
  assert.deepEqual(plan.moves.map((m) => [m.id, m.dy]).sort(), [
    ['b', -678],
    ['c', 678],
  ]);
  assert.deepEqual(plan.entered, []);
});

test('the page scrolls by exactly the distance the moved block travels, so it stays where it was pressed', () => {
  const first = stack(['a', 'b', 'c', 'd'], H);
  const last = stack(['a', 'c', 'b', 'd'], H);
  const plan = planReorder(first, last, { anchorId: 'c', scrollY: 2715, maxScrollY: 4733 });
  assert.equal(plan.scrollBy, -678);
  // On screen = document position - scroll: unchanged for the anchor.
  assert.equal(first.get('c')!.top - 2715, last.get('c')!.top - (2715 + plan.scrollBy));
});

test('moving down scrolls the other way', () => {
  const plan = planReorder(stack(['a', 'b', 'c', 'd'], H), stack(['a', 'c', 'b', 'd'], H), {
    anchorId: 'b',
    scrollY: 1700,
    maxScrollY: 4733,
  });
  assert.equal(plan.scrollBy, 678);
});

test('near the top or the bottom of the page the scroll stops at the edge (the block covers the rest itself)', () => {
  const first = stack(['a', 'b'], H, 300);
  const last = stack(['b', 'a'], H, 300);
  assert.equal(
    planReorder(first, last, { anchorId: 'b', scrollY: 200, maxScrollY: 5000 }).scrollBy,
    -200
  );
  assert.equal(
    planReorder(first, last, { anchorId: 'a', scrollY: 4900, maxScrollY: 5000 }).scrollBy,
    100
  );
  assert.equal(planReorder(first, last, { anchorId: 'b', scrollY: 0, maxScrollY: 0 }).scrollBy, 0);
});

test('blocks of different heights each travel the other one’s height plus the gap', () => {
  const heights = { a: 946, b: 922, c: 898, d: 898 };
  const plan = planReorder(
    stack(['a', 'b', 'c', 'd'], heights),
    stack(['a', 'c', 'b', 'd'], heights),
    {
      anchorId: 'c',
      scrollY: 3691,
      maxScrollY: 6277,
    }
  );
  const byId = Object.fromEntries(plan.moves.map((m) => [m.id, m.dy]));
  assert.equal(byId.c, 922 + 12);
  assert.equal(byId.b, -(898 + 12));
  assert.equal(plan.scrollBy, -(922 + 12));
});

test('removing a block: the ones below close the gap; nothing scrolls without an anchor', () => {
  const first = stack(['a', 'b', 'c', 'd'], H);
  const last = stack(['a', 'c', 'd'], H);
  const plan = planReorder(first, last, { anchorId: null, scrollY: 2000, maxScrollY: 4000 });
  assert.deepEqual(
    plan.moves.map((m) => [m.id, m.dy]),
    [
      ['c', 678],
      ['d', 678],
    ]
  );
  assert.equal(plan.scrollBy, 0);
});

test('a block that was just added is reported as entered, not as moved', () => {
  const plan = planReorder(stack(['a', 'b'], H), stack(['a', 'b', 'c'], H), {
    anchorId: null,
    scrollY: 0,
    maxScrollY: 2000,
  });
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.entered, ['c']);
});

test('nothing changed: no movement, no scroll', () => {
  const same = stack(['a', 'b', 'c'], H);
  const plan = planReorder(same, stack(['a', 'b', 'c'], H), {
    anchorId: 'b',
    scrollY: 500,
    maxScrollY: 2000,
  });
  assert.deepEqual(plan.moves, []);
  assert.equal(plan.scrollBy, 0);
});

test('an anchor that is no longer there does not scroll the page', () => {
  const plan = planReorder(stack(['a', 'b'], H), stack(['a'], H), {
    anchorId: 'b',
    scrollY: 500,
    maxScrollY: 2000,
  });
  assert.equal(plan.scrollBy, 0);
});

test('duration grows with the distance and stays within quick limits', () => {
  assert.equal(durationFor(0), MIN_DURATION);
  assert.equal(durationFor(100), MIN_DURATION);
  assert.equal(durationFor(678), 370);
  assert.equal(durationFor(-678), 370);
  assert.equal(durationFor(5000), MAX_DURATION);
  assert.equal(durationFor(Number.NaN), MIN_DURATION);
  assert.ok(MAX_DURATION <= 450, 'a move never takes longer than 0.45 s');
});

test('focus after a move: the pressed arrow keeps it, the other arrow takes it at the top or the bottom', () => {
  assert.equal(focusAfterMove('up', { up: false, down: false }), 'up');
  assert.equal(focusAfterMove('up', { up: true, down: false }), 'down');
  assert.equal(focusAfterMove('down', { up: false, down: true }), 'up');
  assert.equal(focusAfterMove('down', { up: true, down: true }), null);
});

test('the easing curve starts at rest, ends at rest and never runs backwards', () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.equal(ease(-1), 0);
  assert.equal(ease(2), 1);
  let prev = 0;
  for (let i = 1; i <= 100; i++) {
    const v = ease(i / 100);
    assert.ok(v >= prev - 1e-6, `monotonic at ${i}`);
    assert.ok(v >= 0 && v <= 1 + 1e-6);
    prev = v;
  }
  // Most of the way is covered early (a quick response), the rest settles gently.
  assert.ok(ease(0.5) > 0.8);
});

test('cubicBezier matches the CSS keywords at known points', () => {
  const linear = cubicBezier(0, 0, 1, 1);
  assert.ok(Math.abs(linear(0.3) - 0.3) < 1e-3);
  const easeInOut = cubicBezier(0.42, 0, 0.58, 1);
  assert.ok(Math.abs(easeInOut(0.5) - 0.5) < 1e-3);
  const cssEase = cubicBezier(0.25, 0.1, 0.25, 1);
  assert.ok(Math.abs(cssEase(0.5) - 0.8024) < 2e-3);
});
