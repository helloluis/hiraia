/** Optional standalone host for the same ingestion route, independent of Next builds. */
import http from 'node:http';
import { Readable } from 'node:stream';
import { POST } from '../src/app/api/telemetry/batch/route';
import { getTelemetry } from '../src/lib/telemetry/store';

const db = getTelemetry(); // Fail startup clearly if the configured storage is unwritable.
const server = http.createServer(
  { requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 },
  async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (req.method !== 'POST' || req.url !== '/api/telemetry/batch') {
      res.writeHead(404);
      res.end();
      return;
    }
    const controller = new AbortController();
    req.on('aborted', () => controller.abort());
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      const request = new Request('http://localhost/api/telemetry/batch', {
        method: 'POST',
        headers,
        body: Readable.toWeb(req),
        duplex: 'half',
        signal: controller.signal,
      } as RequestInit & { duplex: string });
      const response = await POST(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      if (!res.headersSent) res.writeHead(503, { 'Retry-After': '60' });
      res.end();
    }
  }
);
server.maxConnections = 100;
server.maxRequestsPerSocket = 100;
server.listen(Number(process.env.TELEMETRY_PORT || 8136), '127.0.0.1', () => {
  console.log('Hiraia telemetry listening on loopback');
});
function stop() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeIdleConnections();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
