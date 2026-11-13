/**
 * Standalone development server: plain Node http in front of `createTalaServer().handle`.
 * OWNER: workstream A.
 *
 *   pnpm --filter @hiraia/tala-server dev          # tsx watch src/dev-server.ts
 *   TALA_PORT=8790 pnpm --filter @hiraia/tala-server dev
 *
 * It listens on 127.0.0.1 only unless TALA_HOST says otherwise. It is for local work and tests: production
 * mounts the same `handle` inside the web app (packages/tala-web) behind the site's own proxy.
 * Configuration comes from the environment; see src/kernel/README.md.
 */
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { API_BASE } from '@hiraia/tala-core';
import { createTalaServer } from './index';
import type { TalaServer } from './index';

export interface DevServerOptions {
  /** 0 picks a free port. */
  port?: number;
  host?: string;
  /** Use this server instead of building one from the environment. The caller closes it. */
  tala?: TalaServer;
}

export interface DevServer {
  url: string;
  port: number;
  tala: TalaServer;
  close(): Promise<void>;
}

function toRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? '127.0.0.1';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return new Request(url, { method, headers });
  // The body is streamed, so the kernel's size limit stops a large upload before it is buffered.
  return new Request(url, { method, headers, body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' } as RequestInit);
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  const cookies = response.headers.getSetCookie();
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'set-cookie') res.setHeader(name, value);
  });
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function startDevServer(options: DevServerOptions = {}): Promise<DevServer> {
  const tala = options.tala ?? createTalaServer();
  const host = options.host ?? '127.0.0.1';
  const http: Server = createHttpServer((req, res) => {
    void (async () => {
      try {
        // The socket's own address: the one thing here a client cannot forge.
        await send(res, await tala.handle(toRequest(req), { ip: req.socket.remoteAddress ?? null }));
      } catch {
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      }
    })();
  });
  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port ?? 0, host, () => {
      http.off('error', reject);
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : (options.port ?? 0);
      resolve({
        url: `http://${host.includes(':') ? `[${host}]` : host}:${port}`,
        port,
        tala,
        close: () =>
          new Promise<void>((done) => {
            http.close(() => {
              if (!options.tala) tala.close();
              done();
            });
            http.closeAllConnections();
          }),
      });
    });
  });
}

function portFromEnv(): number {
  const raw = process.env.TALA_PORT?.trim();
  if (!raw) return 8787;
  if (!/^\d{1,5}$/.test(raw) || Number(raw) > 65535) throw new Error('TALA_PORT must be a port number.');
  return Number(raw);
}

async function main(): Promise<void> {
  const port = portFromEnv();
  let server: DevServer;
  try {
    server = await startDevServer({ port, host: process.env.TALA_HOST?.trim() || '127.0.0.1' });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Stop the other server or set TALA_PORT to a free port.`);
    else console.error(err instanceof Error ? err.message : 'The server could not start.');
    process.exit(1);
  }
  console.log(`Tala API (${server.tala.config.environment}) on ${server.url}${API_BASE}  ·  database: ${server.tala.config.dbPath}`);
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) void main();
