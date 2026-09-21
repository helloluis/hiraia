import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const mobile = path.resolve(import.meta.dirname, '..');
const base = {
  filename: 'tutor-v2.gguf',
  label: 'Tutor',
  bytes: 100,
  md5: 'good',
  url: 'https://example.invalid/model',
};
const uri = (spec) => 'file:///documents/models/' + spec.filename;
const until = async (fn) => {
  for (let n = 0; n < 100; n++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 1));
  }
  throw Error('Timed out');
};

test('download status follows verified files, isolates images, and never initiates downloads when inspected', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-download-status-'));
  const files = new Map(),
    transfers = [];
  let digest = 'good',
    releaseHash = null,
    blockHash = false;
  globalThis.__downloadStatusTest = {
    documentDirectory: 'file:///documents/',
    getInfoAsync: async (uri, options) => {
      if (options?.md5 && blockHash)
        await new Promise((r) => {
          releaseHash = r;
        });
      return files.has(uri)
        ? { exists: true, isDirectory: false, size: files.get(uri), md5: digest }
        : { exists: false };
    },
    makeDirectoryAsync: async () => {},
    deleteAsync: async (uri) => {
      files.delete(uri);
    },
    moveAsync: async ({ from, to }) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
    createDownloadResumable: (_, target, options, progress) => {
      let finish;
      const done = new Promise((r) => {
        finish = r;
      });
      transfers.push({
        progress: (bytes) => {
          files.set(target, bytes);
          progress({ totalBytesExpectedToWrite: 100, totalBytesWritten: bytes });
        },
        finish: () => finish({ status: 200 }),
      });
      return { downloadAsync: () => done, pauseAsync: async () => finish(null) };
    },
  };
  const mocks = {
    'expo-file-system/legacy':
      'export const {documentDirectory,getInfoAsync,makeDirectoryAsync,deleteAsync,moveAsync,createDownloadResumable}=globalThis.__downloadStatusTest',
    '../telemetry/download': 'export const beginDownload=()=>({installed(){},failed(){}})',
    '../telemetry': 'export const track=()=>{}',
  };
  let seq = 0;
  async function load() {
    const outfile = path.join(dir, `runtime-${seq++}.cjs`);
    await build({
      entryPoints: [path.join(mobile, 'src/engine/modelDownload.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      plugins: [
        {
          name: 'mocks',
          setup(b) {
            b.onResolve({ filter: /.*/ }, (a) =>
              a.path in mocks ? { path: a.path, namespace: 'mock' } : null
            );
            b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({
              contents: mocks[a.path],
              loader: 'js',
            }));
          },
        },
      ],
    });
    return require(outfile);
  }
  try {
    let x = await load();
    await x.inspectAssetDownload(base);
    assert.equal(x.assetDownloadStatus(base.filename).phase, 'missing');
    files.set(uri(base) + '.part', 35);
    await x.inspectAssetDownload(base);
    assert.deepEqual(x.assetDownloadStatus(base.filename), { phase: 'paused', percent: 35 });
    files.set(uri(base), 100);
    await x.inspectAssetDownload(base);
    assert.equal(x.assetDownloadStatus(base.filename).phase, 'downloaded');
    x = await load(); // A cold launch discovers the saved file, without engine initialization.
    await x.inspectAssetDownload(base);
    assert.equal(x.assetDownloadStatus(base.filename).phase, 'downloaded');
    assert.equal(transfers.length, 0);
    files.delete(uri(base));
    files.delete(uri(base) + '.part');
    const history = [];
    const stop = x.subscribeAssetDownloads(() =>
      history.push(x.assetDownloadStatus(base.filename).phase)
    );
    blockHash = true;
    const pending = x.ensureRemoteAsset(base);
    const joined = x.ensureRemoteAsset(base);
    await until(() => transfers.length === 1);
    transfers[0].progress(45);
    await x.inspectAssetDownload(base);
    assert.deepEqual(x.assetDownloadStatus(base.filename), { phase: 'downloading', percent: 45 });
    transfers[0].progress(100);
    transfers[0].finish();
    await until(() => releaseHash);
    assert.equal(x.assetDownloadStatus(base.filename).phase, 'verifying');
    assert.equal(
      files.has(uri(base)),
      false,
      'No success before digest verification and promotion'
    );
    releaseHash();
    blockHash = false;
    await Promise.all([pending, joined]);
    assert.equal(transfers.length, 1, 'Observers and joined callers never duplicate a transfer');
    assert.equal(x.assetDownloadStatus(base.filename).phase, 'downloaded');
    assert(history.includes('downloading') && history.includes('verifying'));
    stop();
    const image = { ...base, filename: 'common-01.hpak' };
    const imageRun = x.ensureRemoteAsset(image);
    await until(() => transfers.length === 2);
    transfers[1].progress(20);
    assert.equal(
      x.assetDownloadStatus(base.filename).phase,
      'downloaded',
      'Image progress cannot change the LLM checkmark'
    );
    transfers[1].progress(100);
    transfers[1].finish();
    await imageRun;
    const bad = { ...base, filename: 'bad.gguf' };
    digest = 'bad';
    const failure = assert.rejects(x.ensureRemoteAsset(bad), /MD5|md5/);
    await until(() => transfers.length === 3);
    transfers[2].progress(100);
    transfers[2].finish();
    await failure;
    assert.equal(x.assetDownloadStatus(bad.filename).phase, 'failed');
    assert.equal(files.has(uri(bad)), false);
    digest = 'good';
    const paused = { ...base, filename: 'paused.gguf' },
      controller = new AbortController();
    const cancelled = assert.rejects(
      x.ensureRemoteAsset(paused, undefined, controller.signal),
      /aborted/
    );
    await until(() => transfers.length === 4);
    transfers[3].progress(25);
    controller.abort();
    await cancelled;
    assert.deepEqual(x.assetDownloadStatus(paused.filename), { phase: 'paused', percent: 25 });
    assert.equal(files.get(uri(paused) + '.part'), 25, 'Observability preserves resumable bytes');
  } finally {
    delete globalThis.__downloadStatusTest;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
