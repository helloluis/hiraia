import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source = readFileSync(new URL('../src/store/engineStore.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('engineStore.ts', source, ts.ScriptTarget.Latest, true);
const withoutImports = parsed.statements.filter(s => !ts.isImportDeclaration(s)).map(s => s.getText(parsed)).join('\n');
const js = ts.transpileModule(withoutImports, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function harness() {
  const instances: any[] = [];
  let active = 0;
  let peak = 0;
  class Engine {
    ready = false; cancelled = false; unloaded = false;
    resolve!: () => void;
    constructor() { instances.push(this); }
    async initialize(_config: any, _progress: any, event: any) {
      active++; peak = Math.max(peak, active);
      try {
        await new Promise<void>(resolve => { this.resolve = resolve; });
        if (this.cancelled) throw new Error('cancelled');
        this.ready = true;
        event({ stage: 'retrieval-ready' });
      } finally { active--; }
    }
    cancelInitialization() { this.cancelled = true; this.resolve?.(); }
    async shutdown() { this.ready = false; this.unloaded = true; }
    async prime() {}
    isReady() { return this.ready; }
    isSemanticReady() { return this.ready; }
    canGenerate() { return false; }
  }
  const ctx = vm.createContext({ exports: {}, LocalEngine: Engine, console: { log() {}, warn() {}, error() {} },
    DEFAULT_GRADE: 5, ACTIVE_MODEL: { key: 'llm', ctxSize: 4096 }, setTelemetryPersona() {},
    setSetting: async () => {}, MemoryBlockedError: class extends Error {},
    create: (initialize: any) => {
      let state: any;
      const set = (patch: any) => { state = { ...state, ...patch }; };
      const get = () => state;
      state = initialize(set, get);
      return { getState: get, setState: set };
    },
  });
  vm.runInContext(js, ctx);
  return { store: ctx.exports.useEngineStore, instances, peak: () => peak };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('language changes cancel unfinished setup; only the last language loads, never in parallel', async () => {
  const h = harness();
  const first = h.store.getState().changeLanguage('english');
  await tick();
  const second = h.store.getState().changeLanguage('tagalog');
  const third = h.store.getState().changeLanguage('cebuano');
  await tick();
  assert.equal(h.instances[0].cancelled, true);
  assert.equal(h.instances[0].unloaded, true);
  assert.equal(h.instances.length, 2);
  h.instances[1].resolve();
  await Promise.all([first, second, third]);
  assert.equal(h.store.getState().language, 'cebuano');
  assert.equal(h.peak(), 1);
  assert.equal(h.store.getState().isReady, true);
});
test('profile shutdown cancels setup and finishes with no live engine', async () => {
  const h = harness();
  const start = h.store.getState().changeLanguage('english');
  await tick();
  const stop = h.store.getState().shutdown();
  await Promise.all([start, stop]);
  assert.equal(h.instances[0].cancelled, true);
  assert.equal(h.instances[0].unloaded, true);
  assert.equal(h.store.getState().engine, null);
  assert.equal(h.store.getState().loadingPhase, 'idle');
});
test('repeated requests for the same language share the existing initialization', async () => {
  const h = harness();
  const first = h.store.getState().changeLanguage('tagalog');
  await tick();
  const second = h.store.getState().changeLanguage('tagalog');
  h.instances[0].resolve();
  await Promise.all([first, second]);
  assert.equal(h.instances.length, 1);
  assert.equal(h.instances[0].cancelled, false);
});
