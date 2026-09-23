import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const images = JSON.parse(fs.readFileSync(path.join(mobile, 'src/generated/imagePacks.generated.json')));

test('model updates verify cached bytes, preserve the running model, and recover the prior receipt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-model-update-'));
  const prefs = new Map(), files = new Map(), deleted = [], listeners = new Set();
  let seq = 0, corrupt = true, transfers = 0, imageAccepts = 0, background = false, blocked = false, holdTransfer = false;
  const model = { id: 'base', revision: 2, runtime: 'hiraia-2b-qwen35-v1', label: 'Tutor v3', notes: '',
    filename: 'tutor-v3.gguf', url: 'https://assets.hiraia.org/models/tutor-v3.gguf', bytes: 100, md5: 'a'.repeat(32) };
  const catalog = { format: 1, revision: 2, minAppVersionCode: 16, maxAppVersionCode: 16,
    imageBaseline: images.version, models: [model], imagePacks: [] };
  const key = 'hiraia.model-update.v1';
  globalThis.__modelUpdateTest = {
    storage: { getItem: async k => prefs.get(k) ?? null, setItem: async (k, v) => prefs.set(k, v), removeItem: async k => prefs.delete(k) },
    legacy: { documentDirectory: 'file:///documents/', getInfoAsync: async uri => files.get(uri) ?? { exists: false },
      deleteAsync: async uri => { deleted.push(uri); files.delete(uri); } },
    app: { currentState: 'active', addEventListener: (_, f) => { listeners.add(f); return { remove: () => listeners.delete(f) }; } },
    engine: { getState: () => ({ readyStage: 'idle' }), subscribe: () => () => {} },
    images: { initializeImages: async () => {}, pendingImageUpdates: () => [], acceptImageUpdates: async () => { imageAccepts++; } },
    memory: async () => ({totalBytes: (blocked ? 4 : 8)*1024**3, availableBytes: 4*1024**3, thresholdBytes: 0, freeStorageBytes: 8*1024**3, lowMemory: false, lowRamDevice: false}),
    download: async (m, progress, signal) => {
      transfers++;
      if (holdTransfer) await new Promise((resolve, reject) => {
        if (signal.aborted) reject(Error('paused'));
        else signal.addEventListener('abort', () => reject(Error('paused')), {once: true});
      });
      if (background) { for (const f of listeners) f('background'); assert.equal(signal.aborted, true); throw Error('paused'); }
      const uri = 'file:///documents/models/' + m.filename;
      files.set(uri, { exists: true, isDirectory: false, size: m.bytes, md5: corrupt ? '0'.repeat(32) : m.md5 });
      progress(100); return uri;
    },
  };
  const mocks = {
    '@react-native-async-storage/async-storage': 'export default globalThis.__modelUpdateTest.storage',
    'expo-file-system/legacy': 'export const {documentDirectory,getInfoAsync,deleteAsync}=globalThis.__modelUpdateTest.legacy',
    'expo-application': 'export const nativeBuildVersion="16"',
    'react-native': 'export const AppState=globalThis.__modelUpdateTest.app',
    'zustand': `export {createStore as create} from ${JSON.stringify(require.resolve('zustand/vanilla'))}`,
    './engineStore': 'export const useEngineStore=globalThis.__modelUpdateTest.engine',
    '../config/model': 'export const REMOTE_ASSETS={base:{filename:"baseline.gguf",md5:"dddddddddddddddddddddddddddddddd"}}',
    '../engine/memory': 'export const readMemory=globalThis.__modelUpdateTest.memory',
    '../engine/modelDownload': 'export const ensureRemoteAsset=globalThis.__modelUpdateTest.download',
    '../images/installer': 'export const {initializeImages,pendingImageUpdates,acceptImageUpdates}=globalThis.__modelUpdateTest.images',
  };
  async function load() {
    const outfile = path.join(dir, `runtime-${seq++}.cjs`);
    await build({ stdin: { contents: `export * from './src/updates/model'; export * from './src/store/assetUpdateStore';`, resolveDir: mobile, loader: 'ts' },
      outfile, bundle: true, platform: 'node', format: 'cjs', plugins: [{ name: 'native', setup(b) {
        b.onResolve({filter: /.*/}, a => a.path in mocks ? {path: a.path, namespace: 'mock'} : null);
        b.onLoad({filter: /.*/, namespace: 'mock'}, a => ({contents: mocks[a.path], loader: 'js', resolveDir: mobile}));
      } }] });
    return require(outfile);
  }
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  const advanceRetry = () => { now += 15*60*1000; };
  try {
    let runtime = await load();
    let store = runtime.useAssetUpdateStore;
    await store.getState().acceptManifest(catalog);
    assert.equal(store.getState().status, 'available');
    assert.equal(imageAccepts, 1, 'Images are automatically queued when the catalog is accepted');
    await store.getState().download();
    assert.equal(store.getState().status, 'failed');
    assert.equal(prefs.has(key), false, 'A same-size corrupt cache cannot become active');
    assert.deepEqual(deleted, ['file:///documents/models/tutor-v3.gguf']);
    assert.equal(imageAccepts, 1, 'A failed model does not hold back image updates');
    await store.getState().download();
    assert.equal(transfers, 1, 'Failed automatic transfers back off');
    advanceRetry();
    background = true;
    await store.getState().download();
    assert.equal(store.getState().status, 'failed');
    assert.equal(prefs.has(key), false);
    background = false, blocked = false, holdTransfer = false; corrupt = false;
    await store.getState().download();
    assert.equal(store.getState().status, 'ready');
    assert.equal(await runtime.installedModelUpdate(), null, 'No replacement of the current process selection');
    assert.equal(JSON.parse(prefs.get(key)).models[0].filename, model.filename);
    runtime = await load(); store = runtime.useAssetUpdateStore;
    assert.deepEqual(await runtime.installedModelUpdate(), model);
    await store.getState().acceptManifest(catalog);
    assert.equal(store.getState().status, 'idle', 'An installed version is not reoffered');

    const next = {...model, revision: 3, filename: 'tutor-v4.gguf', url: 'https://assets.hiraia.org/models/tutor-v4.gguf', md5: 'b'.repeat(32)};
    await store.getState().acceptManifest({...catalog, revision: 3, models: [next]});
    assert.equal(store.getState().model.filename, next.filename);
    await store.getState().acceptManifest(catalog);
    assert.equal(store.getState().model.filename, next.filename, 'Old catalog cannot roll back the offer');
    await store.getState().acceptManifest({...catalog, revision: 3, models: [{...next, md5: 'c'.repeat(32)}]});
    assert.equal(store.getState().model.md5, next.md5, 'A reused revision cannot swap hashes');
    await store.getState().download();
    assert.deepEqual(await runtime.installedModelUpdate(), model);
    await runtime.rejectModelUpdate(model);
    assert.equal(JSON.parse(prefs.get(key)).models[0].revision, next.revision, 'Failure loading an older model cannot erase a newly downloaded receipt');
    runtime = await load();
    assert.deepEqual(await runtime.installedModelUpdate(), next);
    await runtime.rejectModelUpdate(next);
    assert.deepEqual(await runtime.installedModelUpdate(), model, 'Runtime failure restores the previous receipt');
    assert.equal(await runtime.rejectedModelRevision(), 3);
    await runtime.useAssetUpdateStore.getState().acceptManifest({...catalog, revision: 3, models: [next]});
    assert.equal(runtime.useAssetUpdateStore.getState().status, 'idle', 'A rejected revision is not downloaded repeatedly');
    assert.equal(listeners.size, 0);

    // The real scheduler starts eligible transfers without a tap, retries on a
    // foreground return, and never competes with an APK or downloads on 4GB phones.
    const newer = {...next, revision: 4, filename: 'tutor-v5.gguf', url: 'https://assets.hiraia.org/models/tutor-v5.gguf'};
    let apkDownloading = true;
    const stop = runtime.startAssetUpdates(() => apkDownloading);
    const settle = () => new Promise(resolve => setTimeout(resolve, 15));
    const before = transfers;
    try {
      prefs.set('assets.snooze.v1', JSON.stringify({revision: 4, until: now + 86400000}));
      await runtime.useAssetUpdateStore.getState().acceptManifest({...catalog, revision: 4, models: [newer]});
      await settle();
      assert.equal(transfers, before, 'APK transfer has priority');
      apkDownloading = false; blocked = true;
      for (const f of listeners) f('active');
      await settle();
      assert.equal(transfers, before, 'Memory-ineligible phones do not download updated LLMs');
      blocked = false; advanceRetry(); holdTransfer = true;
      for (const f of listeners) f('active');
      await settle();
      assert.equal(transfers, before + 1);
      await runtime.useAssetUpdateStore.getState().download();
      assert.equal(transfers, before + 1, 'A second trigger cannot duplicate a live model transfer');
      const queuedBefore = imageAccepts;
      await runtime.useAssetUpdateStore.getState().acceptManifest({...catalog, revision: 5, models: [newer]});
      assert.equal(imageAccepts, queuedBefore + 1, 'Later image catalogs are accepted during model transfers');
      apkDownloading = true;
      await runtime.pauseAssetModelDownload();
      assert.equal(runtime.useAssetUpdateStore.getState().status, 'failed', 'APK priority aborts and drains a live model transfer');
      assert.equal(JSON.parse(prefs.get(key)).models[0].revision, model.revision, 'Interrupted updates do not install receipts');
      holdTransfer = false; apkDownloading = false; background = true;
      for (const f of listeners) f('active');
      await settle();
      assert.equal(runtime.useAssetUpdateStore.getState().status, 'failed');
      background = false;
      for (const f of listeners) f('active');
      await settle();
      assert.equal(runtime.useAssetUpdateStore.getState().status, 'ready', 'Foreground resumes automatically, ignoring obsolete consent snoozes');
      const completedTransfers = transfers;
      await runtime.useAssetUpdateStore.getState().acceptManifest({...catalog, revision: 5, models: [newer]});
      await settle();
      assert.equal(transfers, completedTransfers, 'Staged models do not download again on a newer image catalog');
      assert.equal(runtime.useAssetUpdateStore.getState().status, 'ready');
    } finally { stop(); }
    assert.equal(listeners.size, 0, 'Scheduler tears down its listeners');

    files.delete('file:///documents/models/' + model.filename);
    files.delete('file:///documents/models/' + newer.filename);
    runtime = await load();
    assert.equal(await runtime.installedModelUpdate(), null, 'Missing installed files safely fall back to baseline');
  } finally {
    Date.now = realNow;
    delete globalThis.__modelUpdateTest;
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
