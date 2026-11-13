import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { API_BASE, ApiError, createTalaClient, ROUTE_NAMES } from '@hiraia/tala-core';
import { startDevServer } from './dev-server';
import { createTalaServer, getTalaServer, modules } from './index';
import { createServer } from './kernel/server';
import { loadConfig } from './kernel/config';
import { createTestServer } from './testing';

test('dev server: real HTTP in front of the kernel, cookies and streamed bodies included', async () => {
  const t = createTestServer();
  const dev = await startDevServer({ tala: t.server, port: 0 });
  try {
    const base = `${dev.url}${API_BASE}`;
    const config = await fetch(`${base}/config`);
    assert.equal(config.status, 200);
    assert.equal(config.headers.get('cache-control'), 'no-store');
    assert.equal(((await config.json()) as { environment: string }).environment, 'local');

    const signUp = await fetch(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dev@example.test', password: 'kalabaw-bituin-ilog-27', displayName: 'Dev Teacher' }),
    });
    assert.equal(signUp.status, 200);
    const cookie = signUp.headers.getSetCookie()[0]!;
    assert.match(cookie, /^tala_session=[A-Za-z0-9_-]{43}; Max-Age=\d+; Path=\/; HttpOnly; SameSite=Lax$/);
    const { token } = (await signUp.json()) as { token: string };

    const me = await fetch(`${base}/auth/me`, { headers: { cookie: cookie.split(';')[0]! } });
    assert.equal(me.status, 200);

    // The typed client works against it unchanged, which is what the mobile app will do.
    const client = createTalaClient({ baseUrl: dev.url, getToken: () => token, validateResponses: true });
    assert.equal((await client.call('auth.me')).user.email, 'dev@example.test');
    const pulled = await client.syncTransport.pull({});
    assert.equal(pulled.hasMore, false);

    // An oversized body is cut off by the kernel's limit, not buffered first.
    const tooBig = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'dev@example.test', password: 'x'.repeat(200_000) }),
    });
    assert.equal(tooBig.status, 400);
    assert.deepEqual(ApiError.parse(await tooBig.json()).error.details, { reason: 'body_too_large' });

    const missing = await fetch(`${dev.url}/not/the/api`);
    assert.equal(missing.status, 404);
    assert.equal(ApiError.parse(await missing.json()).error.code, 'not_found');
  } finally {
    await dev.close();
    t.close();
  }
});

test('createTalaServer: environment in, working server out, data kept across restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tala-server-'));
  const dbPath = join(dir, 'nested', 'tala.sqlite');
  const saved = { ...process.env };
  process.env.TALA_DB_PATH = dbPath;
  process.env.TALA_ENV = 'local';
  // The default logger writes JSON lines to stdout, which the test runner also uses for its own reports.
  process.env.TALA_LOG_LEVEL = 'silent';
  try {
    let server = createTalaServer({ limits: { pageSize: 7 } });
    assert.equal(server.config.dbPath, dbPath);
    assert.equal(server.config.limits.pageSize, 7);
    assert.equal(statSync(dbPath).mode & 0o777, 0o600, 'the database file is readable by its owner only');

    const post = (path: string, body: unknown) =>
      server.handle(new Request(`http://localhost:3000${API_BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    const registered = await post('/auth/register', { email: 'keep@example.test', password: 'kalabaw-bituin-ilog-27', displayName: 'Keep Me' });
    assert.equal(registered.status, 200);
    server.close();

    server = createTalaServer();
    const login = await post('/auth/login', { email: 'keep@example.test', password: 'kalabaw-bituin-ilog-27' });
    assert.equal(login.status, 200);
    server.close();

    // getTalaServer gives the same instance every time, so a hot reload does not open the database twice.
    const shared = getTalaServer();
    assert.equal(getTalaServer(), shared);
    shared.close();
  } finally {
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the full module registry starts together and every core route has a handler', () => {
  const server = createServer({ config: loadConfig({}, { dbPath: ':memory:' }), modules, logSink: () => {} });
  try {
    const implemented = new Set(server.implemented());
    const coreRoutes = ROUTE_NAMES.filter((name) => /^(config|auth|account|sync)\./.test(name) || name === 'plans.revisions' || name === 'plans.revision');
    assert.ok(coreRoutes.length >= 20);
    for (const name of coreRoutes) assert.ok(implemented.has(name), `${name} has no handler`);
    // Migrations of every module ran against one database without clashing.
    const applied = server.db.prepare('SELECT count(*) AS n FROM kernel_migrations').get() as { n: number };
    assert.ok(applied.n >= 2);
  } finally {
    server.close();
  }
});
