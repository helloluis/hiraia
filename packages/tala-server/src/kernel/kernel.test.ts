import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ApiError } from '@hiraia/tala-core';
import { createTestServer } from '../testing';
import { ConfigError, loadConfig, loadConfigWithWarnings, routeEnvName } from './config';
import { MigrationError, openDatabase, runMigrations } from './db';
import { normaliseAddress } from './http';
import { createLogger, isSensitiveKey } from './logger';
import type { LogEntry } from './logger';
import { createServer } from './server';
import { HttpError } from './types';
import type { ServerModule } from './types';

/** A module that answers a few routes owned by other workstreams, to exercise the kernel on its own. */
function probeModule(
  seen: { input?: unknown; started?: boolean; stopped?: boolean } = {}
): ServerModule {
  return {
    name: 'probe',
    migrations: [
      { id: 'probe:001_init', sql: 'CREATE TABLE probe_items (id TEXT PRIMARY KEY) STRICT;' },
    ],
    handlers: {
      'calendar.presets': () => ({ presets: [] }),
      'community.report': (ctx, input) => {
        seen.input = { user: ctx.user?.id ?? null, ...input };
        return { ok: true as const };
      },
      'community.remove': () => {
        throw new HttpError('locked', 'This lesson is locked.', { reason: 'probe' });
      },
      'community.get': () => {
        throw new Error('secret detail that must not leak: hunter2-hunter2');
      },
      // Returns more than the contract allows, and something that is not the contract at all for /checks.
      'curriculum.index': () =>
        ({ learningAreas: [], packs: [], internalNote: 'do not send' }) as never,
      'curriculum.checkSummary': () => ({ nope: true }) as never,
      'print.planPdf': (_ctx, { query }) => ({
        binary: new Uint8Array([0x25, 0x50, 0x44, 0x46, query.images ? 1 : 0]),
        contentType: 'application/pdf',
        filename: 'plan "one".pdf',
      }),
    },
    start: () => {
      seen.started = true;
      return () => {
        seen.stopped = true;
      };
    },
  };
}

async function errorOf(response: Response) {
  const parsed = ApiError.parse(await response.json());
  return parsed.error;
}

test('unknown paths and methods answer with a uniform error body', async () => {
  const t = createTestServer({ withoutCore: true, modules: [probeModule()] });
  const missing = await t.request('GET', '/nothing/here');
  assert.equal(missing.status, 404);
  assert.equal((await errorOf(missing)).code, 'not_found');

  const outside = await t.server.handle(new Request('http://tala.test/somewhere/else'));
  assert.equal(outside.status, 404);
  assert.equal((await errorOf(outside)).code, 'not_found');

  const wrongMethod = await t.request('DELETE', '/calendar/presets');
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'GET');
  assert.equal((await errorOf(wrongMethod)).code, 'not_found');

  const trailing = await t.request('GET', '/calendar/presets/');
  assert.equal(trailing.status, 200);
  assert.equal(trailing.headers.get('cache-control'), 'no-store');
  assert.equal(trailing.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(trailing.headers.get('x-request-id'));
  t.close();
});

test('a route in the table with no handler answers not_implemented', async () => {
  const t = createTestServer({ withoutCore: true });
  const res = await t.call('curriculum.pack', { params: { packId: 'matatag-2024:4:science' } });
  assert.equal(res.status, 501);
  assert.equal(res.error?.code, 'not_implemented');
  assert.ok(res.error!.message.length > 0);
  t.close();
});

test('routes that need a user reject anonymous requests before the handler runs', async () => {
  const seen: { input?: unknown } = {};
  const t = createTestServer({ withoutCore: true, modules: [probeModule(seen)] });
  const res = await t.call('community.report', {
    params: { artifactId: 'artifact-0001' },
    body: { reason: 'spam' },
  });
  assert.equal(res.status, 401);
  assert.equal(res.error?.code, 'unauthenticated');
  assert.deepEqual(res.error?.details, { reason: 'no_credentials' });
  assert.equal(seen.input, undefined);
  t.close();
});

test('params, query and body are validated and defaults applied', async () => {
  const seen: { input?: { user: string | null; params: unknown; body: unknown } } = {};
  const t = createTestServer({ modules: [probeModule(seen)] });
  const teacher = await t.registerUser();

  const good = await t.call('community.report', {
    params: { artifactId: 'artifact-0001' },
    body: { reason: 'spam' },
    token: teacher.token,
  });
  assert.equal(good.ok, true);
  assert.deepEqual(seen.input, {
    user: teacher.id,
    params: { artifactId: 'artifact-0001' },
    query: undefined,
    body: { reason: 'spam', note: '' },
  });

  const bad = await t.call('community.report', {
    params: { artifactId: 'artifact-0001' },
    body: { reason: 'because' as never },
    token: teacher.token,
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.error?.code, 'invalid_input');
  const issues = (bad.error?.details as { issues: Array<{ path: string; message: string }> })
    .issues;
  assert.equal(issues[0]?.path, 'body.reason');

  const notJson = await t.request('POST', '/community/artifacts/artifact-0001/report', {
    token: teacher.token,
    rawBody: '{"reason":"spam"}',
    headers: { 'content-type': 'text/plain' },
  });
  assert.equal(notJson.status, 400);

  const broken = await t.request('POST', '/community/artifacts/artifact-0001/report', {
    token: teacher.token,
    rawBody: '{"reason": "my-secret-roster-text',
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(broken.status, 400);
  const brokenText = JSON.stringify(await broken.json());
  assert.ok(
    !brokenText.includes('my-secret-roster-text'),
    'the parser error must not quote the input'
  );

  const huge = await t.request('POST', '/community/artifacts/artifact-0001/report', {
    token: teacher.token,
    rawBody: JSON.stringify({ reason: 'spam', note: 'x'.repeat(2 * 1024 * 1024) }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(huge.status, 400);
  assert.deepEqual((await errorOf(huge)).details, { reason: 'body_too_large' });

  const badEscape = await t.request('GET', '/community/artifacts/%E0%A4%A', {
    token: teacher.token,
  });
  assert.equal(badEscape.status, 400);

  const pdf = await t.call('print.planPdf', {
    params: { planId: 'plan-00001' },
    query: { images: false },
    token: teacher.token,
  });
  assert.equal(pdf.ok, true);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.headers.get('content-disposition'), 'attachment; filename="plan_one_.pdf"');
  assert.deepEqual([...new Uint8Array(pdf.data as ArrayBuffer)], [0x25, 0x50, 0x44, 0x46, 0]);
  t.close();
});

test('handler errors: HttpError maps to its status, anything else is a plain 500 that leaks nothing', async () => {
  const t = createTestServer({ modules: [probeModule()], quiet: true });
  const teacher = await t.registerUser();

  const locked = await t.call('community.remove', {
    params: { artifactId: 'artifact-0001' },
    token: teacher.token,
  });
  assert.equal(locked.status, 423);
  assert.deepEqual(locked.error, {
    code: 'locked',
    message: 'This lesson is locked.',
    details: { reason: 'probe' },
  });

  const boom = await t.call('community.get', {
    params: { artifactId: 'artifact-0001' },
    token: teacher.token,
  });
  assert.equal(boom.status, 500);
  assert.equal(boom.error?.code, 'internal');
  assert.ok(!JSON.stringify(boom.error).includes('hunter2'));
  assert.ok(!JSON.stringify(t.logs).includes('hunter2'), 'error messages are not logged');
  assert.equal(t.errors.length, 1);
  assert.ok(t.logs.some((l) => l.event === 'request_failed' && l.fields.errorName === 'Error'));
  t.close();
});

test('responses are checked against the contract: extra keys stripped, wrong shapes refused', async () => {
  const t = createTestServer({ modules: [probeModule()], quiet: true });
  const teacher = await t.registerUser();
  const index = await t.request('GET', '/curriculum/index');
  assert.deepEqual(await index.json(), { learningAreas: [], packs: [] });

  const wrong = await t.call('curriculum.checkSummary', {
    params: { packId: 'p:4:science' },
    token: teacher.token,
  });
  assert.equal(wrong.status, 500);
  assert.ok(
    t.logs.some((l) => l.event === 'response_contract_violation' && l.fields.module === 'probe')
  );
  t.close();
});

test('state-changing requests from another site are refused', async () => {
  const t = createTestServer({ modules: [probeModule()] });
  const teacher = await t.registerUser();
  const init = {
    params: { artifactId: 'artifact-0001' },
    body: { reason: 'spam' as const },
    cookie: teacher.cookie,
  };
  assert.equal(
    (await t.call('community.report', { ...init, headers: { origin: 'https://evil.example' } }))
      .status,
    403
  );
  assert.equal(
    (await t.call('community.report', { ...init, headers: { 'sec-fetch-site': 'cross-site' } }))
      .status,
    403
  );
  assert.equal(
    (await t.call('community.report', { ...init, headers: { origin: 'http://tala.test' } })).status,
    200
  );
  assert.equal((await t.call('community.report', init)).status, 200);
  // A read is not blocked: nothing changes and the other site cannot see the answer.
  assert.equal(
    (await t.call('calendar.presets', { headers: { origin: 'https://evil.example' } })).status,
    200
  );
  t.close();
});

test('services: defaults, module-provided, explicit overrides; start and stop run', async () => {
  const seen: { started?: boolean; stopped?: boolean } = {};
  const withService: ServerModule = {
    name: 'svc',
    migrations: [],
    handlers: {},
    services: () => ({
      curriculum: { getCompetencies: () => [], versionFor: () => 'from-module' },
    }),
  };
  const t = createTestServer({ withoutCore: true, modules: [probeModule(seen), withService] });
  assert.deepEqual(await t.services.llm.complete({} as never), {
    ok: false,
    reason: 'disabled',
    message: 'AI help is not available right now.',
  });
  assert.equal(t.services.llm.routeFor('lesson.generate'), 'off');
  assert.equal(t.services.curriculum.versionFor('2027-2028', '4', 'science'), 'from-module');
  assert.throws(() => t.services.records.list('user-0001', 'plan'), /not available/);
  assert.equal(seen.started, true);
  t.close();
  assert.equal(seen.stopped, true);
  const afterClose = await t.server.handle(new Request('http://tala.test/api/v1/calendar/presets'));
  assert.equal(afterClose.status, 503);

  const overridden = createTestServer({
    withoutCore: true,
    modules: [withService],
    services: { curriculum: { getCompetencies: () => [], versionFor: () => 'from-test' } },
  });
  assert.equal(overridden.services.curriculum.versionFor('2027-2028', '4', 'science'), 'from-test');
  overridden.close();
});

test('module wiring mistakes fail at startup', () => {
  const config = loadConfig({}, { dbPath: ':memory:' });
  const quiet = { config, logSink: () => {} };
  const a: ServerModule = {
    name: 'a',
    migrations: [],
    handlers: { 'calendar.presets': () => ({ presets: [] }) },
  };
  const b: ServerModule = {
    name: 'b',
    migrations: [],
    handlers: { 'calendar.presets': () => ({ presets: [] }) },
  };
  assert.throws(() => createServer({ ...quiet, modules: [a, b] }), /two handlers/);
  assert.throws(() => createServer({ ...quiet, modules: [a, a] }), /registered twice/);
  const unknown = {
    name: 'c',
    migrations: [],
    handlers: { 'no.such.route': () => ({}) },
  } as unknown as ServerModule;
  assert.throws(() => createServer({ ...quiet, modules: [unknown] }), /not in the API table/);
});

test('migrations: applied once, in order, recorded; edits and bad ids are refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tala-migrations-'));
  const path = join(dir, 'db.sqlite');
  const now = () => new Date('2026-11-16T00:00:00.000Z');
  try {
    const first = {
      name: 'm',
      migrations: [{ id: 'm:001_init', sql: 'CREATE TABLE m_a (id TEXT PRIMARY KEY);' }],
    };
    let db = openDatabase(path);
    assert.deepEqual(runMigrations(db, [first], now), ['m:001_init']);
    assert.deepEqual(runMigrations(db, [first], now), []);
    db.close();

    db = openDatabase(path);
    const second = {
      name: 'm',
      migrations: [
        ...first.migrations,
        { id: 'm:002_more', sql: 'CREATE TABLE m_b (id TEXT PRIMARY KEY);' },
      ],
    };
    assert.deepEqual(runMigrations(db, [second], now), ['m:002_more']);
    const recorded = db.prepare('SELECT id, module FROM kernel_migrations ORDER BY id').all();
    assert.deepEqual(recorded, [
      { id: 'm:001_init', module: 'm' },
      { id: 'm:002_more', module: 'm' },
    ]);

    const edited = {
      name: 'm',
      migrations: [
        { id: 'm:001_init', sql: 'CREATE TABLE m_a (id TEXT PRIMARY KEY, extra TEXT);' },
      ],
    };
    assert.throws(() => runMigrations(db, [edited], now), MigrationError);

    // A failing migration leaves nothing behind: its statements and its record roll back together.
    const failing = {
      name: 'f',
      migrations: [
        { id: 'f:001_bad', sql: 'CREATE TABLE f_ok (id TEXT); CREATE TABLE f_ok (id TEXT);' },
      ],
    };
    assert.throws(() => runMigrations(db, [failing], now), MigrationError);
    assert.equal(
      (
        db.prepare(`SELECT count(*) AS n FROM sqlite_master WHERE name = 'f_ok'`).get() as {
          n: number;
        }
      ).n,
      0
    );
    db.close();

    const mem = openDatabase(':memory:');
    assert.throws(
      () =>
        runMigrations(
          mem,
          [{ name: 'x', migrations: [{ id: 'x:1_short', sql: 'SELECT 1' }] }],
          now
        ),
      /must look like/
    );
    assert.throws(
      () =>
        runMigrations(
          mem,
          [{ name: 'x', migrations: [{ id: 'y:001_other', sql: 'SELECT 1' }] }],
          now
        ),
      /must start with "x:"/
    );
    assert.throws(
      () =>
        runMigrations(
          mem,
          [
            {
              name: 'x',
              migrations: [
                { id: 'x:002_b', sql: 'SELECT 1' },
                { id: 'x:001_a', sql: 'SELECT 1' },
              ],
            },
          ],
          now
        ),
      /out of order/
    );
    mem.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('config: safe local defaults, environment rules, deep overrides, names but never values in errors', () => {
  const local = loadConfig({});
  assert.equal(local.environment, 'local');
  assert.equal(local.llm.primary.apiKeyEnv, 'DEEPSEEK_API_KEY');
  assert.equal(local.llm.fallback.apiKeyEnv, 'DASHSCOPE_API_KEY');
  assert.equal(local.llm.routes['roster.names'], 'cloud');
  assert.equal(local.llm.local, null);
  assert.equal(local.features.googleSignIn, false);
  assert.ok(local.session.ttlDays > 30, 'a session must outlive 30 days offline (OFF-5)');
  assert.ok(Object.isFrozen(local) && Object.isFrozen(local.llm.routes));

  assert.equal(
    loadConfig({ ALIBABACLOUD_API_KEY: 'x' }).llm.fallback.apiKeyEnv,
    'ALIBABACLOUD_API_KEY'
  );
  assert.equal(
    loadConfig({ TALA_ROSTER_LLM_ROUTE: 'rules' }).llm.routes['roster.columns'],
    'rules'
  );
  assert.equal(
    loadConfig({ [routeEnvName('lesson.generate')]: 'off' }).llm.routes['lesson.generate'],
    'off'
  );
  assert.deepEqual(
    loadConfig({ TALA_PROMPT_VERSIONS: 'lesson/multigrade=3, roster/names=2' }).llm.promptVersions,
    { 'lesson/multigrade': 3, 'roster/names': 2 }
  );

  const merged = loadConfig({}, { limits: { pageSize: 5 }, llm: { quotas: { fullPerDay: 1 } } });
  assert.equal(merged.limits.pageSize, 5);
  assert.equal(merged.limits.rosterRows, local.limits.rosterRows);
  assert.equal(merged.llm.quotas.fullPerDay, 1);
  assert.equal(merged.llm.quotas.sectionPerDay, local.llm.quotas.sectionPerDay);

  // Production: learners' names never go to a cloud model, whatever the variable says (§12.4.1).
  const prodEnv = { TALA_ENV: 'production', TALA_DB_PATH: '/var/lib/tala/tala.sqlite' };
  const prod = loadConfigWithWarnings({ ...prodEnv, TALA_ROSTER_LLM_ROUTE: 'cloud' });
  assert.equal(prod.config.llm.routes['roster.names'], 'rules');
  assert.equal(prod.config.llm.routes['roster.columns'], 'rules');
  assert.ok(prod.warnings.some((w) => w.includes('not allowed in production')));
  assert.equal(prod.config.publicOrigin, 'https://tala.hiraia.org');
  assert.equal(prod.config.session.cookieName, '__Host-tala_session');
  const prodLocal = loadConfig({
    ...prodEnv,
    TALA_LLM_LOCAL_ENDPOINT: 'http://127.0.0.1:8080/v1',
    TALA_LLM_LOCAL_MODEL: 'local-model',
  });
  assert.equal(prodLocal.llm.routes['roster.names'], 'local');
  assert.equal(
    loadConfigWithWarnings(prodEnv, { llm: { routes: { 'roster.names': 'cloud' } } }).config.llm
      .routes['roster.names'],
    'rules'
  );
  assert.equal(loadConfig(prodEnv).llm.routes['lesson.generate'], 'cloud');

  assert.throws(() => loadConfig({ TALA_ENV: 'production' }), /TALA_DB_PATH is required/);
  assert.throws(
    () => loadConfig({ TALA_ENV: 'staging', TALA_DB_PATH: '/x/y.sqlite' }),
    /TALA_PUBLIC_ORIGIN is required/
  );
  assert.throws(() => loadConfig({ ...prodEnv, TALA_SESSION_TTL_DAYS: '7' }), /at least 31/);
  assert.throws(
    () => loadConfig({ ...prodEnv, TALA_PUBLIC_ORIGIN: 'http://tala.hiraia.org' }),
    /https/
  );
  assert.throws(() => loadConfig({ TALA_ENV: 'prod' }), ConfigError);
  try {
    loadConfig({ TALA_PAGE_SIZE: 'forty-two-secret' });
    assert.fail('expected a ConfigError');
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    assert.ok(err.message.includes('TALA_PAGE_SIZE'));
    assert.ok(!err.message.includes('forty-two-secret'));
  }
});

test('logger: primitives only, sensitive names redacted, long text cut, event names constrained', () => {
  const entries: LogEntry[] = [];
  const log = createLogger({
    sink: (e) => entries.push(e),
    now: () => new Date('2026-11-16T00:00:00.000Z'),
  });
  log.info('thing_happened', {
    userId: 'user-0001',
    count: 3,
    password: 'hunter2-hunter2',
    sessionToken: 'abc',
    Authorization: 'Bearer abc',
    email: 'a@b.test',
    planBody: 'the whole lesson',
    note: 'x'.repeat(500),
    nested: { a: 1 } as never,
    list: [1, 2] as never,
    multi: 'line one\nline two',
  });
  log.warn('an event name with spaces and "content"');
  const [first, second] = entries;
  assert.deepEqual(first!.fields, {
    userId: 'user-0001',
    count: 3,
    password: '[redacted]',
    sessionToken: '[redacted]',
    Authorization: '[redacted]',
    email: '[redacted]',
    planBody: '[redacted]',
    note: `${'x'.repeat(200)}…`,
    multi: 'line one line two',
  });
  assert.equal(second!.event, 'invalid_event_name');
  for (const key of [
    'apiKey',
    'api_key',
    'set-cookie',
    'studentName',
    'rosterText',
    'promptText',
    'modelOutput',
    'client_secret',
  ]) {
    assert.equal(isSensitiveKey(key), true, key);
  }
  for (const key of [
    'route',
    'status',
    'ms',
    'userId',
    'requestId',
    'module',
    'migration',
    'errorName',
  ]) {
    assert.equal(isSensitiveKey(key), false, key);
  }
});

test('request logging records the route name and outcome, never the path, query or headers', async () => {
  const t = createTestServer({ modules: [probeModule()], quiet: true });
  const teacher = await t.registerUser();
  t.logs.length = 0;
  await t.request('GET', '/community/artifacts/SECRET-PATH-VALUE?q=SECRET-QUERY', {
    token: teacher.token,
    headers: { 'x-custom': 'SECRET-HEADER' },
  });
  const text = JSON.stringify(t.logs);
  assert.ok(text.includes('"route":"community.get"'));
  for (const secret of ['SECRET-PATH-VALUE', 'SECRET-QUERY', 'SECRET-HEADER', teacher.token])
    assert.ok(!text.includes(secret), secret);
  t.close();
});

test('client address: forwarding headers are ignored unless a proxy is trusted', async () => {
  assert.equal(normaliseAddress('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(normaliseAddress('203.0.113.9:4431'), '203.0.113.9');
  assert.equal(normaliseAddress('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(normaliseAddress('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(normaliseAddress('not an address'), null);

  const ips: Array<string | null> = [];
  const spy: ServerModule = {
    name: 'spy',
    migrations: [],
    handlers: {
      'calendar.presets': (ctx) => {
        ips.push(ctx.ip);
        return { presets: [] };
      },
    },
  };
  const forwarded = { headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.7' } };
  const untrusting = createTestServer({ withoutCore: true, modules: [spy] });
  await untrusting.call('calendar.presets', forwarded);
  await untrusting.call('calendar.presets', { ...forwarded, ip: '192.0.2.44' });
  untrusting.close();
  const trusting = createTestServer({ withoutCore: true, modules: [spy], trustedProxyHops: 1 });
  await trusting.call('calendar.presets', forwarded);
  trusting.close();
  assert.deepEqual(ips, [null, '192.0.2.44', '203.0.113.7']);
});

test('https sites send Strict-Transport-Security; plain-http development does not', async () => {
  const secure = createTestServer({
    withoutCore: true,
    modules: [probeModule()],
    config: {
      publicOrigin: 'https://tala.hiraia.org',
      session: { cookieName: '__Host-tala_session' },
    },
  });
  const plain = createTestServer({ withoutCore: true, modules: [probeModule()] });
  assert.equal(
    (await secure.call('calendar.presets')).headers.get('strict-transport-security'),
    'max-age=15552000'
  );
  assert.equal(
    (await secure.request('GET', '/nothing')).headers.get('strict-transport-security'),
    'max-age=15552000',
    'on errors too'
  );
  assert.equal(
    (await plain.call('calendar.presets')).headers.get('strict-transport-security'),
    null
  );
  secure.close();
  plain.close();
});

test('request ceiling: one client cannot hammer the server; the liveness route is never throttled', async () => {
  let at = new Date('2026-11-16T00:00:00.000Z');
  const health: ServerModule = {
    name: 'health',
    migrations: [],
    handlers: {
      'calendar.presets': () => ({ presets: [] }),
      'system.health': () => ({
        ok: true as const,
        version: 'test',
        environment: 'local',
        time: at.toISOString(),
      }),
    },
  };
  const entries: LogEntry[] = [];
  const server = createServer({
    config: loadConfig({}, { dbPath: ':memory:' }),
    modules: [health],
    logSink: (e) => entries.push(e),
    now: () => at,
    requestsPerMinute: 3,
    trustedProxyHops: 1,
  });
  const get = (path: string, forwardedFor?: string) =>
    server.handle(
      new Request(`http://tala.test/api/v1${path}`, {
        headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
      })
    );

  for (let i = 0; i < 3; i++)
    assert.equal((await get('/calendar/presets', '203.0.113.5')).status, 200);
  const over = await get('/calendar/presets', '203.0.113.5');
  assert.equal(over.status, 429);
  assert.equal(over.headers.get('retry-after'), '30');
  assert.deepEqual((await over.json()).error.details, {
    reason: 'rate_limited',
    retryAfterSeconds: 30,
  });
  assert.equal(
    (await get('/calendar/presets', '203.0.113.6')).status,
    200,
    'another visitor is unaffected'
  );
  for (let i = 0; i < 20; i++)
    assert.equal((await get('/health', '203.0.113.5')).status, 200, 'health is exempt');
  at = new Date(at.getTime() + 61_000);
  assert.equal((await get('/calendar/presets', '203.0.113.5')).status, 200, 'the minute passes');

  // No forwarding header although a proxy is expected: said once, with counts only, and such visitors
  // share one much wider bucket instead of being locked out together.
  assert.ok(!entries.some((e) => e.event === 'client_address_unknown'));
  for (let i = 0; i < 100; i++) assert.equal((await get('/calendar/presets')).status, 200);
  const warnings = entries.filter((e) => e.event === 'client_address_unknown');
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0]!.fields, { trustedProxyHops: 1, forwardedEntries: 0 });
  assert.ok(!JSON.stringify(entries).includes('203.0.113'), 'addresses are never logged');
  server.close();

  // Off unless asked for: a test server has no ceiling.
  const t = createTestServer({ withoutCore: true, modules: [health] });
  for (let i = 0; i < 50; i++)
    assert.equal((await t.call('calendar.presets', { ip: '203.0.113.5' })).status, 200);
  t.close();
});
