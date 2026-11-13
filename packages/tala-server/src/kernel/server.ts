/**
 * The kernel runtime: createTalaServer() → { handle(Request) → Response, close(), config }.
 * OWNER: workstream A.
 *
 * Request path, in order:
 *   route match (API table) → handler lookup (501 if none) → cross-site check → authenticate →
 *   read + validate params/query/body (zod) → handler → validate response against the contract → respond.
 * Every non-2xx body is an `ApiError`. Nothing from a request (path, query, headers, body) is ever logged:
 * only the route NAME, status, duration and the internal user id.
 */
import { randomUUID } from 'node:crypto';
import type { Id, RouteName } from '@hiraia/tala-core';
import { attachEffects, extractCredentials, isCrossSite, kernelExtension, registerAccountHooks } from './auth';
import type { AuthFailure, Authenticator, RequestEffects } from './auth';
import { loadConfigWithWarnings } from './config';
import type { DeepPartial } from './config';
import { openDatabase, runMigrations } from './db';
import type { Db } from './db';
import {
  MESSAGES,
  binaryResponse,
  bodyLimitFor,
  clientAddress,
  errorResponse,
  jsonResponse,
  parseJsonBody,
  queryToObject,
  readBodyText,
  summariseIssues,
} from './http';
import { createLogger, describeError, stdoutSink } from './logger';
import type { LogSink } from './logger';
import { compileRoutes, matchRoute } from './router';
import { createDefaultServices } from './services';
import { HttpError } from './types';
import type { BaseDeps, BinaryResponse, Ctx, Logger, ServerModule, Services, SessionUser, TalaServerConfig } from './types';

export interface TalaServer {
  /**
   * Serve one request. `info.ip` is the peer address when the adapter knows it (the dev server does);
   * otherwise the kernel derives it from X-Forwarded-For according to the trusted proxy setting.
   */
  handle(request: Request, info?: { ip?: string | null }): Promise<Response>;
  close(): void;
  config: TalaServerConfig;
}

/** Extra surface for tests, the dev server and tools. Not part of the public contract. */
export interface KernelServer extends TalaServer {
  db: Db;
  services: Services;
  log: Logger;
  /** Resolves when all work queued to run after responses has finished. */
  idle(): Promise<void>;
  /** Route names that have a handler. */
  implemented(): RouteName[];
}

export interface KernelOptions {
  config: TalaServerConfig;
  modules: ServerModule[];
  /** Replace services outright (tests: a fake llm, a fake curriculum). Wins over anything a module provides. */
  services?: Partial<Services>;
  now?: () => Date;
  newId?: () => Id;
  /** Use this connection instead of opening `config.dbPath`. The kernel still closes it. */
  db?: Db;
  logSink?: LogSink;
  /** Number of reverse proxies whose X-Forwarded-For entry is trusted. 0 = ignore the header. */
  trustedProxyHops?: number;
  /** Called with the original error whenever a request ends in an unexpected 500. Tests use it to show the stack. */
  onInternalError?: (error: unknown, info: { route: RouteName | null; requestId: string }) => void;
  /** Messages for the operator from config loading, logged once at startup. */
  startupWarnings?: string[];
}

type AnyHandler = (ctx: Ctx, input: { params: Record<string, string>; query: unknown; body: unknown }) => unknown;

const AUTH_FAILURE_MESSAGE: Record<AuthFailure, string> = {
  unknown: MESSAGES.unauthenticated,
  expired: 'You have been signed out because this device was not used for a long time. Please sign in again.',
  revoked: 'You were signed out on this device. Please sign in again.',
  account_deleted: 'This account was deleted.',
  account_merged: 'This account was joined with your other account. Please sign in to that one.',
};

function isBinaryResult(value: unknown): value is BinaryResponse {
  return typeof value === 'object' && value !== null && (value as BinaryResponse).binary instanceof Uint8Array;
}

export function createServer(options: KernelOptions): KernelServer {
  const { config, modules } = options;
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? (() => randomUUID());
  const sink = options.logSink ?? stdoutSink;
  const log = createLogger({ sink, now });
  const trustedProxyHops = options.trustedProxyHops ?? 0;
  const useHsts = config.publicOrigin.startsWith('https://');

  const names = new Set<string>();
  for (const m of modules) {
    if (names.has(m.name)) throw new Error(`Module "${m.name}" is registered twice.`);
    names.add(m.name);
  }

  const db = options.db ?? openDatabase(config.dbPath);
  let closed = false;
  const stops: Array<() => void> = [];
  const background = new Set<Promise<void>>();

  try {
    runMigrations(db, modules, now, log);
  } catch (err) {
    db.close();
    throw err;
  }

  const base: BaseDeps = { db, config, now, newId, log };

  /* ---- services: kernel defaults ← each module in registry order ← explicit overrides ---- */
  const services: Services = createDefaultServices(base);
  const provider = new Map<string, string>();
  for (const m of modules) {
    if (!m.services) continue;
    const provided = m.services(base);
    for (const [key, value] of Object.entries(provided)) {
      if (value === undefined) continue;
      const earlier = provider.get(key);
      if (earlier) log.warn('service_replaced', { service: key, module: m.name, replaces: earlier });
      provider.set(key, m.name);
      (services as unknown as Record<string, unknown>)[key] = value;
    }
  }
  for (const [key, value] of Object.entries(options.services ?? {})) {
    if (value !== undefined) (services as unknown as Record<string, unknown>)[key] = value;
  }

  /* ---- handlers: one module per route ---- */
  const routes = compileRoutes();
  const handlers = new Map<RouteName, { handler: AnyHandler; module: string }>();
  for (const m of modules) {
    for (const [name, handler] of Object.entries(m.handlers)) {
      if (typeof handler !== 'function') continue;
      const routeName = name as RouteName;
      const existing = handlers.get(routeName);
      if (existing) throw new Error(`Route "${name}" has two handlers: modules "${existing.module}" and "${m.name}".`);
      if (!routes.some((r) => r.name === routeName)) throw new Error(`Module "${m.name}" has a handler for "${name}", which is not in the API table.`);
      handlers.set(routeName, { handler: handler as AnyHandler, module: m.name });
    }
  }

  /* ---- authenticator: at most one module provides it ---- */
  let authenticator: Authenticator | null = null;
  for (const m of modules) {
    const make = kernelExtension(m).authenticator;
    if (!make) continue;
    if (authenticator) throw new Error(`Two modules provide an authenticator; "${m.name}" is the second.`);
    authenticator = make({ ...base, services });
  }

  registerAccountHooks(
    db,
    modules.flatMap((m) => {
      // The contract field, or the older kernel-private spelling of the same thing. Never both: a module that
      // sets the two to one function is called once.
      const hook = m.onAccountDeleted ?? kernelExtension(m).onAccountDeleted;
      const merge = m.onAccountMerged ?? kernelExtension(m).onAccountMerged;
      if (!hook) return [];
      return [{ module: m.name, run: (userId: Id) => hook(base, userId), ...(merge ? { merge: (from: Id, to: Id) => merge(base, from, to) } : {}) }];
    }),
  );

  for (const warning of options.startupWarnings ?? []) log.warn('config_warning', { note: warning });
  log.info('server_started', { environment: config.environment, modules: modules.length, routes: handlers.size });

  /* ---- background work declared by modules ---- */
  for (const m of modules) {
    if (!m.start) continue;
    const stop = m.start({ ...base, services });
    if (typeof stop === 'function') stops.push(stop);
  }

  function track(task: () => Promise<void> | void, event: string, requestId: string): void {
    const promise = (async () => {
      try {
        await task();
      } catch (err) {
        log.error(event, { requestId, ...describeError(err) });
      }
    })();
    background.add(promise);
    void promise.finally(() => background.delete(promise));
  }

  async function dispatch(
    request: Request,
    requestId: string,
    info: { ip?: string | null } | undefined,
    seen: { route: RouteName | null; userId: string | null },
  ): Promise<Response> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return errorResponse('not_found', MESSAGES.notFound, requestId);
    }

    const match = matchRoute(routes, request.method.toUpperCase(), url.pathname);
    if (match.kind === 'not_found') return errorResponse('not_found', MESSAGES.notFound, requestId);
    if (match.kind === 'bad_path') return errorResponse('invalid_input', MESSAGES.invalid, requestId, { details: { reason: 'bad_path' } });
    if (match.kind === 'method_not_allowed') {
      return errorResponse('not_found', MESSAGES.methodNotAllowed, requestId, { status: 405, headers: { allow: match.allow.join(', ') } });
    }

    const { route, params } = match;
    const spec = route.spec;
    seen.route = route.name;

    const entry = handlers.get(route.name);
    if (!entry) return errorResponse('not_implemented', MESSAGES.notImplemented, requestId, { details: { route: route.name } });

    if (isCrossSite(request, config)) return errorResponse('forbidden', MESSAGES.crossSite, requestId, { details: { reason: 'cross_site' } });

    /* authenticate */
    const credentials = extractCredentials(request, config.session.cookieName);
    let user: SessionUser | null = null;
    let failure: AuthFailure = 'unknown';
    if (credentials && authenticator) {
      const outcome = authenticator.authenticate(credentials.token, credentials.via);
      if (outcome.user) user = outcome.user;
      else failure = outcome.reason;
    }
    if (spec.auth === 'user' && !user) {
      return errorResponse('unauthenticated', AUTH_FAILURE_MESSAGE[failure], requestId, { details: { reason: credentials ? failure : 'no_credentials' } });
    }
    seen.userId = user?.id ?? null;

    /* input */
    let query: unknown = undefined;
    if (spec.query) {
      const parsed = spec.query.safeParse(queryToObject(url.searchParams));
      if (!parsed.success) {
        return errorResponse('invalid_input', MESSAGES.invalid, requestId, { details: { issues: summariseIssues('query', parsed.error.issues) } });
      }
      query = parsed.data;
    }
    let body: unknown = undefined;
    if (spec.body) {
      const text = await readBodyText(request, bodyLimitFor(route.name, spec.auth));
      const json = parseJsonBody(text, request.headers.get('content-type'));
      const parsed = spec.body.safeParse(json === undefined ? {} : json);
      if (!parsed.success) {
        return errorResponse('invalid_input', MESSAGES.invalid, requestId, { details: { issues: summariseIssues('body', parsed.error.issues) } });
      }
      body = parsed.data;
    }

    /* handler */
    const effects: RequestEffects = {
      cookies: [],
      after: [],
      credentials,
      userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
    };
    const ctx: Ctx = {
      user,
      db,
      services,
      config,
      now,
      newId,
      requestId,
      ip: clientAddress(request, trustedProxyHops, info?.ip),
      log: createLogger({ sink, now, base: { requestId, route: route.name } }),
    };
    attachEffects(ctx, effects);

    let result: unknown;
    try {
      result = await entry.handler(ctx, { params, query, body });
    } catch (err) {
      // Cookies set before the failure (for example a cleared session) still apply.
      if (err instanceof HttpError) {
        return errorResponse(err.code, err.message, requestId, { details: err.details, cookies: effects.cookies });
      }
      throw err;
    } finally {
      for (const task of effects.after.splice(0)) track(task, 'after_response_failed', requestId);
    }

    if (spec.binary) {
      if (!isBinaryResult(result)) throw new Error(`Route ${route.name} is binary but its handler did not return a BinaryResponse.`);
      return binaryResponse(result, requestId);
    }
    // Only what the contract names leaves the server: unknown keys are stripped, a wrong shape is a 500.
    const checked = spec.response.safeParse(result);
    if (!checked.success) {
      log.error('response_contract_violation', {
        requestId,
        route: route.name,
        module: entry.module,
        where: checked.error.issues
          .slice(0, 5)
          .map((i) => i.path.join('.'))
          .join(' | '),
      });
      throw new Error(`Response for ${route.name} does not match the contract: ${checked.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    return jsonResponse(200, checked.data, requestId, effects.cookies);
  }

  async function handle(request: Request, info?: { ip?: string | null }): Promise<Response> {
    const requestId = randomUUID();
    const started = performance.now();
    const seen: { route: RouteName | null; userId: string | null } = { route: null, userId: null };
    let response: Response;
    if (closed) {
      response = errorResponse('unavailable', MESSAGES.closed, requestId);
    } else {
      try {
        response = await dispatch(request, requestId, info, seen);
      } catch (err) {
        if (err instanceof HttpError) {
          response = errorResponse(err.code, err.message, requestId, { details: err.details });
        } else {
          log.error('request_failed', { requestId, route: seen.route, ...describeError(err) });
          try {
            options.onInternalError?.(err, { route: seen.route, requestId });
          } catch {
            /* a reporting hook must not break the response */
          }
          response = errorResponse('internal', MESSAGES.internal, requestId);
        }
      }
    }
    // TLS only, once a browser has seen the site over https (PRD §14.4).
    if (useHsts) response.headers.set('strict-transport-security', 'max-age=15552000');
    log.info('http_request', {
      requestId,
      method: request.method,
      route: seen.route ?? 'unmatched',
      status: response.status,
      ms: Math.round(performance.now() - started),
      userId: seen.userId,
    });
    return response;
  }

  return {
    handle,
    config,
    db,
    services,
    log,
    async idle() {
      while (background.size > 0) await Promise.allSettled([...background]);
    },
    implemented: () => [...handlers.keys()],
    close() {
      if (closed) return;
      closed = true;
      for (const stop of stops.reverse()) {
        try {
          stop();
        } catch (err) {
          log.error('module_stop_failed', describeError(err));
        }
      }
      try {
        db.close();
      } catch {
        /* already closed */
      }
    },
  };
}

function trustedHopsFromEnv(env: Record<string, string | undefined>, environment: TalaServerConfig['environment']): number {
  const raw = env.TALA_TRUSTED_PROXY_HOPS?.trim();
  if (raw === undefined || raw === '') return environment === 'local' ? 0 : 1;
  if (!/^\d$/.test(raw)) throw new Error('TALA_TRUSTED_PROXY_HOPS must be a number from 0 to 9.');
  return Number(raw);
}

const LOG_LEVELS = ['info', 'warn', 'error', 'silent'] as const;

/** TALA_LOG_LEVEL: info (default), warn, error, or silent. Lines below the level are not written. */
function sinkFromEnv(env: Record<string, string | undefined>): LogSink {
  const raw = env.TALA_LOG_LEVEL?.trim().toLowerCase() || 'info';
  const level = LOG_LEVELS.indexOf(raw as (typeof LOG_LEVELS)[number]);
  if (level === -1) throw new Error(`TALA_LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}.`);
  if (level === 0) return stdoutSink;
  return (entry) => {
    if (LOG_LEVELS.indexOf(entry.level) >= level) stdoutSink(entry);
  };
}

/** Build a server from the environment and an explicit module list. `createTalaServer` in ../index.ts supplies the registry. */
export function createServerFromEnv(modules: ServerModule[], overrides?: DeepPartial<TalaServerConfig>, env: Record<string, string | undefined> = process.env): KernelServer {
  const { config, warnings } = loadConfigWithWarnings(env, overrides);
  return createServer({
    config,
    modules,
    logSink: sinkFromEnv(env),
    trustedProxyHops: trustedHopsFromEnv(env, config.environment),
    startupWarnings: warnings,
  });
}
