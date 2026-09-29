import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { feedViewport, railOffset, railDestination } from '../src/components/cards/adaptiveFeed';
import { createReadingSession } from '../src/components/cards/readingSession';

const require = createRequire(import.meta.url);
const { applyAdaptiveWindow, applyFontBootstrap } = require('../plugins/withAdaptiveWindow.js');

test('window recreation retains reading/quiz state; a child or grade change clears it', () => {
  const sessions = createReadingSession<{ key: string; order?: number[]; selected?: number }>();
  const before = sessions.open('child-a:5');
  before.pages = [{ key: 'fact' }, { key: 'quiz', order: [2, 0, 1], selected: 0 }];
  before.visibleKey = 'fact';
  before.searchDraft = 'lindol';
  before.reviewKey = 4;
  const restored = sessions.open('child-a:5');
  assert.equal(restored.visibleKey, 'fact');
  assert.equal(restored.searchDraft, 'lindol');
  assert.deepEqual(restored.pages[1], { key: 'quiz', order: [2, 0, 1], selected: 0 });
  assert.equal(restored.reviewKey, 4);
  const otherChild = sessions.open('child-b:5');
  before.pages.push({ key: 'late-old-callback' });
  assert.deepEqual(otherChild.pages, []);
  assert.equal(otherChild.searchDraft, '');
  assert.deepEqual(sessions.open('child-a:5').pages, []);
  sessions.open('child-a:5').pages.push({ key: 'grade-5' });
  assert.deepEqual(sessions.open('child-a:6').pages, []);
});

test('wide windows show 3.5 legible cards; smaller windows and enlarged text get room', () => {
  assert.equal(feedViewport(412).horizontal, false);
  assert.equal(feedViewport(1366).columns, 3.5);
  assert.equal(feedViewport(1024).columns, 2.5);
  assert.equal(feedViewport(1366, 2).columns, 1.5);
  assert.equal(feedViewport(1024, 2).columns, 1.5);
  assert.equal(feedViewport(840, 2).columns, 1);
  assert.equal(feedViewport(1366, 1, true).columns, 1);
  assert.ok(feedViewport(1366, 2).cardWidth >= 608);
});

test('desktop manifest survives prebuild with optional phone hardware and resize config', () => {
  const manifest = { manifest: { application: [{ activity: [{ $: { 'android:name': '.MainActivity',
    'android:screenOrientation': 'portrait', 'android:configChanges': 'uiMode|fontScale' },
    'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
      category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }] }] }] } };
  const first = JSON.stringify(applyAdaptiveWindow(manifest));
  assert.equal(JSON.stringify(applyAdaptiveWindow(manifest)), first, 'plugin is idempotent');
  const activity = manifest.manifest.application[0].activity[0].$ as Record<string,string>;
  assert.equal(activity['android:resizeableActivity'], 'true');
  assert.equal(activity['android:screenOrientation'], 'unspecified');
  assert.ok(activity['android:configChanges'].includes('density'));
  assert.ok(!activity['android:configChanges'].includes('fontScale'));
  const features = (manifest.manifest as any)['uses-feature'];
  for (const name of ['touchscreen', 'camera', 'bluetooth', 'location.gps']) {
    assert.equal(features.find((f: any) => f.$['android:name'] === `android.hardware.${name}`).$['android:required'], 'false');
  }
});

test('font-cache compatibility fix runs after RN flags are set and before React starts', () => {
  const source = '    loadReactNative(this)\n    ApplicationLifecycleDispatcher.onApplicationCreate(this)';
  const result = applyFontBootstrap(source);
  assert.ok(result.indexOf('loadReactNative(this)') < result.indexOf('HiraiaFontScale.install()'));
  assert.ok(result.indexOf('HiraiaFontScale.install()') < result.indexOf('ApplicationLifecycleDispatcher'));
  assert.equal(applyFontBootstrap(result), result);
  assert.throws(() => applyFontBootstrap('changed native entry point'));
});

function mount() {
  const hooks: any[] = [];
  let cursor = 0, dirty = true, effects: (() => void)[] = [];
  const timers = new Map<number, () => void>();
  let serial = 0;
  const jumps: any[] = [];
  const native = { scrollToOffset: (value: any) => jumps.push(value) };
  const react = {
    useRef(initial: any) { return hooks[cursor++] ??= { current: initial }; },
    useState(initial: any) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = initial;
      return [hooks[i], (value: any) => {
        const next = typeof value === 'function' ? value(hooks[i]) : value;
        if (!Object.is(next, hooks[i])) { hooks[i] = next; dirty = true; }
      }];
    },
    useEffect(effect: () => void, deps: any[]) {
      const i = cursor++;
      if (!hooks[i] || deps.some((d,j) => !Object.is(d, hooks[i][j]))) effects.push(effect);
      hooks[i] = deps;
    },
    useLayoutEffect(effect: () => void, deps: any[]) { react.useEffect(effect, deps); },
  };
  const jsx = (type: any, props: any) => {
    if (type === 'FlatList') props.ref.current = native;
    return { type, props };
  };
  const exports: any = {};
  const source = readFileSync(new URL('../src/components/cards/AdaptiveCardPager.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020,
  } }).outputText;
  new Function('exports','require','setTimeout','clearTimeout',code)(exports, (id: string) => ({
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { FlatList: 'FlatList', View: 'View', ScrollView: 'ScrollView', Text: 'Text',
      Pressable: 'Pressable', StyleSheet: { create: (s: any) => s } },
    './VerticalCardPager': {}, './adaptiveFeed': { feedViewport, railOffset, railDestination },
    './useScreenReader': {}, './useReduceMotion': { useReduceMotion: () => false },
    './CardFrame': { Arrow: 'Arrow' }, '../../theme': { card: {}, fonts: {} },
    '../../config/strings': { uiStrings: () => ({ cards: { previousCard: 'Previous', nextCard: 'Next' } }) },
    '../../../modules/hiraia-reader-input/src': { ReaderInput: 'ReaderInput' },
  })[id], (f: () => void) => { timers.set(++serial, f); return serial; }, (id: number) => timers.delete(id));
  let advances = 0;
  const visibility: boolean[] = [];
  const props: any = {
    pages: [{ key: 'a' }, { key: 'b' }], preview: { key: 'c' }, liveKey: 'b', canAdvance: true,
    locked: false, onAdvance: () => advances++, onVisible: (v: boolean) => visibility.push(v),
    onDragStart() {}, onDragEnd() {}, renderPage: () => null, language: 'english',
    renderHeader: (navigation: any) => jsx('Toolbar', { children: navigation }),
    viewport: feedViewport(1366), screenReader: false,
  };
  let tree: any;
  function find(type: string | ((node: any) => boolean), node = tree): any {
    if (!node || typeof node !== 'object') return null;
    if (typeof type === 'function' ? type(node) : node.type === type) return node;
    for (const child of [node.props?.children].flat()) { const found = find(type, child ?? null); if (found) return found; }
    return null;
  }
  const render = () => {
    let count = 0;
    do {
      dirty = false; cursor = 0; effects = [];
      tree = exports.HorizontalCardPager(props);
      effects.forEach(f => f());
      assert.ok(++count < 20);
    } while (dirty);
    return find('FlatList')?.props;
  };
  render();
  find((node: any) => typeof node.props?.onLayout === 'function').props.onLayout({ nativeEvent: { layout: { height: 600 } } });
  render();
  return { props, render, jumps, visibility, find,
    get advances() { return advances; },
    key(direction: number) { find('ReaderInput').props.onNavigate({ nativeEvent: { direction } }); render(); },
    flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach(f => f()); render(); },
  };
}
const scroll = (x: number) => ({ nativeEvent: { contentOffset: { x, y: 0 } } });

test('keyboard and wheel navigation consume a new page once, and history never advances learning', () => {
  const h = mount();
  h.key(-1); assert.equal(h.advances, 0); assert.equal(h.visibility.at(-1), false);
  h.key(1); assert.equal(h.advances, 0); assert.equal(h.visibility.at(-1), true);
  h.key(1); h.key(1); assert.equal(h.advances, 1);
  h.props.pages.push({ key: 'c' }); h.props.liveKey = 'c'; h.render();
  assert.equal(h.jumps.at(-1).offset, 0);
  h.key(1); h.props.pages.push({ key: 'd' }); h.props.liveKey = 'd'; h.render();
  assert.equal(h.jumps.at(-1).offset, h.props.viewport.stride);
});

test('header arrows browse history, advance once, and respect unanswered quizzes', () => {
  const h = mount();
  const button = (label: string) => h.find((node: any) => node.props?.label === label, h.find('Toolbar')).props;
  button('Previous').onPress(); h.render();
  assert.equal(button('Previous').disabled, true);
  assert.equal(h.advances, 0);
  button('Next').onPress(); h.render();
  assert.equal(h.visibility.at(-1), true);
  assert.equal(h.advances, 0);
  h.props.canAdvance = false; h.render();
  assert.equal(button('Next').disabled, true);
  button('Next').onPress(); h.render();
  assert.equal(h.advances, 0);
  h.props.canAdvance = true; h.render();
  button('Next').onPress(); button('Next').onPress(); h.render();
  assert.equal(h.advances, 1);
});

test('touch settle and momentum end cannot skip two pages', () => {
  const h = mount(); const list = h.render();
  list.onScrollBeginDrag(); list.onScrollEndDrag(scroll(800));
  list.onMomentumScrollBegin(); list.onMomentumScrollEnd(scroll(800));
  list.onMomentumScrollEnd(scroll(1600)); h.flush();
  assert.equal(h.advances, 1);
});

test('resizing during a drag cancels stale movement and retains the selected history page', () => {
  const h = mount(); h.key(-1);
  const list = h.render(); list.onScrollBeginDrag(); list.onScrollEndDrag(scroll(1000));
  h.props.viewport = feedViewport(1024, 2); h.render(); h.flush();
  assert.equal(h.advances, 0); assert.equal(h.jumps.at(-1).offset, 0);
  assert.equal(h.visibility.at(-1), false);
});

test('unanswered quizzes and overlays block keyboard, wheel and touch advancement', () => {
  const h = mount(); h.props.canAdvance = false; h.render(); h.key(1);
  assert.equal(h.advances, 0);
  h.props.canAdvance = true; h.props.locked = true;
  const list = h.render(); h.key(1);
  assert.equal(list.scrollEnabled, false); assert.equal(list.data.length, 2); assert.equal(h.advances, 0);
});

test('screen readers cannot focus speculative or hidden adjacent cards', () => {
  const h = mount(); h.props.screenReader = true; h.props.viewport = feedViewport(1366, 1, true);
  const list = h.render();
  for (const index of [0, 2]) {
    const row = list.renderItem({ item: list.data[index], index });
    assert.equal(row.props.children.props.importantForAccessibility, 'no-hide-descendants');
  }
  const current = list.renderItem({ item: list.data[1], index: 1 });
  assert.equal(current.props.children.props.importantForAccessibility, 'auto');
});

test('keyboard focus stays on the selected card and cannot enter a preview or locked card', () => {
  const h = mount(); const list = h.render();
  const blocked = (index: number) => list.renderItem({ item: list.data[index], index }).props.children.props.blockDescendantFocus;
  assert.equal(blocked(0), true);
  assert.equal(blocked(1), false);
  assert.equal(blocked(2), true);
  h.props.locked = true;
  const locked = h.render();
  assert.equal(locked.renderItem({ item: locked.data[1], index: 1 }).props.children.props.blockDescendantFocus, true);
});
