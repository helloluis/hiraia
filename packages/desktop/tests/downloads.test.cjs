const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStorage } = require('../src/storage.cjs');
const { createDownloads } = require('../src/downloads.cjs');
function fixture(t, emit = () => {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-download-')));
  const rendererRoot = path.join(root, 'renderer'); fs.mkdirSync(rendererRoot);
  const storage = createStorage({ rendererRoot, dataRoot: path.join(root, 'user') });
  const downloads = createDownloads(storage, emit);
  t.after(() => { downloads.close(); storage.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const fileUri = storage.paths.document + 'model.part';
  return { storage, downloads, fileUri };
}
test('resume appends the exact range and reports absolute progress', async t => {
  const progress = [];
  const { storage, downloads, fileUri } = fixture(t, (_channel, value) => progress.push(value.progress));
  storage.sync['fs.write'](fileUri, '1234');
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.Range, 'bytes=4-');
    return new Response('5678', { status: 206, headers: { 'content-range': 'bytes 4-7/8', 'content-length': '4' } });
  });
  await downloads.start({ id: 'resume', url: 'https://assets.hiraia.org/models/test', fileUri, offset: 4 });
  assert.equal(storage.sync['fs.read'](fileUri, 'utf8'), '12345678');
  assert.deepEqual(progress.at(-1), { totalBytesWritten: 8, totalBytesExpectedToWrite: 8 });
});
test('ignored or incorrect ranges never poison a saved prefix', async t => {
  const { storage, downloads, fileUri } = fixture(t);
  storage.sync['fs.write'](fileUri, '1234');
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('12345678', { headers: { 'content-length': '8' } }));
  const args = { id: 'range', url: 'https://assets.hiraia.org/models/test', fileUri, offset: 4 };
  assert.equal((await downloads.start(args)).status, 200);
  assert.equal(storage.sync['fs.read'](fileUri, 'utf8'), '1234');
  fetch.mock.mockImplementation(async () => new Response('wrong', { status: 206, headers: { 'content-range': 'bytes 0-4/8' } }));
  await assert.rejects(downloads.start(args), /range/);
  assert.equal(storage.sync['fs.read'](fileUri, 'utf8'), '1234');
});
test('interrupted transfers settle their writer and can resume from durable bytes', async t => {
  let downloads;
  const fx = fixture(t, (_channel, { progress }) => { if (progress.totalBytesWritten > 0) downloads.cancel('pause'); });
  ({ downloads } = fx);
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('prefix'));
      signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
    },
  }), { headers: { 'content-length': '12' } }));
  const result = await downloads.start({ id: 'pause', url: 'https://assets.hiraia.org/models/test', fileUri: fx.fileUri });
  assert.equal(result, null);
  assert.equal(fx.storage.sync['fs.read'](fx.fileUri, 'utf8'), 'prefix');
  await assert.rejects(downloads.start({ id: 'bad', url: 'https://untrusted.test/file', fileUri: fx.fileUri }));
});
