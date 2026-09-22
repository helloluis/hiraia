import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { rememberPage, scrollDestination } from '../src/components/cards/verticalFeed';

test('history is bounded and answer updates do not duplicate or reorder pages', () => {
  let pages: { key: string; selected?: number }[] = [];
  for (let i = 0; i < 40; i++) pages = rememberPage(pages, { key: String(i) });
  assert.equal(pages.length, 31);
  assert.equal(pages[0].key, '9');
  pages = rememberPage(pages, { key: '39', selected: 2 });
  assert.equal(pages.length, 31);
  assert.equal(pages.at(-1)?.selected, 2);
});
test('scroll offsets cannot skip a gated quiz or advance from older pages', () => {
  assert.deepEqual(scrollDestination(600, 600, 3, true), { index: 1, advance: false });
  assert.deepEqual(scrollDestination(-300, 600, 3, true), { index: 0, advance: false });
  assert.deepEqual(scrollDestination(1800, 600, 3, true), { index: 3, advance: true });
  assert.deepEqual(scrollDestination(1800, 600, 3, false), { index: 2, advance: false });
  assert.equal(scrollDestination(1800, 0, 3, true).advance, false);
});

// Run the production component's native event callbacks with deterministic hooks,
// refs and timers, without loading Android. Native touch arbitration needs device QA.
function mountPager() {
  const hooks: any[] = [];
  let cursor = 0,
    dirty = true,
    effects: (() => void)[] = [];
  const timers = new Map<number, () => void>();
  let serial = 0;
  const jumps: { offset: number; animated: boolean }[] = [];
  const nativeList = { scrollToOffset: (p: any) => jumps.push(p) };
  const react = {
    useRef: (initial: any) => {
      const i = cursor++;
      return (hooks[i] ??= { current: initial });
    },
    useState: (initial: any) => {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = initial;
      return [
        hooks[i],
        (value: any) => {
          const next = typeof value === 'function' ? value(hooks[i]) : value;
          if (!Object.is(next, hooks[i])) {
            hooks[i] = next;
            dirty = true;
          }
        },
      ];
    },
    useEffect: (effect: () => void, deps: any[]) => {
      const i = cursor++;
      if (!hooks[i] || deps.some((d, j) => !Object.is(d, hooks[i][j]))) effects.push(effect);
      hooks[i] = deps;
    },
    useLayoutEffect: (effect: () => void, deps: any[]) => react.useEffect(effect, deps),
  };
  const jsx = (type: any, props: any) => {
    if (type === 'FlatList') props.ref.current = nativeList;
    return { type, props };
  };
  const source = readFileSync(
    new URL('../src/components/cards/VerticalCardPager.tsx', import.meta.url),
    'utf8'
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const exports: any = {};
  new Function('exports', 'require', 'setTimeout', 'clearTimeout', code)(
    exports,
    (id: string) =>
      ({
        react,
        'react/jsx-runtime': { jsx, jsxs: jsx },
        'react-native': {
          FlatList: 'FlatList',
          View: 'View',
          ActivityIndicator: 'ActivityIndicator',
        },
        '../../theme': { card: { gold: '#gold' } },
        './verticalFeed': { scrollDestination },
      })[id],
    (f: () => void) => {
      timers.set(++serial, f);
      return serial;
    },
    (id: number) => timers.delete(id)
  );
  let advances = 0;
  const visibility: boolean[] = [];
  const props: any = {
    pages: [{ key: 'a' }, { key: 'b' }],
    preview: { key: 'c', text: 'Ready next card' },
    liveKey: 'b',
    canAdvance: true,
    locked: false,
    onAdvance: () => advances++,
    onVisible: (v: boolean) => visibility.push(v),
    onDragStart: () => {},
    onDragEnd: () => {},
    renderPage: () => null,
  };
  let tree: any;
  const render = () => {
    let count = 0;
    do {
      dirty = false;
      cursor = 0;
      effects = [];
      tree = exports.VerticalCardPager(props);
      effects.forEach((f) => f());
      assert.ok(++count < 20, 'component must settle');
    } while (dirty);
    return tree.props.children?.props;
  };
  render();
  tree.props.onLayout({ nativeEvent: { layout: { height: 600 } } });
  render();
  return {
    props,
    jumps,
    visibility,
    render,
    get advances() {
      return advances;
    },
    resize(height: number) {
      tree.props.onLayout({ nativeEvent: { layout: { height } } });
      render();
    },
    flush() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((f) => f());
      render();
    },
  };
}
const scroll = (y: number) => ({ nativeEvent: { contentOffset: { x: 0, y } } });

test('native scroll end and momentum end advance exactly once, with no phantom second page', () => {
  const h = mountPager();
  let list = h.render();
  list.onScrollBeginDrag();
  list.onScrollEndDrag(scroll(1200));
  list.onMomentumScrollBegin();
  list.onMomentumScrollEnd(scroll(1200));
  assert.equal(h.advances, 1);
  h.props.pages.push({ key: 'c' });
  h.props.liveKey = 'c';
  list = h.render();
  list.onMomentumScrollEnd(scroll(1800));
  h.flush();
  assert.equal(h.advances, 1);
  assert.equal(h.jumps.at(-1)?.offset, 1200);
});
test('slow scrolling browses history without new reads; resize preserves its identity', () => {
  const h = mountPager();
  const list = h.render();
  list.onScrollBeginDrag();
  list.onScrollEndDrag(scroll(0));
  h.flush();
  assert.equal(h.advances, 0);
  assert.equal(h.visibility.at(-1), false);
  h.resize(440);
  assert.equal(h.jumps.at(-1)?.offset, 0);
  assert.equal(h.visibility.at(-1), false);
  const next = h.render();
  next.onScrollBeginDrag();
  next.onMomentumScrollEnd(scroll(440));
  assert.equal(h.advances, 0);
  assert.equal(h.visibility.at(-1), true);
});
test('unanswered quizzes and modal reviews remove the next slot', () => {
  const h = mountPager();
  h.props.canAdvance = false;
  let list = h.render();
  assert.equal(list.data.length, 2);
  list.onScrollBeginDrag();
  list.onMomentumScrollEnd(scroll(1200));
  assert.equal(h.advances, 0);
  h.props.canAdvance = true;
  h.props.locked = true;
  list = h.render();
  assert.equal(list.scrollEnabled, false);
  assert.equal(list.data.length, 2);
});
test('review interception restores the current card instead of stranding a loading page', () => {
  const h = mountPager();
  const list = h.render();
  list.onScrollBeginDrag();
  list.onMomentumScrollEnd(scroll(1200));
  assert.equal(h.advances, 1);
  h.flush();
  assert.equal(h.jumps.at(-1)?.offset, 600);
});

test('two continuation taps cannot skip an unseen page', () => {
  const h = mountPager();
  let forward: () => void = () => {};
  h.props.renderPage = (_page: unknown, _live: boolean, next: () => void) => {
    forward = next;
    return null;
  };
  const list = h.render();
  list.renderItem({ item: h.props.pages[1], index: 1 });
  forward();
  forward();
  assert.equal(h.advances, 1);
});

test('rolling history eviction still lands on the newest page at the 31-page limit', () => {
  const h = mountPager();
  h.props.pages = Array.from({ length: 31 }, (_, i) => ({ key: String(i) }));
  h.props.liveKey = '30';
  h.render();
  h.props.pages = rememberPage(h.props.pages, { key: '31' });
  h.props.liveKey = '31';
  h.render();
  assert.equal(h.jumps.at(-1)?.offset, 30 * 600);
  assert.equal(h.visibility.at(-1), true);
});

test('resize during a drag cancels the old offset event rather than requesting a new page', () => {
  const h = mountPager();
  const list = h.render();
  list.onScrollBeginDrag();
  list.onScrollEndDrag(scroll(1200));
  h.resize(400);
  h.flush();
  assert.equal(h.advances, 0);
  assert.equal(h.jumps.at(-1)?.offset, 400);
});

test('the next row contains prepared content, is not interactive and becomes the live row with the same key', () => {
  const h = mountPager();
  const seen: any[] = [];
  h.props.renderPage = (page: any, live: boolean) => {
    seen.push({ page, live });
    return null;
  };
  let list = h.render();
  assert.equal(list.data.length, 3);
  const next = list.renderItem({ item: list.data[2], index: 2 });
  assert.equal(next.props.children.props.pointerEvents, 'none');
  assert.equal(next.props.children.props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(seen.at(-1).page.text, 'Ready next card');
  assert.equal(seen.at(-1).live, false);
  const beforeKey = list.keyExtractor(list.data[2]);
  h.props.pages = [...h.props.pages, h.props.preview];
  h.props.liveKey = 'c';
  h.props.preview = null;
  list = h.render();
  assert.equal(list.keyExtractor(list.data[2]), beforeKey);
  list.renderItem({ item: list.data[2], index: 2 });
  assert.equal(seen.at(-1).live, true);
  assert.equal(h.advances, 0, 'rendering ahead must not advance or mark the card read');
});

test('while prefetch is pending no blank scroll slot is exposed, but Continue remains available', () => {
  const h = mountPager();
  h.props.preview = null;
  const list = h.render();
  assert.equal(list.data.length, 2);
  list.onScrollBeginDrag();
  list.onMomentumScrollEnd(scroll(1200));
  assert.equal(h.advances, 0);
});
