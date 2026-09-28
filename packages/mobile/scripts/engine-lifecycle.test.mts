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
  const disk = { missing: false };
  let active = 0;
  let peak = 0;
  class Engine {
    ready = false; cancelled = false; unloaded = false; semantic = true;
    resolve!: () => void;
    retries = 0;
    /** Set by a test to hold a retry open (a LaBSE load in flight). */
    retryGate: Promise<boolean> | null = null;
    async retrySemantic() {
      this.retries++;
      if (this.retryGate) this.semantic = await this.retryGate;
      else this.semantic = true;
      return this.semantic;
    }
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
    isSemanticReady() { return this.ready && this.semantic; }
    canGenerate() { return false; }
  }
  const ctx = vm.createContext({ exports: {}, LocalEngine: Engine, console: { log() {}, warn() {}, error() {} },
    DEFAULT_GRADE: 5, ACTIVE_MODEL: { key: 'llm', ctxSize: 4096 }, setTelemetryPersona() {},
    setSetting: async () => {}, MemoryBlockedError: class extends Error {},
    semanticAssetsMissing: () => disk.missing,
    create: (initialize: any) => {
      let state: any;
      const set = (patch: any) => { state = { ...state, ...patch }; };
      const get = () => state;
      state = initialize(set, get);
      return { getState: get, setState: set };
    },
  });
  vm.runInContext(js, ctx);
  return { store: ctx.exports.useEngineStore, instances, peak: () => peak, disk };
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

test('retrySemantic waits for a load in progress, then reaches the engine that load produced', async () => {
  const h = harness();
  const load = h.store.getState().changeLanguage('english');
  await tick();
  h.instances[0].semantic = false; // came up keyword-only
  const retry = h.store.getState().retrySemantic();
  await tick();
  assert.equal(h.instances[0].retries, 0, 'no retry while the engine is still initializing');
  h.instances[0].resolve();
  await load;
  assert.equal(h.store.getState().semanticReady, false);
  assert.equal(await retry, true);
  assert.equal(h.instances[0].retries, 1);
  assert.equal(h.store.getState().semanticReady, true);
});

test('a language switch waits for a retry in flight: never two LaBSE loads at once', async () => {
  const h = harness();
  const load = h.store.getState().changeLanguage('english');
  await tick();
  h.instances[0].resolve();
  await load;
  let finish!: (ok: boolean) => void;
  h.instances[0].semantic = false;
  h.instances[0].retryGate = new Promise<boolean>(resolve => { finish = resolve; });
  const retry = h.store.getState().retrySemantic();
  await tick();
  const next = h.store.getState().changeLanguage('tagalog');
  await tick();
  assert.equal(h.instances.length, 1, 'the next engine is not created while the retry runs');
  finish(true);
  assert.equal(await retry, true);
  await tick();
  h.instances[1].resolve();
  await next;
  assert.equal(h.store.getState().language, 'tagalog');
  assert.equal(h.instances[0].unloaded, true);
});

test('retrySemantic with no ready engine does nothing and reports false', async () => {
  const h = harness();
  assert.equal(await h.store.getState().retrySemantic(), false);
  const load = h.store.getState().changeLanguage('english');
  await tick();
  await h.store.getState().shutdown().then(() => load);
  assert.equal(await h.store.getState().retrySemantic(), false);
  assert.equal(h.instances[0].retries, 0);
  assert.equal(h.store.getState().semanticReady, false);
});

test('retrySemantic never holds the load queue across a download', async () => {
  const h = harness();
  const load = h.store.getState().changeLanguage('english');
  await tick();
  h.instances[0].semantic = false;
  h.instances[0].resolve();
  await load;
  h.disk.missing = true; // the prefetcher has not landed the files yet
  assert.equal(await h.store.getState().retrySemantic(), false);
  assert.equal(h.instances[0].retries, 0);
  h.disk.missing = false;
  assert.equal(await h.store.getState().retrySemantic(), true);
  assert.equal(h.instances[0].retries, 1);
});

test('a retry queued behind a pick of another language leaves the outgoing engine alone', async () => {
  const h = harness();
  const load = h.store.getState().changeLanguage('english');
  await tick();
  h.instances[0].resolve();
  await load;
  let finish!: (ok: boolean) => void;
  h.instances[0].semantic = false;
  h.instances[0].retryGate = new Promise<boolean>(resolve => { finish = resolve; });
  const first = h.store.getState().retrySemantic(); // holds the queue (a LaBSE load in flight)
  const second = h.store.getState().retrySemantic(); // e.g. the search field, meanwhile
  await tick();
  const next = h.store.getState().changeLanguage('tagalog');
  finish(false);
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(h.instances[0].retries, 1, 'no LaBSE load into an engine about to be shut down');
  await tick();
  h.instances[1].resolve();
  await next;
  assert.equal(h.store.getState().language, 'tagalog');
});
