import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFlowTimeline, CLASS_END, labelFits } from './flow-timeline';

const b = (id: string, minutes: number, tintIndex: number | null = null, label = '') => ({
  id,
  label,
  minutes,
  tintIndex,
});
const close = (a: number, e: number) => assert.ok(Math.abs(a - e) < 1e-9, `${a} ≈ ${e}`);

test('under budget: widths are proportional, class end at 80 %, remaining reported', () => {
  const t = buildFlowTimeline([b('a', 20, 0), b('c', 15, 1)], 50);
  assert.equal(t.state, 'under');
  assert.equal(t.total, 35);
  assert.equal(t.remaining, 15);
  assert.equal(t.overflow, 0);
  close(t.segments[0]!.width, (20 / 50) * CLASS_END);
  close(t.segments[1]!.left, (20 / 50) * CLASS_END);
  assert.equal(
    t.segments.every((s) => s.overflowWidth === 0),
    true
  );
});

test('over budget: the overflow runs past the class-end mark but stays inside the component', () => {
  const t = buildFlowTimeline([b('a', 20), b('c', 15), b('d', 20)], 50);
  assert.equal(t.state, 'over');
  assert.equal(t.total, 55);
  assert.equal(t.overflow, 5);
  const last = t.segments[2]!;
  close(last.overflowLeft, CLASS_END);
  assert.ok(last.overflowWidth > 0);
  assert.ok(last.left + last.width <= 1 + 1e-9, 'never past the right edge');
  // A huge overflow is compressed into the reserve rather than clipped.
  const huge = buildFlowTimeline([b('a', 50), b('x', 500)], 50);
  const end = huge.segments[1]!.left + huge.segments[1]!.width;
  assert.ok(end <= 1 + 1e-9 && end > CLASS_END);
});

test('exact, empty and zero-minute blocks', () => {
  assert.equal(buildFlowTimeline([b('a', 50)], 50).state, 'exact');
  const empty = buildFlowTimeline([], 50);
  assert.equal(empty.state, 'empty');
  assert.equal(empty.remaining, 50);
  const zero = buildFlowTimeline([b('a', 0), b('c', 10)], 50);
  assert.equal(zero.segments.length, 1, 'zero-minute blocks draw nothing');
  assert.equal(buildFlowTimeline([b('n', NaN)], 50).total, 0);
  assert.equal(
    buildFlowTimeline([b('a', 10)], 0).duration,
    1,
    'a zero duration never divides by zero'
  );
});

test('labels only when they fit', () => {
  assert.equal(labelFits(7, 0.4, 320), true);
  assert.equal(labelFits(7, 0.1, 320), false);
  assert.equal(labelFits(0, 0.5, 320), false);
});
