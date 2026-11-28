const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { proxyLocal } = require('./local-proxy.cjs');
const listen = async server => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const close = async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
test('real upstream resets before and after headers cannot double-send or crash teardown', { timeout: 5000 }, async () => {
  let upstreamResponse;
  const source = http.createServer((req, res) => {
    if (req.url === '/before') return req.socket.destroy();
    upstreamResponse = res;
    res.writeHead(200, { 'content-length': '1000' }); res.write('partial');
  });
  const base = await listen(source);
  const proxy = http.createServer((req, res) => proxyLocal(req, res, base));
  const target = await listen(proxy);
  try {
    const before = await new Promise((resolve, reject) => {
      http.get(target + '/before', response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }).on('error', reject);
    });
    assert.equal(before, 502);
    const after = await new Promise((resolve, reject) => {
      http.get(target + '/after', response => {
        response.once('data', () => upstreamResponse.destroy()); // headers definitely reached the client
        response.on('aborted', () => resolve({ status: response.statusCode, aborted: true }));
        response.on('error', () => {}); // expected incomplete stream, not an unhandled error
        response.on('end', () => reject(new Error('Reset response unexpectedly completed')));
      }).on('error', reject);
    });
    assert.deepEqual(after, { status: 200, aborted: true });
    await new Promise((resolve, reject) => {
      http.get(target + '/client-closes', response => {
        upstreamResponse.once('close', resolve);
        response.once('data', () => response.destroy());
        response.on('error', () => {});
      }).on('error', reject);
    });
  } finally { await close(proxy); await close(source); }
});
