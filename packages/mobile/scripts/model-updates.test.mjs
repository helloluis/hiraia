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
  let seq = 0, corrupt = true, transfers = 0, imageAccepts = 0, background = false;
  const model = { id: 'base', revision: 2, runtime: 'hiraia-2b-qwen35-v1', label: 'Tutor v3', notes: '',
    filename: 'tutor-v3.gguf', url: 'https://assets.hiraia.org/models/tutor-v3.gguf', bytes: 100, md5: 'a'.repeat(32) };
  const catalog = { format: 1, revision: 2, minAppVersionCode: 16, maxAppVersionCode: 16,
    imageBaseline: images.version, models: [model], imagePacks: [] };
  const key = 'hiraia.model-update.v1';
  globalThis.__modelUpdateTest = {
    storage: { getItem: async k => prefs.get(k) ?? null, setItem: async (k, v) => prefs.set(k, v), removeItem: async k => prefs.delete(k) },
    legacy: { documentDirectory: 'file:///documents/', getInfoAsync: async uri => files.get(uri) ?? { exists: false },
      deleteAsync: async uri => { deleted.push(uri); files.delete(uri); } },
    app: { addEventListener: (_, f) => { listeners.add(f); return { remove: () => listeners.delete(f) }; } },
    engine: { getState: () => ({ readyStage: 'idle' }), subscribe: () => () => {} },
    images: { initializeImages: async () => {}, pendingImageUpdates: () => [], acceptImageUpdates: async () => { imageAccepts++; } },
    download: async (m, progress, signal) => {
      transfers++;
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
  try {
    let runtime = await load();
    let store = runtime.useAssetUpdateStore;
    await store.getState().acceptManifest(catalog);
    assert.equal(store.getState().status, 'available');
    assert.equal(transfers, 0, 'Checking never downloads weights');
    await store.getState().snooze();
    await store.getState().acceptManifest(catalog);
    assert.equal(store.getState().status, 'snoozed');
    await store.getState().acceptManifest(catalog, true);
    await store.getState().download();
    assert.equal(store.getState().status, 'failed');
    assert.equal(prefs.has(key), false, 'A same-size corrupt cache cannot become active');
    assert.deepEqual(deleted, ['file:///documents/models/tutor-v3.gguf']);
    assert.equal(imageAccepts, 0);
    background = true;
    await store.getState().download();
    assert.equal(store.getState().status, 'failed');
    assert.equal(prefs.has(key), false);
    background = false; corrupt = false;
    await store.getState().download();
    assert.equal(store.getState().status, 'ready');
    assert.equal(await runtime.installedModelUpdate(), null, 'No replacement of the current process selection');
    assert.equal(JSON.parse(prefs.get(key)).models[0].filename, model.filename);
    runtime = await load(); store = runtime.useAssetUpdateStore;
    assert.deepEqual(await runtime.installedModelUpdate(), model);
    await store.getState().acceptManifest(catalog, true);
    assert.equal(store.getState().status, 'idle', 'An installed version is not reoffered');

    const next = {...model, revision: 3, filename: 'tutor-v4.gguf', url: 'https://assets.hiraia.org/models/tutor-v4.gguf', md5: 'b'.repeat(32)};
    await store.getState().acceptManifest({...catalog, revision: 3, models: [next]}, true);
    assert.equal(store.getState().model.filename, next.filename);
    await store.getState().acceptManifest(catalog, true);
    assert.equal(store.getState().model.filename, next.filename, 'Old catalog cannot roll back the offer');
    await store.getState().acceptManifest({...catalog, revision: 3, models: [{...next, md5: 'c'.repeat(32)}]}, true);
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
    await runtime.useAssetUpdateStore.getState().acceptManifest({...catalog, revision: 3, models: [next]}, true);
    assert.equal(runtime.useAssetUpdateStore.getState().status, 'idle', 'A rejected revision is not downloaded repeatedly');
    assert.equal(listeners.size, 0);

    files.delete('file:///documents/models/' + model.filename);
    runtime = await load();
    assert.equal(await runtime.installedModelUpdate(), null, 'Missing installed files safely fall back to baseline');
  } finally {
    delete globalThis.__modelUpdateTest;
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
