import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { loadCards } from './load-cards-node.mts';

// Exercise the production engine class with native/Expo boundaries stubbed, not a copy
// of its startup algorithm. CPU/native allocation itself is measured on the USB phone.
const source = readFileSync(new URL('../src/engine/LocalEngine.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source.slice(source.indexOf('export class LocalEngine')), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function harness(initial: { pressureAfterDownload?: boolean; corruptVectors?: boolean; offline?: boolean } = {}) {
  // Mutable, so a test can bring the network back (or relieve RAM) between two calls.
  const opts: { pressureAfterDownload: boolean; corruptVectors: boolean; offline: boolean;
    onDownload?: (filename: string) => Promise<void> } =
    { pressureAfterDownload: false, corruptVectors: false, offline: false, ...initial };
  const calls: string[] = [];
  // The downloader's status feed (modelDownload.subscribeAssetDownloads/assetDownloadStatus).
  const statusListeners = new Set<() => void>();
  const statuses = new Map<string, { phase: string; percent: number }>();
  const setStatus = (filename: string, phase: string, percent: number) => {
    statuses.set(filename, { phase, percent });
    for (const fn of statusListeners) fn();
  };
  const context = vm.createContext({
    exports: {}, AbortController, console: { log() {}, warn() {}, error() {} },
    ACTIVE_MODEL: { key: 'llm' }, newId: () => 'test',
    openFactSource: async () => ({ bankHash: 'bank' }),
    RagStore: class {
      size = 2;
      hasSemantic = false;
      attachSemantic() { calls.push('attach'); this.hasSemantic = true; }
      lexicallyUnreachable() { return false; }
      retrieveForGroundingHybridDiag() {
        return { hits: [{ text: 'authored fact', fact: { id: 'source-1' }, score: 0.9 }], topCos: 0.9, lexEmpty: true };
      }
    },
    requireSemanticMemory: async (before: boolean) => {
      calls.push(before ? 'semantic-check-download' : 'semantic-check-allocation');
      if (!before && opts.pressureAfterDownload) throw new Error('pressure');
    },
    requireModelMemory: async () => { calls.push('llm-check'); throw new Error('4 GB unsupported'); },
    EMBEDDER: { remote: { filename: 'labse' }, modelType: 'embedding', modelConfig: {} },
    REMOTE_ASSETS: { vectors: { filename: 'vectors' } },
    ensureRemoteAsset: async (spec: { filename: string }) => {
      calls.push(`download-${spec.filename}`);
      await opts.onDownload?.(spec.filename);
      if (opts.offline) throw new Error('offline');
      return spec.filename;
    },
    subscribeAssetDownloads: (fn: () => void) => { statusListeners.add(fn); return () => statusListeners.delete(fn); },
    assetDownloadStatus: (filename: string) => statuses.get(filename) ?? { phase: 'checking', percent: 0 },
    loadModel: async () => { calls.push('load-labse'); return 'labse-id'; },
    unloadModel: async ({ modelId }: { modelId: string }) => { calls.push(`unload-${modelId}`); },
    embed: async () => { calls.push('embed'); return { embedding: [1, 0] }; },
    normalizeQuery: (q: string) => q,
    isOffDomain: () => false,
    CONTEXT_FALLBACK_FLOOR: 0.5,
    VECTORS_META: { langs: ['en'], count: 1, dims: 2 }, IMAGE_VECTORS_META: { count: 0, dims: 0 }, IMAGE_VECTORS_BLOB_ASSET: 1,
    File: class { async bytes() { if (opts.corruptVectors) throw new Error('bad vectors'); return new Uint8Array(0); } },
    readVectorSlice: async () => { if (opts.corruptVectors) throw new Error('bad vectors'); return new Int8Array(2); },
    SemanticIndex: class {}, ImageIndex: class {},
    Asset: { fromModule: () => ({ downloadAsync: async () => {}, uri: 'images' }) },
  });
  vm.runInContext(js, context);
  const engine = new context.exports.LocalEngine();
  return { engine, calls, opts, setStatus, statusListeners };
}

test('4 GB initializes LaBSE before checking the LLM, retrieves without generation, and unloads cleanly', async () => {
  const { engine, calls } = harness();
  await engine.initialize({ language: 'english' });
  await engine.prime(5);
  assert.equal(engine.isReady(), true);
  assert.equal(engine.isSemanticReady(), true);
  assert.equal(engine.canGenerate(), false);
  assert.deepEqual(calls.slice(0, 8), ['semantic-check-download', 'download-labse', 'download-vectors',
    'semantic-check-allocation', 'load-labse', 'attach', 'embed', 'llm-check']);
  const result = await engine.searchFacts('question');
  assert.deepEqual(Array.from(result.factIds), ['source-1']);
  await engine.shutdown();
  assert.equal(engine.isReady(), false);
  assert.equal(engine.isSemanticReady(), false);
  assert.equal(engine.canGenerate(), false);
  assert.equal(calls.filter(c => c === 'unload-labse-id').length, 1);
});

test('memory pressure after downloads prevents native allocation', async () => {
  const { engine, calls } = harness({ pressureAfterDownload: true });
  await engine.initialize({ language: 'english' });
  assert.equal(engine.isReady(), true);
  assert.equal(engine.isSemanticReady(), false);
  assert.equal(calls.includes('load-labse'), false);
});

test('offline search setup leaves the authored-card fallback available', async () => {
  const { engine, calls } = harness({ offline: true });
  await engine.initialize({ language: 'english' });
  assert.equal(engine.isReady(), true);
  assert.equal(engine.canGenerate(), false);
  assert.equal(calls.includes('load-labse'), false);
  assert.equal((await engine.searchFacts('brain')).factIds.length, 0);
});

test('failed vector import releases the native embedder exactly once', async () => {
  const { engine, calls } = harness({ corruptVectors: true });
  await engine.initialize({ language: 'english' });
  await engine.shutdown();
  assert.equal(calls.filter(c => c === 'unload-labse-id').length, 1);
  assert.equal(engine.isSemanticReady(), false);
});

test('an optional generation failure preserves completed semantic retrieval', async () => {
  const { engine, calls } = harness();
  engine.initializeGenerator = async () => {
    assert.equal(engine.isSemanticReady(), true);
    calls.push('llm-failed');
    throw new Error('native generator load failure');
  };
  await engine.initialize({ language: 'english' });
  assert.equal(engine.isSemanticReady(), true);
  assert.equal(engine.isReady(), true);
  assert.equal(engine.canGenerate(), false);
  assert.ok(calls.indexOf('llm-failed') > calls.indexOf('attach'));
});

test('semantic source IDs resolve to real feed cards in rank order, retaining text-only cards', async () => {
  const cards = await loadCards();
  const index = JSON.parse(readFileSync(new URL('../src/generated/cardsIndex.generated.json', import.meta.url), 'utf8'));
  const plain = index.cards.find((c: any) => c.factId && !c.slug);
  const other = index.cards.find((c: any) => c.factId && c.factId !== plain.factId);
  const result = cards.cardsForFacts([plain.factId, other.factId, 'nonexistent']);
  assert.equal(result[0].factId, plain.factId);
  assert.ok(result.some((c: any) => c.id === plain.id));
  assert.ok(result.some((c: any) => c.factId === other.factId));
  assert.ok(result.every((c: any) => cards.getCard(c.id) === c));
  assert.deepEqual(cards.cardsForFacts(['nonexistent']), []);
});

test('cancellation prevents subsequent model work and releases any completed allocation', async () => {
  const { engine, calls } = harness();
  engine.cancelInitialization();
  await assert.rejects(engine.initialize({ language: 'english' }), /cancelled/);
  assert.equal(calls.includes('download-labse'), false);
  assert.equal(calls.includes('llm-check'), false);
  await engine.shutdown();
});

test('offline at launch: retrySemantic later attaches LaBSE without touching the generator', async () => {
  const { engine, calls, opts } = harness({ offline: true });
  const events: string[] = [];
  await engine.initialize({ language: 'english' }, undefined, (ev: { stage: string }) => events.push(ev.stage));
  assert.equal(engine.isReady(), true);
  assert.equal(engine.isSemanticReady(), false);
  const llmChecks = calls.filter(c => c === 'llm-check').length;
  const before = calls.length;
  const eventsBefore = events.length;
  opts.offline = false; // Wi-Fi is back.
  // Concurrent callers share ONE attempt: one download per file, one LaBSE load.
  const results = await Promise.all([engine.retrySemantic(), engine.retrySemantic(), engine.retrySemantic()]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(engine.isSemanticReady(), true);
  const retry = calls.slice(before);
  assert.deepEqual(retry.slice(0, 6), ['semantic-check-download', 'download-labse', 'download-vectors',
    'semantic-check-allocation', 'load-labse', 'attach']);
  assert.equal(retry.filter(c => c === 'load-labse').length, 1);
  assert.equal(calls.filter(c => c === 'llm-check').length, llmChecks, 'the generator is not reloaded');
  assert.equal(events.length, eventsBefore, 'a retry never drives the (finished) readiness bar');
  // Ready now: further calls are free.
  const settled = calls.length;
  assert.equal(await engine.retrySemantic(), true);
  assert.equal(calls.length, settled);
  assert.deepEqual(Array.from((await engine.searchFacts('question')).factIds), ['source-1']);
  await engine.shutdown();
  assert.equal(calls.filter(c => c === 'unload-labse-id').length, 1);
});

test('retrySemantic under RAM pressure stays keyword-only and can succeed on a later call', async () => {
  const { engine, calls, opts } = harness({ pressureAfterDownload: true });
  await engine.initialize({ language: 'english' });
  assert.equal(await engine.retrySemantic(), false);
  assert.equal(calls.includes('load-labse'), false, 'no allocation while RAM is short');
  opts.pressureAfterDownload = false;
  assert.equal(await engine.retrySemantic(), true);
  assert.equal(calls.filter(c => c === 'load-labse').length, 1);
});

test('retrySemantic before initialization or after shutdown does no work', async () => {
  const fresh = harness();
  assert.equal(await fresh.engine.retrySemantic(), false);
  assert.deepEqual(fresh.calls, []);
  const { engine, calls } = harness({ offline: true });
  await engine.initialize({ language: 'english' });
  await engine.shutdown();
  const before = calls.length;
  assert.equal(await engine.retrySemantic(), false);
  assert.equal(calls.length, before);
});

test('a LaBSE transfer joined from the prefetcher still moves the readiness bar', async () => {
  const h = harness();
  // The prefetcher owns the transfer, so this engine's ensureRemoteAsset only JOINS it — and
  // the downloader gives a joiner no byte progress. The status feed is the only signal.
  h.opts.onDownload = async (filename: string) => {
    if (filename !== 'labse') return;
    h.setStatus('labse', 'downloading', 40);
    h.setStatus('labse', 'downloading', 40); // an unrelated file's change re-notifies: dropped
    h.setStatus('vectors', 'downloading', 10); // another file's progress is not LaBSE's
  };
  const seen: number[] = [];
  await h.engine.initialize({ language: 'english' }, undefined, (ev: { stage: string; pct?: number }) => {
    if (ev.stage === 'semantic') seen.push(ev.pct!);
  });
  assert.deepEqual(seen.filter(p => p === Math.round(40 * 0.69)), [Math.round(40 * 0.69)]);
  assert.equal(h.statusListeners.size, 0, 'the status subscription is released after each file');
  assert.equal(h.engine.isSemanticReady(), true);
});

test('cancelling an engine that only JOINED a transfer stops its wait at once', async () => {
  const h = harness();
  // The prefetcher's transfer (no signal of its own), e.g. held by the "AI downloads" pause:
  // the downloader never settles a joiner early, whatever the joiner's signal says.
  h.opts.onDownload = () => new Promise<void>(() => {});
  const init = h.engine.initialize({ language: 'english' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(h.calls, ['semantic-check-download', 'download-labse']);
  h.engine.cancelInitialization(); // a language switch
  const outcome = await Promise.race([
    init.then(() => 'initialized', (e: Error) => e.message),
    new Promise(resolve => setTimeout(() => resolve('still waiting on the transfer'), 200)),
  ]);
  assert.match(String(outcome), /cancelled/);
  assert.equal(h.calls.includes('load-labse'), false);
  assert.equal(h.statusListeners.size, 0, 'the status subscription is released');
});

test('a failure after LaBSE was allocated is not re-run by every retry on the same engine', async () => {
  const { engine, calls, opts } = harness({ corruptVectors: true });
  await engine.initialize({ language: 'english' });
  assert.equal(engine.isSemanticReady(), false);
  assert.equal(calls.filter(c => c === 'load-labse').length, 1);
  opts.corruptVectors = false; // even if it would work now: the next ENGINE tries again
  assert.equal(await engine.retrySemantic(), false);
  assert.equal(await engine.retrySemantic(), false);
  assert.equal(calls.filter(c => c === 'load-labse').length, 1, 'no load/unload churn per prefetch trigger');
  const fresh = harness();
  await fresh.engine.initialize({ language: 'english' });
  assert.equal(fresh.engine.isSemanticReady(), true);
});
