/**
 * Request reading and response building for the kernel.
 * OWNER: workstream A.
 */
import { LIMITS } from '@hiraia/tala-core';
import type { ApiErrorCode, RouteName } from '@hiraia/tala-core';
import { HttpError, STATUS_BY_CODE } from './types';
import type { BinaryResponse } from './types';

/* ---------------- plain-language messages (SIMPLE-6, RES-9) ---------------- */

export const MESSAGES = {
  notFound: 'We could not find that.',
  methodNotAllowed: 'That address does not accept this kind of request.',
  notImplemented: 'This feature is not available yet.',
  unauthenticated: 'Please sign in again.',
  crossSite: 'This request came from another site, so it was not accepted.',
  tooManyRequests: 'Too many requests at once. Please wait a moment and try again.',
  tooLarge: 'That is too much to send at once. Try a smaller amount.',
  unreadable: 'We could not read what was sent. Please try again.',
  needJson: 'We could not read what was sent. Please try again.',
  invalid: 'Some of the details sent were not right. Please check them and try again.',
  internal: 'Something went wrong on our side. Your work is safe. Please try again in a moment.',
  closed: 'The service is restarting. Your work is safe. Please try again in a moment.',
} as const;

/* ---------------- body limits ---------------- */

const KB = 1024;
const MB = 1024 * KB;

/** Largest JSON body accepted per route. Anything bigger is refused before it is parsed. */
const BODY_LIMIT_BY_ROUTE: Partial<Record<RouteName, number>> = {
  'sync.push': 4 * MB,
  // base64 of the largest roster file plus the JSON around it
  'roster.import': Math.ceil((LIMITS.maxRosterFileBytes * 4) / 3) + 64 * KB,
};
const BODY_LIMIT_SIGNED_IN = 1 * MB;
const BODY_LIMIT_ANONYMOUS = 64 * KB;

export function bodyLimitFor(route: RouteName, auth: 'none' | 'user'): number {
  return (
    BODY_LIMIT_BY_ROUTE[route] ?? (auth === 'user' ? BODY_LIMIT_SIGNED_IN : BODY_LIMIT_ANONYMOUS)
  );
}

/** Read the body as text, refusing to buffer more than `limit` bytes. */
export async function readBodyText(request: Request, limit: number): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) {
    throw new HttpError('invalid_input', MESSAGES.tooLarge, { reason: 'body_too_large' });
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError('invalid_input', MESSAGES.tooLarge, { reason: 'body_too_large' });
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(all);
  } catch {
    throw new HttpError('invalid_input', MESSAGES.unreadable, { reason: 'not_utf8' });
  }
}

/**
 * Parse a JSON body. The parser's own error text is never passed on: it quotes the input,
 * which could be a password or a class list.
 */
export function parseJsonBody(text: string, contentType: string | null): unknown {
  if (text.trim() === '') return undefined;
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  // Requiring JSON also stops cross-site form posts, which cannot set this content type without a preflight.
  if (type !== 'application/json')
    throw new HttpError('invalid_input', MESSAGES.needJson, {
      reason: 'content_type_must_be_json',
    });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError('invalid_input', MESSAGES.unreadable, { reason: 'invalid_json' });
  }
}

/** First value wins for a repeated key. */
export function queryToObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of params) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

export interface IssueSummary {
  path: string;
  message: string;
}

/** Zod issues reduced to where and what; never the offending value. */
export function summariseIssues(
  where: 'body' | 'query',
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>
): IssueSummary[] {
  return issues
    .slice(0, 20)
    .map((issue) => ({ path: [where, ...issue.path].join('.'), message: issue.message }));
}

/* ---------------- responses ---------------- */

function baseHeaders(requestId: string): Headers {
  const headers = new Headers();
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-request-id', requestId);
  return headers;
}

export function jsonResponse(
  status: number,
  body: unknown,
  requestId: string,
  cookies: readonly string[] = []
): Response {
  const headers = baseHeaders(requestId);
  headers.set('content-type', 'application/json; charset=utf-8');
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

export function binaryResponse(result: BinaryResponse, requestId: string, gone?: AbortSignal): Response {
  const headers = baseHeaders(requestId);
  headers.set(
    'content-type',
    /^[\w.+-]+\/[\w.+-]+$/.test(result.contentType)
      ? result.contentType
      : 'application/octet-stream'
  );
  if (result.filename) {
    const safe = result.filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'download';
    headers.set('content-disposition', `attachment; filename="${safe}"`);
  }
  // Only a private, time-limited policy may replace the default: never a shared cache, never forever.
  if (result.cacheControl && /^private, max-age=\d{1,7}$/.test(result.cacheControl))
    headers.set('cache-control', result.cacheControl);
  if (result.held) {
    headers.set('content-length', String(result.held.pieces ? result.held.pieces.bytes : result.binary.length));
    return new Response(heldBody(result.binary, result.held, gone), { status: 200, headers });
  }
  // Copy into a fresh ArrayBuffer-backed view so the Response owns its bytes.
  return new Response(new Uint8Array(result.binary), { status: 200, headers });
}

/** Bytes of a counted answer handed to the connection at a time. */
const HELD_PIECE_BYTES = 64 * 1024;
/** How long a connection may go without asking for the next piece before the answer is let go. */
const HELD_STALL_MS = 30_000;

/**
 * The body of an answer its route keeps count of (`BinaryResponse.held`): pieces are made only as the connection
 * asks for them, each a copy, so what waits in the connection's own buffers is a piece and not the whole answer.
 */
function heldBody(binary: Uint8Array, held: NonNullable<BinaryResponse['held']>, gone?: AbortSignal): ReadableStream<Uint8Array> {
  const total = held.pieces ? held.pieces.bytes : binary.length;
  const stallMs = held.stallMs ?? HELD_STALL_MS;
  let bytes: Uint8Array | null = held.pieces ? null : binary;
  let at = 0;
  let over = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stalled: ReturnType<typeof setTimeout> | undefined;
  let onGone: (() => void) | undefined;
  const letGo = () => {
    if (over) return;
    over = true;
    bytes = null;
    clearTimeout(timer);
    clearTimeout(stalled);
    if (onGone) gone?.removeEventListener('abort', onGone);
    try {
      held.release();
    } catch {
      /* a route's bookkeeping must not break an answer */
    }
  };
  /** Let go and break the answer off: its room is free from this moment, whatever the connection does next. */
  const cut = (controller: ReadableStreamDefaultController<Uint8Array>, why: string) => {
    if (over) return;
    letGo();
    try {
      controller.error(new Error(why));
    } catch {
      /* the stream is already closed or broken off */
    }
  };
  const waitForNextPiece = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    clearTimeout(stalled);
    stalled = setTimeout(() => cut(controller, 'This download was not being taken and was stopped.'), stallMs);
    (stalled as { unref?: () => void }).unref?.();
  };
  /** The next piece: a copy cut from the block of memory, or what the source gives (perhaps later). Null at the end. */
  const next = (): Uint8Array | null | Promise<Uint8Array | null> => {
    if (held.pieces) return at >= total ? null : held.pieces.next();
    if (bytes === null || at >= total) return null;
    return bytes.slice(at, Math.min(total, at + HELD_PIECE_BYTES));
  };
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        if (total === 0) {
          letGo();
          controller.close();
          return;
        }
        // A client that left before its answer was ready (the job took a while): nothing is held for it.
        if (gone?.aborted) return cut(controller, 'The client has gone.');
        onGone = () => cut(controller, 'The client has gone.');
        gone?.addEventListener('abort', onGone, { once: true });
        timer = setTimeout(() => cut(controller, 'This download took too long and was stopped.'), held.withinMs);
        (timer as { unref?: () => void }).unref?.();
        waitForNextPiece(controller);
      },
      async pull(controller) {
        if (over) return;
        let piece: Uint8Array | null;
        try {
          const coming = next();
          if (coming instanceof Promise) {
            // The wait is on the source now, not on the connection: it is not a stall. (The source has its own
            // time limit, and `withinMs` still ends the whole answer.)
            clearTimeout(stalled);
            piece = await coming;
          } else piece = coming;
        } catch {
          piece = null;
        }
        // Let go while the piece was on its way (the client left, the time was up): nothing more is sent.
        if (over) return;
        // A source that ends early, or gives more than it said, is not sent on as if it were the whole answer.
        if (piece === null || piece.length === 0 || at + piece.length > total) {
          letGo();
          controller.error(new Error('This download could not be read to its end.'));
          return;
        }
        controller.enqueue(piece);
        at += piece.length;
        if (at >= total) {
          letGo();
          controller.close();
        } else waitForNextPiece(controller);
      },
      cancel() {
        letGo();
      },
    },
    // Nothing is made ahead of being asked for.
    { highWaterMark: 0 }
  );
}

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  requestId: string,
  options: {
    details?: unknown;
    status?: number;
    headers?: Record<string, string>;
    cookies?: readonly string[];
  } = {}
): Response {
  const body: { error: { code: ApiErrorCode; message: string; details?: unknown } } = {
    error: { code, message },
  };
  if (options.details !== undefined) body.error.details = options.details;
  const response = jsonResponse(
    options.status ?? STATUS_BY_CODE[code],
    body,
    requestId,
    options.cookies
  );
  for (const [k, v] of Object.entries(options.headers ?? {})) response.headers.set(k, v);
  const retryAfter = (options.details as { retryAfterSeconds?: unknown } | undefined)
    ?.retryAfterSeconds;
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0) {
    response.headers.set('retry-after', String(Math.ceil(retryAfter)));
  }
  return response;
}

/* ---------------- client address ---------------- */

/**
 * Best-effort client address for abuse limits. Never logged.
 *
 * `hops` is the number of reverse proxies we trust (TALA_TRUSTED_PROXY_HOPS). With 0, forwarding headers
 * are ignored entirely, because any client can write them. With n, the n-th entry from the right of
 * X-Forwarded-For is the address the outermost trusted proxy saw.
 */
export function clientAddress(
  request: Request,
  hops: number,
  direct: string | null | undefined
): string | null {
  if (direct) return normaliseAddress(direct);
  if (hops <= 0) return null;
  const header = request.headers.get('x-forwarded-for');
  if (!header) return null;
  const parts = header
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const picked = parts[parts.length - hops];
  return picked ? normaliseAddress(picked) : null;
}

export function normaliseAddress(address: string): string | null {
  let a = address.trim().toLowerCase();
  if (a.startsWith('[')) a = a.slice(1, a.indexOf(']') === -1 ? undefined : a.indexOf(']'));
  if (a.startsWith('::ffff:') && a.includes('.')) a = a.slice(7);
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(a)) return a.split(':')[0]!;
  if (/^[0-9a-f:]+$/.test(a) && a.includes(':')) {
    // One customer usually holds a whole /64, so limit by prefix.
    const expanded = expandIpv6(a);
    return expanded ? `${expanded.slice(0, 4).join(':')}::/64` : null;
  }
  return null;
}

function expandIpv6(a: string): string[] | null {
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ''));
}
