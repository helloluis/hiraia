/**
 * How a request proves who it is, and the kernel-private hooks the core module uses.
 * OWNER: workstream A.
 *
 * The kernel knows nothing about users or session tables. A module (in practice only `core`) may attach an
 * `authenticator` through the `kernel` extension below, and the kernel asks it to turn a presented token into a user.
 *
 * Web sends the session as an httpOnly cookie; mobile sends `Authorization: Bearer <token>`. If both are
 * present the header wins: it was put there on purpose, a cookie is ambient.
 *
 * Only the core module may set cookies or run work after the response. Those two abilities are deliberately
 * NOT on `Ctx`, so no other module can set a header; core reaches them through `effectsOf(ctx)`.
 */
import type { Id } from '@hiraia/tala-core';
import type { BaseDeps, Ctx, ServerModule, Services, SessionUser, TalaServerConfig } from './types';

/* ---------------- authenticator ---------------- */

export type AuthFailure = 'unknown' | 'expired' | 'revoked' | 'account_deleted';

export type AuthOutcome = { user: SessionUser } | { user: null; reason: AuthFailure };

export interface Authenticator {
  /** Must never throw for a bad token. `via` lets the implementation record how the session is used. */
  authenticate(token: string, via: CredentialSource): AuthOutcome;
}

/** Optional, kernel-private additions to a ServerModule. See CONTRACT-REQUESTS.md (kernel folder). */
export interface KernelExtension {
  authenticator?: (deps: BaseDeps & { services: Services }) => Authenticator;
  /**
   * Called inside the account-deletion transaction so a module can remove what it stores for that user.
   * Must be synchronous and must only touch the module's own tables.
   */
  onAccountDeleted?: (deps: BaseDeps, userId: Id) => void;
}

export type ExtendedModule = ServerModule & { kernel?: KernelExtension };

export function kernelExtension(module: ServerModule): KernelExtension {
  const ext = (module as ExtendedModule).kernel;
  return ext && typeof ext === 'object' ? ext : {};
}

/* ---------------- account deletion hooks ---------------- */

const ACCOUNT_HOOKS = new WeakMap<object, Array<{ module: string; run: (userId: Id) => void }>>();

/** Kernel: remember each module's `onAccountDeleted` for this database connection. */
export function registerAccountHooks(db: object, hooks: Array<{ module: string; run: (userId: Id) => void }>): void {
  ACCOUNT_HOOKS.set(db, hooks);
}

/** Core: run every other module's clean-up for a deleted account. Call inside the deletion transaction. */
export function runAccountDeletedHooks(db: object, userId: Id): string[] {
  const ran: string[] = [];
  for (const hook of ACCOUNT_HOOKS.get(db) ?? []) {
    hook.run(userId);
    ran.push(hook.module);
  }
  return ran;
}

/* ---------------- credentials ---------------- */

export type CredentialSource = 'bearer' | 'cookie';

export interface Credentials {
  token: string;
  via: CredentialSource;
}

/** Session tokens are base64url. Anything else is not ours and is ignored without a lookup. */
const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function extractCredentials(request: Request, cookieName: string): Credentials | null {
  const header = request.headers.get('authorization');
  if (header) {
    const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
    if (m && TOKEN_RE.test(m[1]!)) return { token: m[1]!, via: 'bearer' };
    // A malformed Authorization header does not fall back to the cookie: the caller meant to use the header.
    return null;
  }
  const cookie = readCookie(request.headers.get('cookie'), cookieName);
  if (cookie && TOKEN_RE.test(cookie)) return { token: cookie, via: 'cookie' };
  return null;
}

/* ---------------- cookies ---------------- */

function cookieAttributes(config: TalaServerConfig): string {
  const secure = config.publicOrigin.startsWith('https://') ? '; Secure' : '';
  // Lax: the cookie travels on a top-level link into the site (the email links) but not on cross-site POSTs.
  return `; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function sessionCookie(config: TalaServerConfig, token: string, maxAgeSeconds: number): string {
  return `${config.session.cookieName}=${token}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}${cookieAttributes(config)}`;
}

export function clearedSessionCookie(config: TalaServerConfig): string {
  return `${config.session.cookieName}=; Max-Age=0${cookieAttributes(config)}`;
}

/* ---------------- cross-site request check ---------------- */

/**
 * State-changing requests that carry browser origin information must come from our own origin.
 * Native mobile clients send neither header and are unaffected. This backs up SameSite on the cookie
 * and also protects sign-in and sign-up themselves (which have no session yet) from being driven cross-site.
 */
export function isCrossSite(request: Request, config: TalaServerConfig): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return false;
  const origin = request.headers.get('origin');
  if (origin !== null) {
    if (origin === config.publicOrigin) return false;
    try {
      if (origin === new URL(request.url).origin) return false;
    } catch {
      /* fall through */
    }
    return true;
  }
  return request.headers.get('sec-fetch-site')?.toLowerCase() === 'cross-site';
}

/* ---------------- per-request effects (core only) ---------------- */

export interface RequestEffects {
  /** Set-Cookie values to add to the response. */
  cookies: string[];
  /** Work to run after the response is built. Not awaited by the request; failures are logged by event name only. */
  after: Array<() => Promise<void> | void>;
  /** How this request authenticated, if it did. */
  credentials: Credentials | null;
  /** Value of the User-Agent header, cut short; used only as a default device label. */
  userAgent: string | null;
}

const EFFECTS = new WeakMap<Ctx, RequestEffects>();

export function attachEffects(ctx: Ctx, effects: RequestEffects): void {
  EFFECTS.set(ctx, effects);
}

export function effectsOf(ctx: Ctx): RequestEffects {
  const effects = EFFECTS.get(ctx);
  if (!effects) throw new Error('effectsOf(ctx) was called with a context the kernel did not create.');
  return effects;
}
