const assert = require('node:assert/strict');
const http = require('node:http');
function proxyLocal(req, res, base, onResponse = () => {}) {
  // A single loopback destination, never a general proxy or absolute URL forwarder.
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  if (!req.url.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400); return res.end(); }
  const failed = () => {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) res.destroy();
    else { res.writeHead(502); res.end(); }
  };
  const upstream = http.request(base + req.url, { method: req.method,
    headers: { ...req.headers, host: new URL(base).host } }, remote => {
    if (res.destroyed || res.writableEnded) { remote.destroy(); return; }
    onResponse(req.url, remote.statusCode);
    res.writeHead(remote.statusCode, remote.headers);
    remote.on('error', failed);
    remote.pipe(res);
  });
  upstream.on('error', failed);
  res.on('close', () => upstream.destroy());
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}
module.exports = { proxyLocal };
