'use strict';
const fs = require('node:fs');
const { once } = require('node:events');

function createDownloads(storage, emit) {
  const active = new Map();
  async function start({ id, url, fileUri, offset = 0 }) {
    if (typeof id !== 'string' || active.has(id) || active.size >= 8) throw new Error('Invalid download');
    const remote = new URL(url);
    if (remote.protocol !== 'https:' || remote.hostname !== 'assets.hiraia.org' || remote.username || remote.password) throw new Error('Download origin is not allowed');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid download offset');
    const target = storage.resolve(fileUri, true);
    if (offset && (!fs.existsSync(target) || fs.statSync(target).size !== offset)) throw new Error('Partial file size changed');
    const controller = new AbortController();
    active.set(id, controller);
    let output;
    try {
      const response = await fetch(remote, { headers: offset ? { Range: `bytes=${offset}-` } : {}, redirect: 'error', signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      if (offset && (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`))) throw new Error('Server did not honor the requested range');
      const length = Number(response.headers.get('content-length'));
      const total = Number.isFinite(length) && length > 0 ? offset + length : -1;
      // Native storage stays streaming; model bytes never enter the renderer heap.
      output = fs.createWriteStream(target, { flags: offset ? 'a' : 'w' });
      output.on('error', error => controller.abort(error));
      let written = offset;
      let reported = 0;
      const progress = () => emit('download-progress', { id, progress: { totalBytesWritten: written, totalBytesExpectedToWrite: total } });
      progress();
      for await (const chunk of response.body) {
        if (!output.write(chunk)) await once(output, 'drain', { signal: controller.signal });
        written += chunk.length;
        if (Date.now() - reported > 100) { progress(); reported = Date.now(); }
      }
      await new Promise((resolve, reject) => { output.on('error', reject); output.end(resolve); });
      progress();
      return { uri: fileUri, status: response.status, headers: Object.fromEntries(response.headers) };
    } catch (error) {
      if (controller.signal.aborted) return null;
      throw error;
    } finally {
      // Settle only after the writer closes; callers can now verify or rename the partial.
      if (output && !output.closed) { const closed = once(output, 'close').catch(() => {}); output.destroy(); await closed; }
      active.delete(id);
    }
  }
  return { start, cancel: id => active.get(id)?.abort(), close: () => { for (const c of active.values()) c.abort(); } };
}
module.exports = { createDownloads };
