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
function harness({ pressureAfterDownload = false, corruptVectors = false, offline = false } = {}) {
  const calls: string[] = [];
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
      if (!before && pressureAfterDownload) throw new Error('pressure');
    },
    requireModelMemory: async () => { calls.push('llm-check'); throw new Error('4 GB unsupported'); },
    EMBEDDER: { remote: { filename: 'labse' }, modelType: 'embedding', modelConfig: {} },
    REMOTE_ASSETS: { vectors: { filename: 'vectors' } },
    ensureRemoteAsset: async (spec: { filename: string }) => {
      calls.push(`download-${spec.filename}`);
      if (offline) throw new Error('offline');
      return spec.filename;
    },
    loadModel: async () => { calls.push('load-labse'); return 'labse-id'; },
    unloadModel: async ({ modelId }: { modelId: string }) => { calls.push(`unload-${modelId}`); },
    embed: async () => { calls.push('embed'); return { embedding: [1, 0] }; },
    normalizeQuery: (q: string) => q,
    isOffDomain: () => false,
    CONTEXT_FALLBACK_FLOOR: 0.5,
    VECTORS_META: { langs: ['en'], count: 1, dims: 2 }, IMAGE_VECTORS_META: { count: 0, dims: 0 }, IMAGE_VECTORS_BLOB_ASSET: 1,
    File: class { async bytes() { if (corruptVectors) throw new Error('bad vectors'); return new Uint8Array(0); } },
    readVectorSlice: async () => { if (corruptVectors) throw new Error('bad vectors'); return new Int8Array(2); },
    SemanticIndex: class {}, ImageIndex: class {},
    Asset: { fromModule: () => ({ downloadAsync: async () => {}, uri: 'images' }) },
  });
  vm.runInContext(js, context);
  const engine = new context.exports.LocalEngine();
  return { engine, calls };
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
