import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { assessmentCopy } from '../src/assessment/uiCopy';

// Exercise the real component's callbacks and render state. The exam controller's
// separate tests cover atomic persistence, resumption, eligibility and repeat attempts.
function mountSettings() {
  const profiles = { ready: true, hasChoice: true, choosing: false, activeId: 'student-one' };
  const engine = { grade: 5, language: 'cebuano' };
  const state = { busy: false };
  const calls: unknown[] = [];
  const hooks: any[] = [];
  let cursor = 0;
  let backs = 0;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const react = {
    useRef(initial: unknown) {
      const i = cursor++;
      return hooks[i] ??= { current: initial };
    },
    useState(initial: unknown) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = initial;
      return [hooks[i], (value: unknown) => { hooks[i] = value; }];
    },
  };
  const store = Object.assign((select: (s: typeof state) => unknown) => select(state), {
    getState: () => ({ async requestStart(context: unknown) { calls.push(context); await pending; } }),
  });
  const jsx = (type: unknown, props: any) => ({ type, props });
  const mocks: Record<string, unknown> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (s: unknown) => s } },
    'expo-router': { useRouter: () => ({ back: () => { backs++; } }) },
    '../profiles': { useProfiles: () => profiles },
    '../store/engineStore': { useEngineStore: (select: (s: typeof engine) => unknown) => select(engine) },
    '../theme': { card: {}, fonts: {} },
    './registry': { assessmentRegistry: { productionEnabled: false }, ASSESSMENT_EVALUATION_ENABLED: true },
    './store': { useAssessmentStore: store },
    './uiCopy': { assessmentCopy },
  };
  const code = ts.transpileModule(readFileSync(
    new URL('../src/assessment/AssessmentSettings.tsx', import.meta.url), 'utf8'
  ), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports: any = {};
  new Function('exports', 'require', code)(exports, (id: string) => {
    assert.ok(id in mocks, `unmocked import: ${id}`);
    return mocks[id];
  });
  return {
    profiles, engine, state, calls,
    get backs() { return backs; },
    render() {
      cursor = 0;
      const tree = exports.AssessmentSettings();
      return { button: tree.props.children[0].props, note: tree.props.children[1].props.children };
    },
    async finish() { finish(); await new Promise(resolve => setImmediate(resolve)); },
  };
}

test('manual Settings entry uses the current profile, grade and language, and labels the preview', async () => {
  const h = mountSettings();
  const { button, note } = h.render();
  assert.equal(button.children.props.children, assessmentCopy('cebuano').nudge);
  assert.equal(note, assessmentCopy('cebuano').previewNote);
  assert.equal(button.accessibilityRole, 'button');
  button.onPress();
  assert.deepEqual(h.calls, [{ profileId: 'student-one', grade: 5, language: 'cebuano' }]);
  assert.equal(h.backs, 0, 'stay on Settings until the durable start completes');
  await h.finish();
  assert.equal(h.backs, 1);
});

test('rapid duplicate taps issue a single start, disable the button, then restore it', async () => {
  const h = mountSettings();
  const button = h.render().button;
  button.onPress();
  button.onPress();
  assert.equal(h.calls.length, 1);
  const pending = h.render().button;
  assert.equal(pending.disabled, true);
  assert.deepEqual(pending.accessibilityState, { disabled: true, busy: true });
  pending.onPress();
  assert.equal(h.calls.length, 1);
  await h.finish();
  assert.equal(h.render().button.disabled, false);
  assert.equal(h.backs, 1);
});

test('an unavailable or changing profile and a busy exam cannot start another attempt', () => {
  for (const condition of ['not-ready', 'no-choice', 'choosing', 'busy']) {
    const h = mountSettings();
    if (condition === 'not-ready') h.profiles.ready = false;
    if (condition === 'no-choice') h.profiles.hasChoice = false;
    if (condition === 'choosing') h.profiles.choosing = true;
    if (condition === 'busy') h.state.busy = true;
    const { button } = h.render();
    assert.equal(button.disabled, true, condition);
    button.onPress();
    assert.equal(h.calls.length, 0, condition);
    assert.equal(h.backs, 0, condition);
  }
});
