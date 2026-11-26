/**
 * Production boot check. The server is started the way the web app starts it in production,
 * `createTalaServer()` reading the environment, with the real module registry and the settings of the
 * public deployment: TALA_ENV=production behind Cloudflare and nginx, a SQLite file outside the repository,
 * Google sign-in off, no local model, the two cloud model keys present by name, no mail transport.
 *
 * Nothing here leaves the machine: the model endpoints are pointed at a closed local port, and the checks
 * that involve the model stop before any provider would be called.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { API_BASE, parseRecordData } from '@hiraia/tala-core';
import type { GenerationJob } from '@hiraia/tala-core';
import { createTalaServer } from '../index';
import type { TalaServer } from '../index';
import { loadConfigWithWarnings } from '../kernel/config';
import type { Db } from '../kernel/db';

const PUBLIC_ORIGIN = 'https://tala.hiraia.org';
/** What nginx hands the app: the app's own loopback address, not the public one. */
const INTERNAL = 'http://127.0.0.1:3005';
const CLOUDFLARE_EDGE = '172.70.1.9';
const GOOD_PASSWORD = 'kalabaw-bituin-ilog-27';

/** Variable prefixes this server reads. Anything the developer's shell holds under them is set aside. */
const OURS = /^(TALA_|GOOGLE_OAUTH_|DEEPSEEK_|DASHSCOPE_|ALIBABACLOUD_)/;

let dir: string;
let saved: Record<string, string | undefined> = {};
let server: TalaServer & { db?: Db };
const logLines: Array<{ level: string; event: string; [k: string]: unknown }> = [];
let restoreStdout: () => void = () => {};

/** The production environment, names and all. The key values are placeholders, not credentials. */
function productionEnv(dbPath: string): Record<string, string> {
  return {
    TALA_ENV: 'production',
    TALA_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
    TALA_DB_PATH: dbPath,
    TALA_TRUSTED_PROXY_HOPS: '2',
    TALA_AUTH_AUTO_VERIFY: '1',
    TALA_BUILD_ID: 'bootcheck',
    TALA_LOG_LEVEL: 'warn',
    DEEPSEEK_API_KEY: 'placeholder-not-a-key',
    DASHSCOPE_API_KEY: 'placeholder-not-a-key',
    TALA_LLM_PRIMARY_MODEL: 'placeholder-primary-model',
    TALA_LLM_FALLBACK_MODEL: 'placeholder-fallback-model',
    // A closed local port: if anything did try to reach a model, it would fail here and go nowhere.
    TALA_LLM_PRIMARY_BASE_URL: 'http://127.0.0.1:9/v1',
    TALA_LLM_FALLBACK_BASE_URL: 'http://127.0.0.1:9/v1',
    TALA_LLM_PRIMARY_INPUT_USD_PER_MILLION: '1',
    TALA_LLM_PRIMARY_OUTPUT_USD_PER_MILLION: '2',
    TALA_LLM_FALLBACK_INPUT_USD_PER_MILLION: '1',
    TALA_LLM_FALLBACK_OUTPUT_USD_PER_MILLION: '2',
    TALA_QUOTA_FULL_PER_DAY: '3',
    TALA_QUOTA_SECTION_PER_DAY: '7',
    TALA_BUDGET_MONTHLY_USD: '25',
    TALA_BUDGET_ALERT_USD: '20',
  };
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'tala-production-'));
  for (const name of Object.keys(process.env)) {
    if (OURS.test(name)) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  }
  Object.assign(process.env, productionEnv(join(dir, 'data', 'tala.sqlite')));

  // The server logs JSON lines to stdout, which the test runner also uses. Take our own lines aside (to
  // assert on them) and pass everything else through untouched.
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = typeof chunk === 'string' ? chunk : '';
    if (text.startsWith('{"ts":')) {
      for (const line of text.split('\n').filter(Boolean))
        logLines.push(JSON.parse(line) as (typeof logLines)[number]);
      return true;
    }
    return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  restoreStdout = () => {
    process.stdout.write = write;
  };

  server = createTalaServer();
});

after(() => {
  server?.close();
  restoreStdout();
  for (const name of Object.keys(process.env)) if (OURS.test(name)) delete process.env[name];
  for (const [name, value] of Object.entries(saved))
    if (value !== undefined) process.env[name] = value;
  saved = {};
  rmSync(dir, { recursive: true, force: true });
});

interface Sent {
  body?: unknown;
  token?: string;
  cookie?: string;
  origin?: string;
  /** The address Cloudflare saw the request come from. */
  client?: string;
  /** Whatever the client itself put in X-Forwarded-For before Cloudflare. */
  clientSentForwardedFor?: string;
  headers?: Record<string, string>;
}

let clientCounter = 0;
/** A different visitor each time, unless a test pins one. */
const nextClient = () => `198.18.${(++clientCounter >> 8) & 255}.${clientCounter & 255}`;

/** A request as it reaches the app in production: through Cloudflare, then nginx, on the app's loopback URL. */
async function send(method: string, path: string, sent: Sent = {}) {
  const headers = new Headers(sent.headers);
  const client = sent.client ?? nextClient();
  // Cloudflare appends the visitor's address to whatever the visitor sent; nginx appends Cloudflare's.
  headers.set(
    'x-forwarded-for',
    [sent.clientSentForwardedFor, client, CLOUDFLARE_EDGE].filter(Boolean).join(', ')
  );
  if (sent.token) headers.set('authorization', `Bearer ${sent.token}`);
  if (sent.cookie) headers.set('cookie', sent.cookie);
  if (sent.origin) headers.set('origin', sent.origin);
  let body: string | undefined;
  if (sent.body !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(sent.body);
  }
  const response = await server.handle(
    new Request(`${INTERNAL}${API_BASE}${path}`, { method, headers, body })
  );
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  const error = json.error as
    | { code: string; message: string; details?: Record<string, unknown> }
    | undefined;
  return {
    status: response.status,
    json,
    error,
    reason: error?.details?.reason,
    headers: response.headers,
  };
}

let teacherCounter = 0;
async function signUp(sent: Sent = {}) {
  const email = `teacher${++teacherCounter}@example.test`;
  const res = await send('POST', '/auth/register', {
    ...sent,
    body: { email, password: GOOD_PASSWORD, displayName: `Guro ${teacherCounter}` },
  });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const user = res.json.user as { id: string; emailVerified: boolean };
  return {
    email,
    id: user.id,
    user,
    token: res.json.token as string,
    cookie: res.headers.getSetCookie()[0]!,
  };
}

const database = () => (server as unknown as { db: Db }).db;

test('it boots in production, on a private database file outside the repository', async () => {
  assert.equal(server.config.environment, 'production');
  assert.equal(server.config.publicOrigin, PUBLIC_ORIGIN);
  assert.equal(server.config.dbPath, join(dir, 'data', 'tala.sqlite'));
  assert.equal(
    statSync(server.config.dbPath).mode & 0o777,
    0o600,
    'the database is readable by its owner only'
  );
  assert.equal(statSync(join(dir, 'data')).mode & 0o777, 0o700);
  assert.equal(database().pragma('journal_mode', { simple: true }), 'wal');

  const health = await send('GET', '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(
    [health.json.ok, health.json.environment, health.json.version],
    [true, 'production', '0.1.0+bootcheck']
  );
  assert.equal(health.headers.get('strict-transport-security'), 'max-age=15552000');
  assert.equal(health.headers.get('cache-control'), 'no-store');

  // Every route in the contract has a handler: nothing answers "not implemented" for want of a module.
  const implemented = (server as unknown as { implemented(): string[] }).implemented();
  const { ROUTE_NAMES } = await import('@hiraia/tala-core');
  assert.deepEqual(
    ROUTE_NAMES.filter((name) => !implemented.includes(name)),
    []
  );
});

test('what the server says at start: the stop-gap is on, and nothing is misconfigured', () => {
  const events = logLines.map((l) => l.event);
  assert.ok(events.includes('auth_auto_verify_on'), 'the auto-verify stop-gap announces itself');
  assert.equal(
    logLines.find((l) => l.event === 'auth_auto_verify_on')?.setting,
    'TALA_AUTH_AUTO_VERIFY'
  );
  for (const unexpected of [
    'config_warning',
    'google_sign_in_not_configured',
    'mail_transport_missing',
    'service_replaced',
  ]) {
    assert.ok(!events.includes(unexpected), `unexpected startup log: ${unexpected}`);
  }
  assert.ok(
    !logLines.some((l) => l.level === 'error'),
    JSON.stringify(logLines.filter((l) => l.level === 'error'))
  );
  // No value of any setting is ever printed.
  const text = JSON.stringify(logLines);
  for (const value of Object.values(productionEnv('x')).filter((v) => v.length > 8))
    assert.ok(!text.includes(value), value);
});

test('client configuration: Google off, mail off, roster cleaning on rules', async () => {
  const config = (await send('GET', '/config')).json as {
    environment: string;
    features: Record<string, boolean>;
    rosterLlmRoute: string;
    limits: Record<string, number>;
  };
  assert.equal(config.environment, 'production');
  assert.deepEqual(config.features, {
    generation: true,
    community: true,
    rosterAi: true,
    googleSignIn: false,
    emailDelivery: false,
  });
  assert.equal(
    config.rosterLlmRoute,
    'rules',
    'learners’ names never go to a cloud model in production'
  );
  assert.equal(server.config.llm.routes['roster.names'], 'rules');
  assert.equal(server.config.llm.routes['roster.columns'], 'rules');
  assert.equal(server.config.llm.local, null);
  assert.equal(server.config.llm.routes['lesson.generate'], 'cloud');
  assert.equal(server.config.llm.primary.apiKeyEnv, 'DEEPSEEK_API_KEY');
  assert.equal(server.config.llm.fallback.apiKeyEnv, 'DASHSCOPE_API_KEY');

  // Asking for the cloud route in production is refused by the loader, with a warning for the operator.
  const forced = loadConfigWithWarnings({
    ...productionEnv(join(dir, 'other.sqlite')),
    TALA_ROSTER_LLM_ROUTE: 'cloud',
  });
  assert.equal(forced.config.llm.routes['roster.names'], 'rules');
  assert.ok(forced.warnings.some((w) => w.includes('not allowed in production')));

  assert.equal(
    (await send('POST', '/auth/google', { body: { idToken: 'a.b.c' } })).reason,
    'google_sign_in_not_available'
  );
});

test('curriculum: the real Science packs are served and the demo fixtures are not', async () => {
  const index = (await send('GET', '/curriculum/index')).json as {
    packs: Array<{
      packId: string;
      grade: string;
      learningAreaId: string;
      competencyCount: number;
    }>;
  };
  const science = index.packs.filter((p) => p.learningAreaId === 'science');
  assert.deepEqual(
    science.map((p) => p.grade).sort((a, b) => Number(a) - Number(b)),
    ['3', '4', '5', '6', '7', '8', '9', '10']
  );
  assert.ok(
    index.packs.every((p) => p.competencyCount > 0),
    'every listed pack has competencies'
  );
  // Fixture packs are identified by their ids, not by words that can legitimately occur in source text
  // ("demonstrate" in a quoted standard).
  assert.ok(
    index.packs.every((p) => !/^(fixture|demo)[-:.]/i.test(p.packId)),
    'no fixture pack is listed'
  );
  const areas = (index as unknown as { learningAreas: Array<{ id: string; name: { en: string } }> })
    .learningAreas;
  assert.ok(
    areas.every((a) => !/sample data|fixture/i.test(a.name.en) && !/^(fixture|demo)/i.test(a.id)),
    'no learning area is labelled as sample data'
  );

  const grade4 = science.find((p) => p.grade === '4')!;
  const pack = await send('GET', `/curriculum/packs/${encodeURIComponent(grade4.packId)}`);
  assert.equal(pack.status, 200);
  assert.equal((pack.json.competencies as unknown[]).length, grade4.competencyCount);
});

test('session cookie: Secure, HttpOnly, SameSite, host-only; and it signs the browser in', async () => {
  const teacher = await signUp({ origin: PUBLIC_ORIGIN });
  assert.match(
    teacher.cookie,
    /^__Host-tala_session=[A-Za-z0-9_-]{43}; Max-Age=777(?:6000|5999); Path=\/; HttpOnly; SameSite=Lax; Secure$/
  );
  assert.ok(!/Domain=/i.test(teacher.cookie), 'a __Host- cookie carries no Domain');
  const me = await send('GET', '/auth/me', { cookie: teacher.cookie.split(';')[0]! });
  assert.equal(me.status, 200);
  // With no mail transport and the stop-gap on, the new account can use the features that need a confirmed email.
  assert.equal((me.json.user as { emailVerified: boolean }).emailVerified, true);
});

test('cross-site check: the public origin is accepted, everything else is refused', async () => {
  const teacher = await signUp();
  const cookie = teacher.cookie.split(';')[0]!;
  // A harmless state-changing request made with the browser's cookie.
  const changeName = (extra: Sent) => send('POST', '/auth/verify-email/send', { cookie, ...extra });

  assert.equal((await changeName({ origin: PUBLIC_ORIGIN })).status, 200, 'the site itself');
  assert.equal((await changeName({})).status, 200, 'no Origin at all: the mobile app');
  for (const origin of [
    'https://evil.example',
    'http://tala.hiraia.org',
    'https://tala.hiraia.org.evil.example',
    'https://evil.tala.hiraia.org',
    'https://hiraia.org',
    'null',
  ]) {
    const res = await changeName({ origin });
    assert.equal(res.status, 403, origin);
    assert.equal(res.reason, 'cross_site', origin);
  }
  assert.equal((await changeName({ headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  // Sign-in itself cannot be driven from another site either.
  const foreignLogin = await send('POST', '/auth/login', {
    origin: 'https://evil.example',
    body: { email: teacher.email, password: GOOD_PASSWORD },
  });
  assert.equal(foreignLogin.status, 403);
  assert.equal(foreignLogin.headers.get('set-cookie'), null);
});

test('client address behind Cloudflare and nginx: the real visitor is limited, and a forged X-Forwarded-For changes nothing', async () => {
  const limit = server.config.abuse.loginPerIpPerMinute;
  const visitor = '203.0.113.77';
  const attempt = (n: number, sent: Sent) =>
    send('POST', '/auth/login', {
      ...sent,
      body: { email: `nobody${n}@example.test`, password: 'not-a-real-password-1' },
    });

  // One visitor, lying differently about their address on every request: still one visitor.
  for (let i = 0; i < limit; i++) {
    const res = await attempt(i, {
      client: visitor,
      clientSentForwardedFor: `10.9.${i}.1, 8.8.8.${i}`,
    });
    assert.equal(res.status, 401, `attempt ${i + 1} of ${limit}`);
  }
  const blocked = await attempt(999, { client: visitor, clientSentForwardedFor: '1.1.1.1' });
  assert.equal(blocked.status, 429, 'the visitor’s real address is what is counted');
  assert.equal(blocked.error?.code, 'rate_limited');

  // Another visitor is not affected, even when claiming the first visitor's address.
  assert.equal(
    (await attempt(1000, { client: '203.0.113.78', clientSentForwardedFor: visitor })).status,
    401
  );
});

test('one client cannot hammer the server: the request ceiling is on, and health checks are exempt', async () => {
  const visitor = '203.0.113.120';
  let last = 200;
  let served = 0;
  // The default ceiling is 600 a minute per signed-out address.
  for (let i = 0; i < 700 && last === 200; i++) {
    last = (await send('GET', '/config', { client: visitor })).status;
    if (last === 200) served++;
  }
  assert.equal(served, 600);
  assert.equal(last, 429);
  assert.equal(
    (await send('GET', '/health', { client: visitor })).status,
    200,
    'the supervisor can always ask'
  );
  assert.equal((await send('GET', '/config', { client: '203.0.113.121' })).status, 200);
  // The proxies delivered an address for every request in this file, so the mismatch warning never fired.
  assert.ok(!logLines.some((l) => l.event === 'client_address_unknown'));
});

test('abuse limits are active with their production defaults', async () => {
  assert.deepEqual(server.config.abuse, {
    registerPerIpPerHour: 60,
    loginPerIpPerMinute: 30,
    postPerUserPerDay: 20,
    reportPerUserPerDay: 20,
  });
  // Sign-up from one address stops at the limit; another address is unaffected.
  const visitor = '203.0.113.90';
  database().prepare('DELETE FROM core_rate_limits').run();
  for (let i = 0; i < server.config.abuse.registerPerIpPerHour; i++)
    await signUp({ client: visitor });
  const over = await send('POST', '/auth/register', {
    client: visitor,
    body: { email: 'one-too-many@example.test', password: GOOD_PASSWORD, displayName: 'X' },
  });
  assert.equal(over.status, 429);
  assert.equal(over.error?.code, 'rate_limited');
  await signUp({ client: '203.0.113.91' });
});

async function waitForJob(token: string, jobId: string): Promise<GenerationJob> {
  for (let i = 0; i < 400; i++) {
    const res = await send('GET', `/generation/jobs/${jobId}`, { token });
    const job = res.json as unknown as GenerationJob;
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the generation job did not finish');
}

const generationBody = () => ({
  kind: 'full',
  templateId: 'tpl.dlp.v1',
  language: 'en',
  subjectName: 'Science',
  learningAreaId: null,
  timeBudgetMinutes: 40,
  gradeGroups: [{ id: 'group-0001', grade: '4', learnerCount: 28 }],
  competencies: {},
  curriculumVersion: null,
  customObjectives: ['Describe the parts of a plant.'],
  classProfile: {},
});

test('generation limits come from the environment, and a teacher over quota is told so cleanly', async () => {
  assert.deepEqual(server.config.llm.quotas, { fullPerDay: 3, sectionPerDay: 7 });
  assert.deepEqual(server.config.llm.budget, { monthlyUsd: 25, alertAtUsd: 20 });
  assert.deepEqual(server.config.llm.primary.pricing, {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 2,
  });

  const teacher = await signUp();
  const allowance = (await send('GET', '/generation/allowance', { token: teacher.token })).json;
  assert.deepEqual(allowance, { fullRemainingToday: 3, sectionRemainingToday: 7, degraded: false });

  // The day's allowance is used up (recorded directly, so no model is involved in getting there).
  const day = new Date().toISOString().slice(0, 10);
  database()
    .prepare('INSERT INTO llm_quota (day, user_id, bucket, used) VALUES (?, ?, ?, ?)')
    .run(day, teacher.id, 'full', 3);
  assert.equal(
    (await send('GET', '/generation/allowance', { token: teacher.token })).json.fullRemainingToday,
    0
  );

  const created = await send('POST', '/generation/jobs', {
    token: teacher.token,
    body: generationBody(),
  });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const job = await waitForJob(teacher.token, created.json.id as string);
  assert.equal(job.status, 'failed');
  assert.equal(job.failure?.reason, 'quota_exceeded');
  assert.ok(job.failure!.message.length > 0);
  assert.equal(job.result, null);

  // Another teacher still has their own allowance.
  const other = await signUp();
  assert.equal(
    (await send('GET', '/generation/allowance', { token: other.token })).json.fullRemainingToday,
    3
  );
});

test('the monthly ceiling stops generation for everyone once it is reached', async () => {
  const teacher = await signUp();
  const day = new Date().toISOString().slice(0, 10);
  database()
    .prepare(
      'INSERT INTO llm_usage (day, month, user_id, feature, provider, input_tokens, output_tokens, cost) VALUES (?, ?, NULL, ?, ?, 0, 0, ?)'
    )
    .run(day, day.slice(0, 7), 'lesson.generate', 'deepseek', 25);
  try {
    assert.equal(
      (await send('GET', '/generation/allowance', { token: teacher.token })).json.degraded,
      true
    );
    const created = await send('POST', '/generation/jobs', {
      token: teacher.token,
      body: generationBody(),
    });
    const job = await waitForJob(teacher.token, created.json.id as string);
    assert.equal(job.status, 'failed');
    assert.equal(job.failure?.reason, 'budget_exceeded');
  } finally {
    database().prepare('DELETE FROM llm_usage WHERE cost = 25').run();
  }
});

test('roster import in production: allowed for the new account, and cleaned by rules even when AI is asked for', async () => {
  const teacher = await signUp();
  const klass = parseRecordData('class', {
    id: 'class-prod-0001',
    schoolYearId: 'sy-prod-0001',
    name: 'Baitang 4',
    gradeGroups: [{ id: 'gg-prod-0001', grade: '4' }],
  });
  const pushed = await send('POST', '/sync/push', {
    token: teacher.token,
    body: {
      deviceId: 'device-prod-1',
      mutations: [
        {
          mutationId: 'mutation-prod-0001',
          entity: 'class',
          id: klass.id,
          op: 'upsert',
          baseRev: 0,
          data: klass,
        },
      ],
    },
  });
  assert.equal(pushed.status, 200, JSON.stringify(pushed.json));

  const imported = await send('POST', '/roster/imports', {
    token: teacher.token,
    body: {
      classId: klass.id,
      filename: 'klase.txt',
      text: 'DELA CRUZ, Juan Miguel S.\nMacaraeg, Ana Liza',
      useAi: true,
      cloudFlagAcknowledged: true,
    },
  });
  assert.equal(imported.status, 200, JSON.stringify(imported.json));
  assert.equal(imported.json.route, 'rules');
  assert.equal(imported.json.aiUsed, false, 'no learner name goes to a cloud model in production');
  assert.equal((imported.json.rows as unknown[]).length, 2);
});
