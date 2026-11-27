import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUE_SIZE,
  CUE_TRAVEL,
  MAX_SHOWINGS,
  besideCandidates,
  choose,
  edgeCandidates,
  intersects,
  mayShow,
  remember,
  sweep,
  visibleShare,
  type CueMemory,
  type Rect,
} from './next-cue';

const VIEW = { width: 390, height: 844 };
const button: Rect = { left: 250, top: 300, width: 90, height: 48 };
const wide: Rect = { left: 16, top: 600, width: 358, height: 48 };

function store(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

test('beside a control: each place sits clear of it and points at it', () => {
  const c = Object.fromEntries(
    besideCandidates(button, ['right', 'left', 'above', 'below']).map((x) => [x.place, x])
  );
  assert.equal(c.right!.pointing, 'left');
  assert.equal(c.left!.pointing, 'right');
  assert.equal(c.above!.pointing, 'down');
  assert.equal(c.below!.pointing, 'up');
  // Never on the control, even at the far end of its nudge towards it.
  for (const x of Object.values(c)) assert.equal(intersects(sweep(x!), button), false, x!.place);
  // Centred on the control's other axis.
  assert.equal(c.right!.top + CUE_SIZE / 2, button.top + button.height / 2);
  assert.equal(c.above!.left + CUE_SIZE / 2, button.left + button.width / 2);
});

test('on a wide button the arrow may sit on its empty ends; a small button has no room for that', () => {
  const insideWide = besideCandidates(wide, ['inside-start', 'inside-end']);
  assert.deepEqual(
    insideWide.map((x) => [x.place, x.pointing]),
    [
      ['inside-start', 'right'],
      ['inside-end', 'left'],
    ]
  );
  for (const x of insideWide) {
    assert.ok(x.left >= wide.left && x.left + x.width <= wide.left + wide.width);
    assert.ok(x.top >= wide.top && x.top + x.height <= wide.top + wide.height);
  }
  assert.deepEqual(besideCandidates(button, ['inside-start', 'inside-end']), []);
});

test('the swept box covers the whole nudge, in the direction the arrow points', () => {
  const [right] = besideCandidates(button, ['right']);
  const s = sweep(right!);
  assert.equal(s.width, CUE_SIZE + CUE_TRAVEL);
  assert.equal(s.left, right!.left - CUE_TRAVEL);
  const [above] = besideCandidates(button, ['above']);
  assert.equal(sweep(above!).height, CUE_SIZE + CUE_TRAVEL);
  assert.equal(sweep(above!).top, above!.top);
});

test('the first free place wins; a place that would leave the screen is skipped', () => {
  // A button at the right edge of a phone: nothing fits to its right.
  const atEdge: Rect = { left: 290, top: 300, width: 90, height: 48 };
  const picked = choose(besideCandidates(atEdge), VIEW, () => true);
  assert.equal(picked?.place, 'left');
  // Words to the left as well: above is taken instead.
  const words: Rect = { left: 40, top: 300, width: 240, height: 48 };
  const next = choose(besideCandidates(atEdge), VIEW, (box) => !intersects(box, words));
  assert.equal(next?.place, 'above');
});

test('nowhere free: no cue at all (the control is on screen without it)', () => {
  assert.equal(
    choose(besideCandidates(button), VIEW, () => false),
    null
  );
  assert.equal(
    choose([], VIEW, () => true),
    null
  );
});

test('a control further down the page: the arrow waits at the bottom of the screen and points down', () => {
  const below: Rect = { left: 16, top: 1400, width: 358, height: 48 };
  const c = edgeCandidates(below, VIEW);
  assert.ok(c.length >= 3);
  assert.ok(c.every((x) => x.place === 'edge' && x.pointing === 'down' && x.fixed));
  // In line with the control first.
  assert.equal(c[0]!.left + CUE_SIZE / 2, below.left + below.width / 2);
  // A phone's bottom bar covers the first row: the next row is higher up.
  const rows = [...new Set(c.map((x) => x.top))];
  assert.ok(rows.length >= 2 && rows[1]! < rows[0]!);
  const bar: Rect = { left: 0, top: VIEW.height - 64, width: VIEW.width, height: 64 };
  const picked = choose(c, VIEW, (box) => !intersects(box, bar));
  assert.ok(picked && picked.top + picked.height + CUE_TRAVEL <= bar.top);
});

test('a control further up the page: the arrow waits at the top and points up', () => {
  const above: Rect = { left: 600, top: -900, width: 120, height: 48 };
  const c = edgeCandidates(above, { width: 1366, height: 900 });
  // Within about a third of a phone's height of the top edge, never further in.
  assert.ok(c.every((x) => x.pointing === 'up' && x.top < 280));
});

test('how much of a control is on screen', () => {
  const view = { top: 65, bottom: 780 };
  assert.equal(visibleShare({ left: 0, top: 100, width: 10, height: 48 }, view), 1);
  assert.equal(visibleShare({ left: 0, top: 756, width: 10, height: 48 }, view), 0.5);
  assert.equal(visibleShare({ left: 0, top: 900, width: 10, height: 48 }, view), 0);
  assert.equal(visibleShare({ left: 0, top: 20, width: 10, height: 0 }, view), 0);
});

test('a cue is not shown twice in one visit, and stays away after a few showings on a device', () => {
  const device = store();
  let memory: CueMemory = { session: store(), device };
  assert.equal(mayShow(memory, 'generate.start'), true);
  remember(memory, 'generate.start');
  assert.equal(mayShow(memory, 'generate.start'), false, 'not again in this visit');
  assert.equal(mayShow(memory, 'editor.lock'), true, 'another cue is its own count');
  for (let visit = 2; visit <= MAX_SHOWINGS; visit++) {
    memory = { session: store(), device };
    assert.equal(mayShow(memory, 'generate.start'), true, `visit ${visit}`);
    remember(memory, 'generate.start');
  }
  memory = { session: store(), device };
  assert.equal(mayShow(memory, 'generate.start'), false, 'it has done its teaching');
});

test('storage that refuses (private mode) never breaks the page: the cue may simply show', () => {
  const refusing = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  const memory: CueMemory = { session: refusing, device: refusing };
  assert.equal(mayShow(memory, 'x'), true);
  assert.doesNotThrow(() => remember(memory, 'x'));
  assert.equal(mayShow({ session: null, device: null }, 'x'), true);
});
