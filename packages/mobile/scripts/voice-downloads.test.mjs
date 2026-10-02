import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const mobile = path.resolve(import.meta.dirname, '..');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  for (let i = 0; i < 500; i++) { if (check()) return; await wait(5); }
  throw new Error('Voice test timed out');
}
let sequence = 0;
async function bundle(dir, entry, mocks, desktop = false) {
  const output = path.join(dir, `voice-${sequence++}.cjs`);
  await build({ entryPoints: [path.join(mobile, entry)], outfile: output, platform: 'node', format: 'cjs', bundle: true,
    plugins: [{ name: 'voice-native-doubles', setup(builder) {
      if (desktop) builder.onResolve({ filter: /^(\.\/bundled|\.\.\/platform\/filePath)$/ }, args => ({
        path: path.resolve(args.resolveDir, args.path + '.web.ts'),
      }));
      builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? {path: args.path, namespace: 'mock'} : null);
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js', resolveDir: mobile }));
    } }],
  });
  return require(output);
}
function voice(id, content) {
  return { id, delivery: id === 'en' ? 'bundled' : 'download', filename: `voice-${id}-fixture.onnx`, bytes: content.length,
    md5: crypto.createHash('md5').update(content).digest('hex'), url: `https://assets.hiraia.org/models/voice-${id}-fixture.onnx` };
}

test('voice files verify APK bytes, migrate legacy caches, resume downloads, and reject poisoned caches', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-voice-files-'));
  t.after(() => { delete globalThis.__voice; fs.rmSync(dir, {recursive: true, force: true}); });
  const enBytes = Buffer.from('english weights'), tlBytes = Buffer.from('tagalog weights');
  const en = voice('en', enBytes), tl = voice('tl', tlBytes);
  const apkVoice = path.join(dir, 'english.onnx'); fs.writeFileSync(apkVoice, enBytes);
  const voices = path.join(dir, 'voices'); fs.mkdirSync(voices);
  const plain = uri => uri.replace(/^file:\/\//, '');
  let transfers = 0, copies = 0, free = 1e9;
  globalThis.__voice = {
    asset: { fromModule: () => ({ localUri: `file://${apkVoice}`, downloadAsync: async () => {} }) },
    fs: {
      documentDirectory: `file://${dir}/`, getFreeDiskStorageAsync: async () => free,
      getInfoAsync: async (uri, options) => {
        const file = plain(uri);
        if (!fs.existsSync(file)) return {exists: false};
        const stat = fs.statSync(file);
        return {exists: true, size: stat.size, isDirectory: stat.isDirectory(),
          md5: options?.md5 && stat.isFile() ? crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex') : undefined};
      },
      makeDirectoryAsync: async uri => fs.mkdirSync(plain(uri), {recursive: true}),
      deleteAsync: async uri => fs.rmSync(plain(uri), {force: true}),
      copyAsync: async ({from, to}) => { copies++; fs.copyFileSync(plain(from), plain(to)); },
      moveAsync: async ({from, to}) => fs.renameSync(plain(from), plain(to)),
    },
    download: async (spec, progress, signal) => {
      transfers++; assert.equal(spec.md5, tl.md5); assert.equal(spec.bytes, tl.bytes);
      assert.equal(spec.dir, `file://${voices}/`);
      await wait(10); if (signal?.aborted) throw new Error('aborted');
      const final = path.join(voices, spec.filename);
      fs.writeFileSync(final, tlBytes); progress?.(100); return final;
    },
  };
  const mocks = {
    'expo-asset': 'export const Asset=globalThis.__voice.asset',
    'expo-file-system/legacy': 'export const {documentDirectory,getInfoAsync,getFreeDiskStorageAsync,makeDirectoryAsync,moveAsync,copyAsync,deleteAsync}=globalThis.__voice.fs',
    '../../assets/voices/en/model.onnx': 'export default 1',
    '../engine/modelDownload': 'export const ensureRemoteAsset=globalThis.__voice.download',
  };
  const load = () => bundle(dir, 'src/voice/files.ts', mocks);
  let files = await load();
  const english = await files.installedVoicePath(en);
  assert.deepEqual(fs.readFileSync(english), enBytes); assert.equal(copies, 1); assert.equal(transfers, 0);
  await files.installedVoicePath(en); assert.equal(copies, 1);
  assert.equal(await files.installedVoicePath(tl), null); assert.equal(transfers, 0);
  fs.writeFileSync(path.join(voices, 'tl.onnx'), tlBytes);
  const tagalog = await files.installedVoicePath(tl);
  assert.deepEqual(fs.readFileSync(tagalog), tlBytes); assert.equal(transfers, 0);
  assert.equal(fs.existsSync(path.join(voices, 'tl.onnx')), false);
  files = await load(); assert.equal(await files.installedVoicePath(tl), tagalog, 'offline relaunch keeps migrated voice');
  // Same-size corruption is not accepted, and a failed legacy stamp cannot vouch for it.
  fs.writeFileSync(tagalog, Buffer.alloc(tl.bytes));
  fs.writeFileSync(path.join(voices, 'tl.onnx'), Buffer.alloc(tl.bytes));
  fs.writeFileSync(path.join(voices, 'tl.sha256'), 'a forged stamp');
  const partial = path.join(voices, tl.filename + '.part'); fs.writeFileSync(partial, 'prefix');
  files = await load(); assert.equal(await files.installedVoicePath(tl), null);
  assert.equal(fs.existsSync(tagalog), false); assert.equal(fs.readFileSync(partial, 'utf8'), 'prefix');
  free = 0; await assert.rejects(files.downloadVoice(tl), /storage/); assert.equal(transfers, 0); free = 1e9;
  const first = files.downloadVoice(tl); const second = files.downloadVoice(tl);
  const preload = files.installedVoicePath(tl);
  assert.deepEqual(await Promise.all([first, second, preload]), [tagalog, tagalog, tagalog]);
  assert.equal(transfers, 1, 'preload and two callers share one transfer');
  assert.deepEqual(fs.readFileSync(tagalog), tlBytes);
  files = await load(); assert.equal(await files.installedVoicePath(tl), tagalog); assert.equal(transfers, 1);
  fs.rmSync(english); fs.writeFileSync(apkVoice, Buffer.alloc(en.bytes)); files = await load();
  await assert.rejects(files.installedVoicePath(en), /integrity failure/);
  assert.equal(fs.existsSync(english), false, 'bad bundled bytes are never promoted');
});

test('Windows keeps both bundled voices and resolves encoded paths through the desktop bridge', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-voice-desktop-'));
  const priorWindow = globalThis.window;
  t.after(() => { globalThis.window = priorWindow; fs.rmSync(dir, {recursive: true, force: true}); });
  const document = 'file:///C:/Users/Jos%C3%A9%20100%25/Hiraia/';
  const resolved = [];
  globalThis.window = { hiraiaDesktop: {
    info: {paths: {document, cache: document + 'cache/'}},
    sync: (op, uri) => {
      if (op === 'memory') return {freeStorageBytes: 123456789};
      assert.equal(op, 'fs.path'); resolved.push(uri);
      return decodeURIComponent(new URL(uri).pathname.slice(1)).replaceAll('/', '\\');
    },
    invoke: async (op, uri) => {
      if (op === 'fs.mkdir') return;
      const language = uri.includes('voice-en-') ? 'en' : 'tl';
      const spec = JSON.parse(fs.readFileSync(path.join(mobile, 'assets/voices/catalog.json'))).voices[language];
      if (op === 'fs.stat') return {exists: true, isDirectory: false, size: spec.bytes};
      if (op === 'fs.hash') return spec.md5;
      throw new Error(`Unexpected filesystem operation: ${op}`);
    },
  } };
  const adapter = await bundle(dir, 'src/desktop/filesystemLegacy.ts', {});
  assert.equal(await adapter.getFreeDiskStorageAsync(), 123456789);
  const mocks = {
    'expo-asset': 'export const Asset = {fromModule() {throw new Error("Cached voices need no extraction");}}',
    'expo-file-system/legacy': `export * from ${JSON.stringify(path.join(mobile, 'src/desktop/filesystemLegacy.ts'))}`,
    '../engine/modelDownload': 'export async function ensureRemoteAsset() {throw new Error("Offline");}',
    '../../assets/voices/en/model.onnx': 'module.exports = 1',
    '../../assets/voices/tl/model.onnx': 'module.exports = 2',
  };
  const { VOICES } = await bundle(dir, 'src/voice/catalog.ts', mocks, true);
  const files = await bundle(dir, 'src/voice/files.ts', mocks, true);
  for (const voice of Object.values(VOICES)) {
    assert.equal(voice.delivery, 'bundled');
    const native = await files.installedVoicePath(voice);
    assert.equal(native, `C:\\Users\\José 100%\\Hiraia\\voices\\${voice.filename}`);
  }
  assert.ok(resolved.every(uri => uri.startsWith(document + 'voices/')));
});

test('voice selection, cancellation, offline restart and user pause do not depend on the tutor model', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-voice-lifecycle-'));
  const en = voice('en', Buffer.from('english')), tl = voice('tl', Buffer.from('tagalog'));
  const saved = new Map(), installed = new Set(['en']), engineListeners = new Set(), appListeners = new Set(), netListeners = new Set();
  let learner = {language: null, bootstrapped: true}, transfers = 0, releases = [], fatal = false;
  const events = [];
  const app = { currentState: 'active', addEventListener: (_, listener) => { appListeners.add(listener); return {remove: () => appListeners.delete(listener)}; } };
  const emit = value => { app.currentState = value; for (const listener of appListeners) listener(value); };
  const pick = language => { const previous = learner; learner = {...learner, language}; for (const listener of engineListeners) listener(learner, previous); };
  globalThis.__voice = {
    app,
    storage: {getItem: async key => saved.get(key) ?? null, setItem: async (key, value) => saved.set(key, value)},
    engine: {getState: () => learner, subscribe: listener => {engineListeners.add(listener); return () => engineListeners.delete(listener);}},
    network: listener => {netListeners.add(listener); return () => netListeners.delete(listener);},
    catalog: language => language === 'english' ? en : language === 'tagalog' ? tl : null,
    files: {
      voiceIsInstalled: voice => installed.has(voice.id),
      installedVoicePath: async voice => installed.has(voice.id) ? `/voices/${voice.id}.onnx` : null,
      downloadVoice: async (voice, progress, signal) => {
        transfers++; events.push('start:' + voice.id);
        if (fatal) throw Object.assign(new Error('wrong hash'), {fatal: true});
        progress(25);
        await new Promise((resolve, reject) => {
          const abort = () => { events.push('abort:' + voice.id); reject(new Error('cancelled')); };
          signal.addEventListener('abort', abort, {once: true});
          releases.push(() => { signal.removeEventListener('abort', abort); resolve(); });
          if (signal.aborted) abort();
        });
        if (signal.aborted) throw new Error('cancelled');
        installed.add(voice.id); progress(100); return `/voices/${voice.id}.onnx`;
      },
    },
  };
  const mocks = {
    '@react-native-async-storage/async-storage': 'export default globalThis.__voice.storage',
    'react-native': 'export const AppState=globalThis.__voice.app',
    '../store/engineStore': 'export const useEngineStore=globalThis.__voice.engine',
    '../net/connectivity': 'export const subscribeInternetRestored=globalThis.__voice.network',
    './catalog': 'export const voiceForLanguage=globalThis.__voice.catalog',
    './files': 'export const {downloadVoice,installedVoicePath,voiceIsInstalled}=globalThis.__voice.files',
  };
  const load = () => bundle(dir, 'src/voice/downloads.ts', mocks);
  let stop = () => {};
  t.after(() => {stop(); delete globalThis.__voice; fs.rmSync(dir, {recursive: true, force: true});});
  let downloads = await load(); stop = downloads.startVoiceDownloads(); await wait(20);
  assert.equal(transfers, 0, 'no selected language means no voice download');
  pick('english'); await until(() => downloads.voiceDownloadStatus().phase === 'ready'); assert.equal(transfers, 0);
  pick('cebuano'); await until(() => downloads.voiceDownloadStatus().phase === 'unavailable'); assert.equal(transfers, 0);
  pick('tagalog'); await until(() => transfers === 1); assert.equal(downloads.voiceDownloadStatus().percent, 25);
  pick('english'); await until(() => downloads.voiceDownloadStatus().phase === 'ready');
  assert.deepEqual(events, ['start:tl', 'abort:tl']); assert.equal(installed.has('tl'), false);
  pick('tagalog'); await until(() => transfers === 2); emit('background');
  await until(() => downloads.voiceDownloadStatus().phase === 'paused');
  for (const listener of netListeners) listener(); await wait(20); assert.equal(transfers, 2);
  emit('active'); await until(() => transfers === 3);
  await downloads.setVoiceDownloadsEnabled(false); await until(() => downloads.voiceDownloadStatus().phase === 'paused');
  assert.equal(saved.get('hiraia.voice-downloads.enabled.v1'), 'false');
  stop(); downloads = await load(); stop = downloads.startVoiceDownloads();
  await until(() => downloads.voiceDownloadStatus().phase === 'paused'); assert.equal(transfers, 3, 'pause survives restart');
  await downloads.setVoiceDownloadsEnabled(true); await until(() => transfers === 4); releases.at(-1)();
  await until(() => downloads.voiceDownloadStatus().phase === 'ready'); assert.equal(downloads.voiceAvailable('tagalog'), true);
  stop(); downloads = await load(); stop = downloads.startVoiceDownloads();
  await until(() => downloads.voiceDownloadStatus().phase === 'ready'); assert.equal(transfers, 4, 'offline restart uses installed voice');
  stop(); installed.delete('tl'); fatal = true; downloads = await load(); stop = downloads.startVoiceDownloads();
  await until(() => downloads.voiceDownloadStatus().phase === 'failed'); assert.equal(transfers, 5);
  for (const listener of netListeners) listener(); await wait(20); assert.equal(transfers, 5, 'a complete bad download is not bought repeatedly');
  fatal = false; await downloads.setVoiceDownloadsEnabled(true); await until(() => transfers === 6); releases.at(-1)();
  await until(() => downloads.voiceDownloadStatus().phase === 'ready');
  stop(); stop(); assert.equal(engineListeners.size, 0); assert.equal(appListeners.size, 0); assert.equal(netListeners.size, 0);
});
