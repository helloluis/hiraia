/**
 * Test helper for every server module.
 * OWNER: workstream A. See ./README.md for a worked example.
 *
 *   const t = createTestServer({ modules: [myModule] });
 *   const teacher = await t.registerUser();
 *   const res = await t.call('community.search', { query: { grade: '4' }, token: teacher.token });
 *   assert.equal(res.ok, true);
 *   t.close();
 *
 * What you get: a real kernel on an in-memory database (fresh per call), the core module already loaded
 * (so sign-up, sessions and the record store work), a clock you control, cheap password hashing, a
 * captured mail outbox and captured logs. Nothing touches the network or the disk.
 */
import { API, API_BASE, buildPath, createTalaClient } from '@hiraia/tala-core';
import type {
  ApiErrorCode,
  BodyIn,
  Id,
  ParamsOf,
  QueryIn,
  ResponseOf,
  RouteName,
  TalaClient,
  User,
} from '@hiraia/tala-core';
import { loadConfig } from '../kernel/config';
import type { DeepPartial } from '../kernel/config';
import type { Db } from '../kernel/db';
import type { LogEntry } from '../kernel/logger';
import { createServer } from '../kernel/server';
import type { KernelServer } from '../kernel/server';
import type { ServerModule, Services, TalaServerConfig } from '../kernel/types';
import { createCoreModule } from '../modules/core';
import type { CoreOptions } from '../modules/core';
import { readOutbox } from '../modules/core/mailer';
import type { MailTemplate, OutboxMail } from '../modules/core/mailer';
import { TEST_ARGON2_COST } from '../modules/core/passwords';

export { createFakeLlm } from './llm';
export type { FakeLlm, FakeLlmAnswer, FakeLlmCall, FakeLlmOptions } from './llm';

/* ---------------- clock ---------------- */

export interface Duration {
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  ms?: number;
}

export interface TestClock {
  now(): Date;
  set(to: Date | string | number): void;
  /** Move time forward (or back, with negative values). A bare number is milliseconds. */
  advance(by: number | Duration): void;
}

/** Monday 16 November 2026, 08:00 in Manila. Fixed so tests do not depend on the day they run. */
export const DEFAULT_TEST_TIME = '2026-11-16T00:00:00.000Z';

export function createTestClock(start: Date | string | number = DEFAULT_TEST_TIME): TestClock {
  let t = new Date(start).getTime();
  if (Number.isNaN(t)) throw new Error('createTestClock: not a valid date');
  return {
    now: () => new Date(t),
    set(to) {
      const next = new Date(to).getTime();
      if (Number.isNaN(next)) throw new Error('clock.set: not a valid date');
      t = next;
    },
    advance(by) {
      const d: Duration = typeof by === 'number' ? { ms: by } : by;
      t +=
        (d.days ?? 0) * 86_400_000 +
        (d.hours ?? 0) * 3_600_000 +
        (d.minutes ?? 0) * 60_000 +
        (d.seconds ?? 0) * 1_000 +
        (d.ms ?? 0);
    },
  };
}

/* ---------------- typed calls ---------------- */

type HasKeys<T> = [keyof T] extends [never] ? false : true;

export interface CallExtras {
  /** Bearer token (how the mobile app authenticates). */
  token?: string | null;
  /** Raw Cookie header value (how the web app authenticates), e.g. `user.cookie`. */
  cookie?: string | null;
  headers?: Record<string, string>;
  /** Client address as the kernel would see it, for rate-limit tests. */
  ip?: string | null;
}

export type CallArgs<K extends RouteName> = (HasKeys<ParamsOf<K>> extends true
  ? { params: ParamsOf<K> }
  : { params?: undefined }) &
  (BodyIn<K> extends undefined ? { body?: undefined } : { body: BodyIn<K> }) &
  (QueryIn<K> extends undefined ? { query?: undefined } : { query?: QueryIn<K> }) &
  CallExtras;

export type MaybeCallArgs<K extends RouteName> =
  {} extends CallArgs<K> ? [args?: CallArgs<K>] : [args: CallArgs<K>];

export interface ApiFailure {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

export type CallResult<K extends RouteName> =
  | { ok: true; status: number; data: ResponseOf<K>; error: null; headers: Headers }
  | { ok: false; status: number; data: null; error: ApiFailure; headers: Headers };

export interface RawRequest extends CallExtras {
  body?: unknown;
  /** Send this exact text as the body instead of JSON-encoding `body`. */
  rawBody?: string;
}

/* ---------------- users ---------------- */

export interface RegisterOptions {
  email?: string;
  password?: string;
  displayName?: string;
  uiLanguage?: 'fil' | 'en';
  deviceLabel?: string;
  /** Confirm the email through the real emailed link. Default true, because most features need it. */
  verified?: boolean;
}

export interface TestUser {
  user: User;
  id: Id;
  email: string;
  password: string;
  /** Bearer token of the session created at sign-up. */
  token: string;
  /** The same session as a Cookie header value. */
  cookie: string;
}

/* ---------------- server ---------------- */

export interface TestServerOptions {
  /** Modules to load in addition to core. Pass your own module here. */
  modules?: ServerModule[];
  /** Configuration overrides, merged deeply over the local defaults. */
  config?: DeepPartial<TalaServerConfig>;
  /** Replace services, e.g. `{ llm: myFakeGateway }`. Wins over what modules provide. */
  services?: Partial<Services>;
  /** Start time of the clock. */
  now?: Date | string | number;
  /** Options for the core module (rarely needed). */
  core?: CoreOptions;
  /** Leave the core module out (kernel-only tests). `registerUser` will not work. */
  withoutCore?: boolean;
  /** Do not print unexpected server errors to stderr (they are still collected in `errors`). */
  quiet?: boolean;
  newId?: () => Id;
  trustedProxyHops?: number;
}

export interface TestServer {
  server: KernelServer;
  db: Db;
  config: TalaServerConfig;
  services: Services;
  clock: TestClock;
  /** Call a route by name. Never throws for an API error: check `ok`. */
  call<K extends RouteName>(route: K, ...args: MaybeCallArgs<K>): Promise<CallResult<K>>;
  /** Call a route and return its data; throws a readable error if the call did not succeed. */
  ok<K extends RouteName>(route: K, ...args: MaybeCallArgs<K>): Promise<ResponseOf<K>>;
  /** The real typed client from @hiraia/tala-core, wired to this server. Throws TalaApiError on failure. */
  client(token?: string | null): TalaClient;
  /** A raw request, for malformed input and header tests. `path` is under /api/v1 unless it starts with it. */
  request(method: string, path: string, init?: RawRequest): Promise<Response>;
  registerUser(options?: RegisterOptions): Promise<TestUser>;
  /** Mail written to the dev outbox, newest first. */
  outbox(): OutboxMail[];
  /** The token from the newest mail of that kind sent to that address, or null. */
  mailToken(email: string, template: MailTemplate): string | null;
  /** Every log entry written so far. */
  logs: LogEntry[];
  /** Errors behind unexpected 500 responses, with their stacks. */
  errors: unknown[];
  close(): void;
}

const TEST_ORIGIN = 'http://tala.test';

/** Abuse limits high enough that ordinary tests never meet them. Override in `config.abuse` to test a limit. */
const RELAXED_ABUSE = {
  registerPerIpPerHour: 100_000,
  loginPerIpPerMinute: 100_000,
  postPerUserPerDay: 100_000,
  reportPerUserPerDay: 100_000,
};

export function tokenFromMail(mail: OutboxMail): string | null {
  const m = /#token=([A-Za-z0-9_%-]+)/.exec(mail.vars.link ?? mail.body);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function createTestServer(options: TestServerOptions = {}): TestServer {
  const clock = createTestClock(options.now);
  const logs: LogEntry[] = [];
  const errors: unknown[] = [];

  const base: DeepPartial<TalaServerConfig> = {
    dbPath: ':memory:',
    publicOrigin: TEST_ORIGIN,
    abuse: RELAXED_ABUSE,
  };
  const config = loadConfig(
    { TALA_ENV: 'local' },
    { ...base, ...options.config, abuse: { ...RELAXED_ABUSE, ...options.config?.abuse } }
  );

  const extra = options.modules ?? [];
  const modules: ServerModule[] =
    options.withoutCore || extra.some((m) => m.name === 'core')
      ? [...extra]
      : [
          // Explicit, so a variable in the developer's shell cannot change what a test sees.
          createCoreModule({
            argon2: TEST_ARGON2_COST,
            autoVerifyEmail: false,
            buildId: '',
            ...options.core,
          }),
          ...extra,
        ];

  const server = createServer({
    config,
    modules,
    services: options.services,
    now: clock.now,
    newId: options.newId,
    logSink: (entry) => logs.push(entry),
    trustedProxyHops: options.trustedProxyHops ?? 0,
    onInternalError(error, info) {
      errors.push(error);
      if (!options.quiet) {
        const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
        process.stderr.write(
          `[tala test server] unexpected error in ${info.route ?? 'unmatched route'}:\n${detail}\n`
        );
      }
    },
  });

  let userCounter = 0;

  function toRequest(
    method: string,
    path: string,
    init: RawRequest = {}
  ): { request: Request; ip: string | null | undefined } {
    const url = TEST_ORIGIN + (path.startsWith(API_BASE) ? path : API_BASE + path);
    const headers = new Headers(init.headers);
    if (init.token) headers.set('authorization', `Bearer ${init.token}`);
    if (init.cookie) headers.set('cookie', init.cookie);
    let body: string | undefined;
    if (init.rawBody !== undefined) body = init.rawBody;
    else if (init.body !== undefined) {
      body = JSON.stringify(init.body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
    return { request: new Request(url, { method, headers, body }), ip: init.ip };
  }

  async function request(method: string, path: string, init?: RawRequest): Promise<Response> {
    const { request: req, ip } = toRequest(method, path, init);
    const response = await server.handle(req, { ip });
    // Work queued for "after the response" (mail, mostly) has finished before the test looks at anything.
    await server.idle();
    return response;
  }

  async function call<K extends RouteName>(
    route: K,
    ...rest: MaybeCallArgs<K>
  ): Promise<CallResult<K>> {
    const spec = API[route];
    const args = (rest[0] ?? {}) as CallExtras & {
      params?: Record<string, string>;
      query?: Record<string, unknown>;
      body?: unknown;
    };
    let path = buildPath(spec.path, args.params);
    if (args.query) {
      const qs = Object.entries(args.query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) path += `?${qs}`;
    }
    const response = await request(spec.method, path, {
      token: args.token,
      cookie: args.cookie,
      headers: args.headers,
      ip: args.ip,
      body: args.body,
    });
    if (response.ok) {
      const data = (
        'binary' in spec && spec.binary ? await response.arrayBuffer() : await response.json()
      ) as ResponseOf<K>;
      return { ok: true, status: response.status, data, error: null, headers: response.headers };
    }
    const parsed = (await response.json().catch(() => null)) as { error?: ApiFailure } | null;
    const error: ApiFailure = parsed?.error ?? {
      code: 'internal',
      message: `Unreadable error body (HTTP ${response.status}).`,
    };
    return { ok: false, status: response.status, data: null, error, headers: response.headers };
  }

  async function ok<K extends RouteName>(
    route: K,
    ...rest: MaybeCallArgs<K>
  ): Promise<ResponseOf<K>> {
    const result = await call(route, ...rest);
    if (!result.ok) {
      throw new Error(
        `${route} failed: ${result.status} ${result.error.code}: ${result.error.message} ${result.error.details ? JSON.stringify(result.error.details) : ''}`
      );
    }
    return result.data;
  }

  function client(token?: string | null): TalaClient {
    return createTalaClient({
      baseUrl: TEST_ORIGIN,
      getToken: () => token ?? null,
      validateResponses: true,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await server.handle(new Request(input, init));
        await server.idle();
        return response;
      }) as typeof fetch,
    });
  }

  const outbox = () => readOutbox(server.db, 500);

  function mailToken(email: string, template: MailTemplate): string | null {
    const mail = outbox().find(
      (m) => m.to.toLowerCase() === email.toLowerCase() && m.template === template
    );
    return mail ? tokenFromMail(mail) : null;
  }

  async function registerUser(opts: RegisterOptions = {}): Promise<TestUser> {
    if (options.withoutCore)
      throw new Error(
        'registerUser needs the core module; this test server was created with withoutCore.'
      );
    const n = ++userCounter;
    const email = opts.email ?? `teacher${n}@example.test`;
    const password = opts.password ?? `Tala-test-${n}-kalabaw-bituin`;
    const registered = await ok('auth.register', {
      body: {
        email,
        password,
        displayName: opts.displayName ?? `Teacher ${n}`,
        uiLanguage: opts.uiLanguage ?? 'fil',
        deviceLabel: opts.deviceLabel ?? 'Test device',
      },
      // A different address per user, so the per-address sign-up limit never gets in a test's way.
      ip: `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`,
    });
    let user = registered.user;
    // Already confirmed when the server runs the auto-verify stop-gap: there is no mail to follow then.
    if (opts.verified !== false && !user.emailVerified) {
      const token = mailToken(email, 'verify_email');
      if (!token) throw new Error('registerUser: no verification mail found in the outbox.');
      await ok('auth.verifyEmail', { body: { token } });
      user = (await ok('auth.me', { token: registered.token })).user;
    }
    return {
      user,
      id: user.id,
      email,
      password,
      token: registered.token,
      cookie: `${config.session.cookieName}=${registered.token}`,
    };
  }

  return {
    server,
    db: server.db,
    config,
    services: server.services,
    clock,
    call,
    ok,
    client,
    request,
    registerUser,
    outbox,
    mailToken,
    logs,
    errors,
    close: () => server.close(),
  };
}
