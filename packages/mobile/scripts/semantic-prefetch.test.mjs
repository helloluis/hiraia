import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

// The semantic prefetcher (src/engine/semanticPrefetch.ts), bundled with its native/store
// boundaries stubbed, plus the DOWNLOAD gate at its real call site (src/engine/memory.ts).
// One test runs the prefetcher against the REAL downloader and pause switch.

const require = createRequire(import.meta.url);
const mobile = path.resolve(import.meta.dirname, '..');
const GiB = 1024 ** 3;
const jambo = { totalBytes: 3.666 * GiB, availableBytes: 1.7 * GiB, thresholdBytes: 0.2 * GiB,
  freeStorageBytes: 3 * GiB, lowMemory: false, lowRamDevice: false };
const LABSE = 'labse.gguf';
const VECTORS = 'vectors.bin';
const MIN = 60_000;

const config = (bytes) =>
  `const embedder = { url: 'https://assets.hiraia.org/models/${LABSE}', filename: '${LABSE}', bytes: ${bytes.labse}, md5: 'good', label: 'LaBSE' };` +
  `const vectors = { url: 'https://assets.hiraia.org/models/${VECTORS}', filename: '${VECTORS}', bytes: ${bytes.vectors}, md5: 'good', label: 'vectors' };` +
  'export const EMBEDDER = { remote: embedder }; export const REMOTE_ASSETS = { embedder, vectors };' +
  "export const ACTIVE_MODEL = { remote: { filename: 'llm.gguf', bytes: 1 } };";
const boundaries = {
  'react-native':
    'export const AppState = { get currentState() { return globalThis.__sp.appState; },' +
    ' addEventListener: (_e, fn) => { globalThis.__sp.appListeners.add(fn); return { remove: () => globalThis.__sp.appListeners.delete(fn) }; } };',
  '../net/connectivity':
    'export const subscribeInternetRestored = fn => { globalThis.__sp.netListeners.add(fn); return () => globalThis.__sp.netListeners.delete(fn); };',
  '../store/engineStore':
    'export const useEngineStore = { getState: () => globalThis.__sp.engineState,' +
    ' subscribe: fn => { globalThis.__sp.engineListeners.add(fn); return () => globalThis.__sp.engineListeners.delete(fn); } };',
  './memory':
    'export const readMemory = async () => { globalThis.__sp.attempts++; return globalThis.__sp.memory; };' +
    ' export const semanticAssetsMissing = () => globalThis.__sp.missing();',
};
const unitMocks = {
  ...boundaries,
  '../config/model': config({ labse: 300, vectors: 100 }),
  './modelDownload': 'export const ensureRemoteAsset = (...a) => globalThis.__sp.ensure(...a);',
};

let seq = 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-semantic-prefetch-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
async function load(contents, mocks) {
  const outfile = path.join(dir, `runtime-${seq++}.cjs`);
  await build({
    stdin: { contents, resolveDir: mobile, loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{
      name: 'mocks',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (a.path in mocks ? { path: a.path, namespace: 'mock' } : null));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({ contents: mocks[a.path], loader: 'js' }));
      },
    }],
  });
  return require(outfile);
}
const prefetcher = () => load("export * from './src/engine/semanticPrefetch';", unitMocks);

/** The phone, the network and the engine as the prefetcher sees them. */
function world(over = {}) {
  const w = {
    memory: jambo, appState: 'active', mode: 'ok', have: new Set(), calls: [], pending: [],
    inflight: 0, peak: 0, retries: 0, retryResult: true, attempts: 0,
    appListeners: new Set(), netListeners: new Set(), engineListeners: new Set(),
    ...over,
  };
  w.missing = () => !(w.have.has(LABSE) && w.have.has(VECTORS));
  w.ensure = (spec) => {
    w.calls.push(spec.filename);
    w.peak = Math.max(w.peak, ++w.inflight);
    const land = () => { w.inflight--; w.have.add(spec.filename); return '/models/' + spec.filename; };
    if (w.mode === 'hold')
      return new Promise((resolve, reject) => w.pending.push({
        spec, resolve: () => resolve(land()), reject: (e) => { w.inflight--; reject(e); },
      }));
    if (w.mode === 'offline') { w.inflight--; return Promise.reject(new Error('offline')); }
    if (w.mode === 'fatal') { w.inflight--; return Promise.reject(Object.assign(new Error('MD5 mismatch'), { fatal: true })); }
    return Promise.resolve(land());
  };
  w.engineState = {
    isReady: false, engine: null, semanticReady: false,
    // Like engineStore.retrySemantic: success leaves the engine semantic-ready.
    retrySemantic: async () => {
      w.retries++;
      if (w.retryResult) w.setEngine({ semanticReady: true, engine: { isSemanticReady: () => true } });
      return w.retryResult;
    },
  };
  w.setEngine = (patch) => {
    const prev = w.engineState;
    w.engineState = { ...prev, ...patch };
    for (const fn of w.engineListeners) fn(w.engineState, prev);
  };
  w.keywordOnlyEngine = () => w.setEngine({ isReady: true, engine: { isSemanticReady: () => false }, semanticReady: false });
  globalThis.__sp = w;
  return w;
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
async function tick(ms) { mock.timers.tick(ms); await settle(); }
function fakeClock(t) {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  // The module narrates every attempt; the assertions are the record here.
  const quiet = [console.log, console.warn];
  console.log = console.warn = () => {};
  t.after(() => {
    mock.timers.reset();
    [console.log, console.warn] = quiet;
  });
}

test('a phone that can never hold LaBSE never downloads it, whatever fires', async (t) => {
  fakeClock(t);
  const w = world({ memory: { ...jambo, totalBytes: 2.9 * GiB } });
  const x = await prefetcher();
  const stop = x.startSemanticPrefetch();
  await tick(3_000);
  assert.equal(x.semanticPrefetchStatus().block, 'unsupported');
  for (const fn of w.netListeners) fn();
  for (const fn of w.appListeners) fn('active');
  x.nudgeSemanticPrefetch('focus');
  await tick(60 * MIN);
  assert.deepEqual(w.calls, []);
  stop();
});

test('launch fetches LaBSE, then the vectors, one at a time — even while RAM is short', async (t) => {
  fakeClock(t);
  // A busy JP1 at launch: too little free RAM to LOAD LaBSE now, which must not stop the download.
  const w = world({ mode: 'hold', memory: { ...jambo, availableBytes: 0.5 * GiB } });
  const x = await prefetcher();
  const stop = x.startSemanticPrefetch();
  await tick(2_999);
  assert.deepEqual(w.calls, [], 'the launch goes first');
  await tick(1);
  assert.deepEqual(w.calls, [LABSE]);
  w.pending.shift().resolve();
  await settle();
  assert.deepEqual(w.calls, [LABSE, VECTORS]);
  w.pending.shift().resolve();
  await settle();
  assert.equal(w.peak, 1, 'never two transfers at once');
  assert.deepEqual(x.semanticPrefetchStatus(), { block: null, waiting: false, failed: false });
  await tick(60 * MIN);
  for (const fn of w.appListeners) fn('active');
  await settle();
  assert.deepEqual(w.calls, [LABSE, VECTORS], 'files on disk: nothing more to fetch');
  stop();
});

test('offline: retries back off 1, 2, 4, 8, then every 10 min; the network coming back retries at once', async (t) => {
  fakeClock(t);
  const w = world({ mode: 'offline' });
  const x = await prefetcher();
  const stop = x.startSemanticPrefetch();
  await tick(3_000);
  assert.equal(w.calls.length, 1);
  assert.equal(x.semanticPrefetchStatus().waiting, true);
  const gaps = [1, 2, 4, 8, 10, 10].map((m) => m * MIN);
  for (const [i, gap] of gaps.entries()) {
    await tick(gap - 1);
    assert.equal(w.calls.length, i + 1, `no attempt before the ${gap / MIN} min step`);
    await tick(1);
    assert.equal(w.calls.length, i + 2);
  }
  for (const fn of w.netListeners) fn();
  await settle();
  assert.equal(w.calls.length, gaps.length + 2, 'Wi-Fi back: immediate attempt');
  w.mode = 'ok';
  await tick(MIN);
  assert.deepEqual(w.calls.slice(-2), [LABSE, VECTORS], 'backoff restarted at 1 min');
  assert.equal(x.semanticPrefetchStatus().waiting, false);
  stop();
  const after = w.calls.length;
  await tick(60 * MIN);
  assert.equal(w.calls.length, after, 'a stopped prefetcher schedules nothing');
});

test('returning to the foreground retries; nothing starts in the background', async (t) => {
  fakeClock(t);
  const w = world({ mode: 'offline', appState: 'background' });
  const x = await prefetcher();
  const stop = x.startSemanticPrefetch();
  await tick(3_000);
  assert.deepEqual(w.calls, []);
  w.appState = 'active';
  w.mode = 'ok';
  for (const fn of w.appListeners) fn('active');
  await settle();
  assert.deepEqual(w.calls, [LABSE, VECTORS]);
  stop();
});

test('files present + keyword-only engine: attaches search; a refusal (RAM) backs off; success stops', async (t) => {
  fakeClock(t);
  const w = world({ retryResult: false });
  w.have.add(LABSE).add(VECTORS);
  w.keywordOnlyEngine();
  const x = await prefetcher();
  const stop = x.startSemanticPrefetch();
  await tick(3_000);
  assert.equal(w.retries, 1);
  assert.deepEqual(w.calls, [], 'present files are not re-requested (no per-launch telemetry spam)');
  await tick(MIN);
  assert.equal(w.retries, 2);
  await tick(2 * MIN - 1);
  assert.equal(w.retries, 2, 'the second refusal waits longer');
  w.retryResult = true;
  await tick(1);
  assert.equal(w.retries, 3);
  await tick(60 * MIN);
  assert.equal(w.retries, 3);
  stop();
});

test('an engine that finishes loading keyword-only gets an attach attempt', async (t) => {
  fakeClock(t);
  const w = world();
  w.have.add(LABSE).add(VECTORS);
  const x = await prefetcher();
  const stop = x.startSemanticPrefetch();
  await tick(3_000);
  assert.equal(w.retries, 0, 'no engine loaded: nothing to attach to');
  w.keywordOnlyEngine();
  await tick(MIN);
  assert.equal(w.retries, 1);
  stop();
});

test('wrong bytes (integrity failure) are not re-downloaded every few minutes', async (t) => {
  fakeClock(t);
  const w = world({ mode: 'fatal' });
  const x = await prefetcher();
  const stop = x.startSemanticPrefetch();
  await tick(3_000);
  assert.equal(w.calls.length, 1);
  assert.deepEqual(x.semanticPrefetchStatus(), { block: null, waiting: false, failed: true },
    'the sidebar says the download failed, not that it waits for a connection');
  for (const fn of w.netListeners) fn();
  for (const fn of w.appListeners) fn('active');
  await tick(5 * 60 * MIN);
  assert.equal(w.calls.length, 1, 'parked: no retry on foreground, network or timer');
  await tick(60 * MIN);
  assert.equal(w.calls.length, 2, 'retried once the park expires');
  stop();
});

test('triggers during a running download never start a second one, and one queued pass follows', async (t) => {
  fakeClock(t);
  const w = world({ mode: 'hold' });
  const x = await prefetcher();
  const stop = x.startSemanticPrefetch();
  await tick(3_000);
  for (const fn of w.netListeners) fn();
  for (const fn of w.appListeners) fn('active');
  x.nudgeSemanticPrefetch('focus');
  await settle();
  assert.deepEqual(w.calls, [LABSE]);
  w.pending.shift().resolve();
  await settle();
  w.keywordOnlyEngine();
  w.pending.shift().resolve();
  await settle();
  assert.equal(w.peak, 1);
  assert.deepEqual(w.calls, [LABSE, VECTORS]);
  assert.equal(w.retries, 1, 'the engine that appeared mid-download gets its attach');
  assert.equal(w.attempts, 2, 'three triggers mid-download collapse into ONE follow-up pass');
  stop();
});

test('search-field nudges are throttled', async (t) => {
  fakeClock(t);
  const w = world({ retryResult: false });
  w.have.add(LABSE).add(VECTORS);
  w.keywordOnlyEngine();
  const x = await prefetcher(); // not started: no timers, only the nudges act
  for (let i = 0; i < 5; i++) x.nudgeSemanticPrefetch('focus');
  await settle();
  assert.equal(w.retries, 1);
  await tick(29_999);
  x.nudgeSemanticPrefetch('focus');
  await settle();
  assert.equal(w.retries, 1);
  await tick(1);
  x.nudgeSemanticPrefetch('focus');
  await settle();
  assert.equal(w.retries, 2);
});

test('no room for the files: no download, reported, and tried again later', async (t) => {
  fakeClock(t);
  const w = world({ memory: { ...jambo, freeStorageBytes: 0.5 * GiB } });
  const x = await prefetcher();
  const stop = x.startSemanticPrefetch();
  await tick(3_000);
  assert.deepEqual(w.calls, []);
  assert.equal(x.semanticPrefetchStatus().block, 'storage');
  w.memory = jambo;
  await tick(MIN);
  assert.deepEqual(w.calls, [LABSE, VECTORS]);
  assert.equal(x.semanticPrefetchStatus().block, null);
  stop();
});

test('the sidebar row: one size-weighted state for the pair', async () => {
  world();
  const x = await prefetcher();
  const st = (phase, percent = 0) => ({ phase, percent });
  const row = (over, files = [st('missing'), st('missing')]) => x.semanticRowState({
    prefetch: { block: null, waiting: false }, unsupported: false, engineSemantic: false, downloadsEnabled: true,
    ...over, files: [{ status: files[0], bytes: 300 }, { status: files[1], bytes: 100 }],
  });
  assert.equal(row({ unsupported: true, engineSemantic: true }).state, 'unsupported');
  assert.equal(row({ prefetch: { block: 'unsupported', waiting: false } }).state, 'unsupported');
  assert.deepEqual(row({ engineSemantic: true }), { state: 'ready', percent: 100 });
  assert.deepEqual(row({}, [st('downloaded', 100), st('downloaded', 100)]), { state: 'downloaded', percent: 100 });
  assert.deepEqual(row({}, [st('downloading', 50), st('missing')]), { state: 'downloading', percent: 37 });
  assert.deepEqual(row({}, [st('downloaded', 100), st('downloading', 50)]), { state: 'downloading', percent: 87 });
  assert.equal(row({ downloadsEnabled: false }, [st('paused', 20), st('missing')]).state, 'paused');
  assert.equal(row({ prefetch: { block: null, waiting: true } }, [st('failed', 20), st('missing')]).state, 'waiting');
  assert.equal(row({ prefetch: { block: 'storage', waiting: true } }).state, 'failed');
  assert.equal(row({ prefetch: { block: null, waiting: false, failed: true } }, [st('failed'), st('missing')]).state, 'failed',
    'wrong bytes are a failure, not a wait for a connection');
  assert.equal(row({}, [st('retrying', 20), st('missing')]).state, 'retrying');
  assert.equal(row({}).state, 'missing');
});

test('the download gate at its call site: RAM pressure blocks the load, not the download', async () => {
  const g = (globalThis.__mem = { snapshot: jambo, files: new Map() });
  const x = await load("export * from './src/engine/memory';", {
    'react-native': 'export const NativeModules = { HiraiaMemory: { snapshot: async () => globalThis.__mem.snapshot } };',
    'expo-file-system':
      'export const Paths = { document: "doc" }; export class File { constructor(...p) { this.name = p[p.length - 1]; }' +
      ' get exists() { return globalThis.__mem.files.has(this.name); } get size() { return globalThis.__mem.files.get(this.name); } }',
    '../config/model': config({ labse: 300, vectors: 100 }),
    '../updates/model': 'export const installedModelUpdate = async () => null;',
  });
  const quiet = console.log;
  console.log = () => {};
  try {
    g.snapshot = { ...jambo, availableBytes: 0.5 * GiB };
    await x.requireSemanticMemory(true); // missing files, busy phone: download allowed
    await assert.rejects(x.requireSemanticMemory(), (e) => e.reason === 'pressure');
    g.snapshot = { ...jambo, freeStorageBytes: 0.5 * GiB };
    await assert.rejects(x.requireSemanticMemory(true), (e) => e.reason === 'storage');
    g.files.set(LABSE, 300).set(VECTORS, 100);
    assert.equal(x.semanticAssetsMissing(), false);
    await x.requireSemanticMemory(true); // nothing to download: storage is irrelevant
    g.files.set(VECTORS, 99);
    assert.equal(x.semanticAssetsMissing(), true, 'a short file is a missing file');
    g.snapshot = { ...jambo, totalBytes: 2.9 * GiB };
    await assert.rejects(x.requireSemanticMemory(true), (e) => e.reason === 'unsupported');
  } finally {
    console.log = quiet;
    delete globalThis.__mem;
  }
});

test('with the real downloader: paused means no transfer, the engine joins the same transfer, one per file', async () => {
  const w = world();
  const files = new Map();
  const transfers = [];
  const prefs = new Map();
  const uri = (name) => 'file:///documents/models/' + name;
  w.missing = () => files.get(uri(LABSE)) !== 100 || files.get(uri(VECTORS)) !== 100;
  globalThis.__downloadStatusTest = {
    storage: { getItem: async (k) => prefs.get(k) ?? null, setItem: async (k, v) => prefs.set(k, v) },
    documentDirectory: 'file:///documents/',
    getInfoAsync: async (u) =>
      files.has(u) ? { exists: true, isDirectory: false, size: files.get(u), md5: 'good' } : { exists: false },
    makeDirectoryAsync: async () => {},
    deleteAsync: async (u) => { files.delete(u); },
    moveAsync: async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from); },
    createDownloadResumable: (_url, target, _o, progress) => {
      let finish;
      const done = new Promise((r) => { finish = r; });
      transfers.push({
        target,
        complete: () => {
          files.set(target, 100);
          progress({ totalBytesExpectedToWrite: 100, totalBytesWritten: 100 });
          finish({ status: 200 });
        },
      });
      return { downloadAsync: () => done, pauseAsync: async () => finish(null) };
    },
  };
  const x = await load(
    "export * from './src/engine/semanticPrefetch';" +
      "export { ensureRemoteAsset, assetDownloadStatus } from './src/engine/modelDownload';" +
      "export { setModelDownloadsEnabled } from './src/engine/modelDownloadControl';",
    {
      ...boundaries,
      '../config/model': config({ labse: 100, vectors: 100 }),
      '@react-native-async-storage/async-storage': 'export default globalThis.__downloadStatusTest.storage',
      'expo-file-system/legacy':
        'export const {documentDirectory,getInfoAsync,makeDirectoryAsync,deleteAsync,moveAsync,createDownloadResumable}=globalThis.__downloadStatusTest',
      '../telemetry/download': 'export const beginDownload=()=>({installed(){},failed(){}})',
      '../telemetry': 'export const track=()=>{}',
      'hiraia-managed-config': 'export const readAssetMirrorSetting=async()=>null',
    }
  );
  const until = async (fn) => {
    for (let n = 0; n < 500; n++) { if (fn()) return; await new Promise((r) => setTimeout(r, 1)); }
    throw Error('Timed out');
  };
  const quiet = [console.log, console.warn];
  console.log = console.warn = () => {};
  try {
    await x.setModelDownloadsEnabled(false);
    const pump = x.runSemanticPrefetch('test');
    await until(() => x.assetDownloadStatus(LABSE).phase === 'paused');
    // The search field is tapped meanwhile: the engine asks for the same file.
    const engineCall = x.ensureRemoteAsset({ url: 'https://assets.hiraia.org/models/' + LABSE,
      filename: LABSE, bytes: 100, md5: 'good', label: 'LaBSE' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(transfers.length, 0, 'the AI-downloads pause holds the prefetcher');
    await x.setModelDownloadsEnabled(true);
    await until(() => transfers.length === 1);
    assert.ok(transfers[0].target.includes(LABSE));
    transfers[0].complete();
    assert.equal(await engineCall, uri(LABSE).replace('file://', ''), 'the engine joined the one transfer');
    await until(() => transfers.length === 2);
    assert.ok(transfers[1].target.includes(VECTORS));
    w.keywordOnlyEngine();
    transfers[1].complete();
    await pump;
    assert.equal(transfers.length, 2, 'one transfer per file');
    assert.equal(w.retries, 1, 'search attached once both files landed');
  } finally {
    [console.log, console.warn] = quiet;
    delete globalThis.__downloadStatusTest;
  }
});

test('an unreadable memory reading defers the download without claiming a connection problem', async (t) => {
  fakeClock(t);
  const w = world({ memory: null });
  const x = await prefetcher();
  const stop = x.startSemanticPrefetch();
  await tick(3_000);
  assert.deepEqual(w.calls, []);
  assert.deepEqual(x.semanticPrefetchStatus(), { block: null, waiting: false, failed: false });
  w.memory = jambo;
  await tick(MIN);
  assert.deepEqual(w.calls, [LABSE, VECTORS], 'tried again on the backoff timer');
  stop();
});
