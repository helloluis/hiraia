/**
 * Typed API client used by web and mobile. No retries here: callers own the retry/backoff schedule (RES-4).
 * OWNER: orchestrator.
 */
import { API, API_BASE, buildPath } from './api';
import type { BodyIn, ParamsOf, QueryIn, ResponseOf, RouteName } from './api';
import { ApiError } from './common';
import type { ApiErrorCode } from './common';
import type { SyncTransport } from './sync';

export class TalaApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode | 'network' | 'timeout' | 'bad_response',
    message: string,
    public readonly status: number | null = null,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'TalaApiError';
  }
  /** True when retrying later may succeed (offline, timeout, 5xx, rate limit). */
  get retryable(): boolean {
    return ['network', 'timeout', 'unavailable', 'rate_limited', 'internal'].includes(this.code);
  }
}

export interface ClientOptions {
  /** Origin, e.g. 'https://tala.hiraia.org'. Empty string for same-origin web. */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Bearer token for mobile; return null to rely on cookies (web). */
  getToken?: () => string | null | Promise<string | null>;
  timeoutMs?: number;
  /** Validate responses against the contract (on in development and tests). */
  validateResponses?: boolean;
}

type HasKeys<T> = [keyof T] extends [never] ? false : true;
type Args<K extends RouteName> = (HasKeys<ParamsOf<K>> extends true ? { params: ParamsOf<K> } : { params?: undefined }) &
  (BodyIn<K> extends undefined ? { body?: undefined } : { body: BodyIn<K> }) &
  (QueryIn<K> extends undefined ? { query?: undefined } : { query?: QueryIn<K> }) & { signal?: AbortSignal };

type MaybeArgs<K extends RouteName> = {} extends Args<K> ? [args?: Args<K>] : [args: Args<K>];

export interface TalaClient {
  call<K extends RouteName>(name: K, ...args: MaybeArgs<K>): Promise<ResponseOf<K>>;
  /** Adapter for the sync engine. */
  syncTransport: SyncTransport;
}

export function createTalaClient(opts: ClientOptions): TalaClient {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  async function call<K extends RouteName>(name: K, ...rest: MaybeArgs<K>): Promise<ResponseOf<K>> {
    const spec = API[name];
    const args = (rest[0] ?? {}) as { params?: Record<string, string>; body?: unknown; query?: Record<string, unknown>; signal?: AbortSignal };
    let url = opts.baseUrl.replace(/\/$/, '') + API_BASE + buildPath(spec.path, args.params);
    if (args.query) {
      const qs = Object.entries(args.query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) url += `?${qs}`;
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = opts.getToken ? await opts.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    let bodyText: string | undefined;
    if (args.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyText = JSON.stringify(args.body);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    args.signal?.addEventListener('abort', onAbort);
    let res: Response;
    try {
      res = await doFetch(url, { method: spec.method, headers, body: bodyText, signal: ctrl.signal, credentials: 'include' });
    } catch (err) {
      const aborted = ctrl.signal.aborted && !args.signal?.aborted;
      throw new TalaApiError(aborted ? 'timeout' : 'network', aborted ? 'The request took too long.' : 'No connection.', null, err);
    } finally {
      clearTimeout(timer);
      args.signal?.removeEventListener('abort', onAbort);
    }

    if (!res.ok) {
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        /* not JSON */
      }
      const e = ApiError.safeParse(parsed);
      if (e.success) throw new TalaApiError(e.data.error.code, e.data.error.message, res.status, e.data.error.details);
      throw new TalaApiError(res.status >= 500 ? 'unavailable' : 'bad_response', `Request failed (${res.status}).`, res.status);
    }

    if ('binary' in spec && spec.binary) return (await res.arrayBuffer()) as ResponseOf<K>;
    let json: unknown;
    try {
      json = await res.json();
    } catch (err) {
      throw new TalaApiError('bad_response', 'The server sent an unreadable reply.', res.status, err);
    }
    if (opts.validateResponses) {
      const out = spec.response.safeParse(json);
      if (!out.success) throw new TalaApiError('bad_response', `Response for ${name} does not match the contract.`, res.status, out.error.issues);
      return out.data as ResponseOf<K>;
    }
    return json as ResponseOf<K>;
  }

  return {
    call,
    syncTransport: {
      push: (body) => call('sync.push', { body }),
      pull: (query) => call('sync.pull', { query }),
    },
  };
}
