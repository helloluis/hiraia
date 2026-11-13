/**
 * Google sign-in: verifying a Google ID token (PRD §13.3, AUTH-9 to AUTH-12).
 * OWNER: workstream A.
 *
 * The apps obtain an ID token from Google (OpenID Connect) and post it to the server. Nothing in a token is
 * believed until all of this holds:
 *   - it is a three-part JWT whose header says RS256 (no other algorithm is accepted, so a token "signed"
 *     with `none`, or with HMAC using a public key as the secret, is refused before any key is looked at);
 *   - its signature verifies against one of Google's published keys, chosen by the header's key id;
 *   - `iss` is Google, `aud` is one of our client ids, it has not expired and was not issued in the future;
 *   - it carries a subject and an email that Google says is verified.
 *
 * Only identity scopes are involved: the server never receives or asks for access to Drive, Classroom,
 * contacts or calendar (AUTH-9), and the client secret is not needed for any of this.
 *
 * Google's keys are fetched from Google's own endpoint and cached for as long as Google says. An unknown key
 * id triggers one refetch (keys rotate); after that, unknown ids are refused without another fetch for a
 * while, so a stream of junk tokens cannot make this server hammer Google.
 */
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import type { JsonWebKey, KeyObject } from 'node:crypto';

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS: readonly string[] = [
  'https://accounts.google.com',
  'accounts.google.com',
];

/** Seconds a token may be past `exp`, or `iat` ahead of us, before clocks are blamed no longer. */
const CLOCK_SKEW_SECONDS = 60;
const MIN_KEY_CACHE_SECONDS = 5 * 60;
const MAX_KEY_CACHE_SECONDS = 24 * 60 * 60;
/** After a refetch, how long an unknown key id is refused without asking Google again. */
const UNKNOWN_KEY_COOLDOWN_SECONDS = 60;
/** After a failed fetch, how long before Google is asked again. */
const FAILED_FETCH_COOLDOWN_SECONDS = 30;

export interface GoogleKeySet {
  /** JSON Web Keys as Google publishes them (each with `kid`). */
  keys: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }>;
  /** How long Google says they may be cached. */
  maxAgeSeconds: number;
}

/** Fetches Google's current signing keys. Tests supply their own; production uses `createGoogleKeyFetcher()`. */
export type GoogleKeyFetcher = () => Promise<GoogleKeySet>;

export function createGoogleKeyFetcher(
  fetchImpl: typeof fetch = globalThis.fetch,
  url: string = GOOGLE_CERTS_URL
): GoogleKeyFetcher {
  return async () => {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Google key endpoint answered ${response.status}`);
    const body = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) throw new Error('Google key endpoint sent no keys');
    const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '');
    return {
      keys: body.keys as GoogleKeySet['keys'],
      maxAgeSeconds: maxAge ? Number(maxAge[1]) : MIN_KEY_CACHE_SECONDS,
    };
  };
}

export interface GoogleIdentity {
  /** Google's stable id for the account. This, never the email, is what an identity is keyed by. */
  subject: string;
  email: string;
  name: string | null;
}

export type GoogleTokenProblem =
  | 'malformed'
  | 'unsupported_algorithm'
  | 'unknown_key'
  | 'bad_signature'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'expired'
  | 'not_yet_valid'
  | 'missing_claims'
  | 'email_not_verified'
  | 'keys_unavailable';

export type GoogleVerification =
  | { ok: true; identity: GoogleIdentity }
  | { ok: false; problem: GoogleTokenProblem };

export interface GoogleVerifier {
  verify(idToken: string): Promise<GoogleVerification>;
}

function decodePart(part: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('not base64url');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
}

export function createGoogleVerifier(options: {
  clientIds: readonly string[];
  fetchKeys: GoogleKeyFetcher;
  now: () => Date;
}): GoogleVerifier {
  const { clientIds, fetchKeys, now } = options;
  let keys = new Map<string, KeyObject>();
  let freshUntil = 0;
  let lastFetchAt = 0;
  let lastFailureAt = 0;
  let inFlight: Promise<boolean> | null = null;

  /** Refresh the key cache. Returns false when Google could not be reached; the old keys are then kept. */
  function refresh(): Promise<boolean> {
    inFlight ??= (async () => {
      try {
        const set = await fetchKeys();
        const next = new Map<string, KeyObject>();
        for (const jwk of set.keys) {
          if (typeof jwk.kid !== 'string' || jwk.kty !== 'RSA') continue;
          if (jwk.use !== undefined && jwk.use !== 'sig') continue;
          if (jwk.alg !== undefined && jwk.alg !== 'RS256') continue;
          try {
            next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
          } catch {
            /* one unusable key does not spoil the rest */
          }
        }
        if (next.size === 0) throw new Error('no usable keys');
        keys = next;
        const seconds = Math.min(
          Math.max(set.maxAgeSeconds, MIN_KEY_CACHE_SECONDS),
          MAX_KEY_CACHE_SECONDS
        );
        lastFetchAt = now().getTime();
        freshUntil = lastFetchAt + seconds * 1000;
        return true;
      } catch {
        lastFailureAt = now().getTime();
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  async function keyFor(kid: string): Promise<KeyObject | 'unknown_key' | 'keys_unavailable'> {
    const t = now().getTime();
    const known = keys.get(kid);
    if (known && t < freshUntil) return known;
    // Stale cache, or a key id we have not seen (Google rotated): ask once, unless we asked very recently.
    const askedRecently =
      lastFetchAt !== 0 && t - lastFetchAt < UNKNOWN_KEY_COOLDOWN_SECONDS * 1000;
    const failedRecently =
      lastFailureAt !== 0 && t - lastFailureAt < FAILED_FETCH_COOLDOWN_SECONDS * 1000;
    if (failedRecently) return known ?? 'keys_unavailable';
    if (!(askedRecently && t < freshUntil)) {
      const reached = await refresh();
      // Google unreachable: a key we already hold is still Google's key, so keep working with it.
      if (!reached) return known ?? 'keys_unavailable';
    }
    return keys.get(kid) ?? 'unknown_key';
  }

  return {
    async verify(idToken) {
      const parts = idToken.split('.');
      if (parts.length !== 3 || parts.some((p) => p.length === 0))
        return { ok: false, problem: 'malformed' };
      let header: { alg?: unknown; kid?: unknown };
      let claims: Record<string, unknown>;
      try {
        header = decodePart(parts[0]!) as { alg?: unknown; kid?: unknown };
        claims = decodePart(parts[1]!) as Record<string, unknown>;
        if (
          typeof header !== 'object' ||
          header === null ||
          typeof claims !== 'object' ||
          claims === null
        )
          throw new Error('not objects');
        if (!/^[A-Za-z0-9_-]+$/.test(parts[2]!)) throw new Error('not base64url');
      } catch {
        return { ok: false, problem: 'malformed' };
      }
      // The algorithm is fixed by us, never taken from the token.
      if (header.alg !== 'RS256') return { ok: false, problem: 'unsupported_algorithm' };
      if (typeof header.kid !== 'string' || header.kid.length === 0 || header.kid.length > 200)
        return { ok: false, problem: 'malformed' };

      const key = await keyFor(header.kid);
      if (key === 'unknown_key' || key === 'keys_unavailable') return { ok: false, problem: key };
      let signed = false;
      try {
        signed = verifySignature(
          'RSA-SHA256',
          Buffer.from(`${parts[0]}.${parts[1]}`),
          key,
          Buffer.from(parts[2]!, 'base64url')
        );
      } catch {
        signed = false;
      }
      if (!signed) return { ok: false, problem: 'bad_signature' };

      // Only now are the claims worth reading.
      if (typeof claims.iss !== 'string' || !GOOGLE_ISSUERS.includes(claims.iss))
        return { ok: false, problem: 'wrong_issuer' };
      const audiences =
        typeof claims.aud === 'string' ? [claims.aud] : Array.isArray(claims.aud) ? claims.aud : [];
      if (
        clientIds.length === 0 ||
        !audiences.some((a) => typeof a === 'string' && clientIds.includes(a))
      )
        return { ok: false, problem: 'wrong_audience' };
      // With several audiences, the party the token was issued to must also be one of ours.
      if (
        audiences.length > 1 &&
        (typeof claims.azp !== 'string' || !clientIds.includes(claims.azp))
      )
        return { ok: false, problem: 'wrong_audience' };

      const seconds = now().getTime() / 1000;
      if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp))
        return { ok: false, problem: 'missing_claims' };
      if (seconds >= claims.exp + CLOCK_SKEW_SECONDS) return { ok: false, problem: 'expired' };
      if (typeof claims.iat === 'number' && claims.iat > seconds + CLOCK_SKEW_SECONDS)
        return { ok: false, problem: 'not_yet_valid' };
      if (typeof claims.nbf === 'number' && claims.nbf > seconds + CLOCK_SKEW_SECONDS)
        return { ok: false, problem: 'not_yet_valid' };

      if (typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 255)
        return { ok: false, problem: 'missing_claims' };
      if (
        typeof claims.email !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email) ||
        claims.email.length > 254
      )
        return { ok: false, problem: 'missing_claims' };
      if (claims.email_verified !== true && claims.email_verified !== 'true')
        return { ok: false, problem: 'email_not_verified' };

      const name =
        typeof claims.name === 'string' && claims.name.trim()
          ? claims.name.trim().slice(0, 120)
          : null;
      return { ok: true, identity: { subject: claims.sub, email: claims.email, name } };
    },
  };
}

/** Client ids from GOOGLE_OAUTH_CLIENT_ID. Several (web, Android) may be given, separated by commas. */
export function googleClientIdsFromEnv(
  env: Record<string, string | undefined> = process.env
): string[] {
  return (env.GOOGLE_OAUTH_CLIENT_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
