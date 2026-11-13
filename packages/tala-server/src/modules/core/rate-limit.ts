/**
 * Durable rate limiting (PRD AUTH-4) and the progressive delay on sign-in.
 * OWNER: workstream A.
 *
 * Keys are hashed before they are stored, so the table holds no email or network address.
 * Limits are fixed windows: simple, cheap, and good enough for abuse limits (a burst of at most
 * twice the limit is possible across a window boundary).
 */
import { createHash } from 'node:crypto';
import type { Db } from '../../kernel/db';
import { HttpError } from '../../kernel/types';
import type { RateLimiter } from '../../kernel/types';

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function createSqliteRateLimiter(db: Db, now: () => Date): RateLimiter & { prune(): void } {
  const get = db.prepare('SELECT window_start, count FROM core_rate_limits WHERE key_hash = ?');
  const reset = db.prepare('INSERT OR REPLACE INTO core_rate_limits (key_hash, window_start, count) VALUES (?, ?, 1)');
  const bump = db.prepare('UPDATE core_rate_limits SET count = count + 1 WHERE key_hash = ?');
  const prune = db.prepare('DELETE FROM core_rate_limits WHERE window_start < ?');

  const take = db.transaction((key: string, limit: number, windowSeconds: number): boolean => {
    const k = hashKey(key);
    const t = now().getTime();
    const row = get.get(k) as { window_start: number; count: number } | undefined;
    if (!row || t >= row.window_start + windowSeconds * 1000 || t < row.window_start) {
      if (limit < 1) return false;
      reset.run(k, t);
      return true;
    }
    if (row.count >= limit) return false;
    bump.run(k);
    return true;
  });

  return {
    take: (key, limit, windowSeconds) => take(key, limit, windowSeconds),
    prune() {
      // No window in use is longer than a day.
      prune.run(now().getTime() - 2 * 86_400_000);
    },
  };
}

/** Throw the uniform "slow down" error. */
export function tooMany(retryAfterSeconds?: number): never {
  throw new HttpError(
    'rate_limited',
    'Too many tries. Please wait a little and try again.',
    retryAfterSeconds === undefined ? { reason: 'rate_limited' } : { reason: 'rate_limited', retryAfterSeconds },
  );
}

/* ---------------- progressive delay on sign-in ---------------- */

/** Wrong passwords allowed before a wait is imposed. */
export const FREE_FAILURES = 5;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;
/** A run of failures is forgotten after this long without another. */
const FORGET_AFTER_MS = 24 * 60 * 60_000;

export function delayAfter(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (failures - FREE_FAILURES), MAX_DELAY_MS);
}

/**
 * Counts consecutive wrong passwords per (email, address) pair. The same count is kept whether or not
 * the email belongs to an account, so the delay reveals nothing. Keying on the pair means someone
 * hammering an address from elsewhere cannot lock its owner out of their own connection.
 */
export function createLoginThrottle(db: Db, now: () => Date) {
  const get = db.prepare('SELECT failures, last_failure_at FROM core_login_failures WHERE key_hash = ?');
  const put = db.prepare('INSERT OR REPLACE INTO core_login_failures (key_hash, failures, last_failure_at) VALUES (?, ?, ?)');
  const del = db.prepare('DELETE FROM core_login_failures WHERE key_hash = ?');
  const prune = db.prepare('DELETE FROM core_login_failures WHERE last_failure_at < ?');
  const keyOf = (emailNorm: string, ip: string | null) => hashKey(`login-pair:${emailNorm}|${ip ?? 'unknown'}`);

  function current(k: string): { failures: number; last: number } | null {
    const row = get.get(k) as { failures: number; last_failure_at: number } | undefined;
    if (!row) return null;
    if (now().getTime() - row.last_failure_at >= FORGET_AFTER_MS) {
      del.run(k);
      return null;
    }
    return { failures: row.failures, last: row.last_failure_at };
  }

  return {
    /** Seconds the caller must still wait before another try is looked at; 0 when a try is allowed now. */
    waitSeconds(emailNorm: string, ip: string | null): number {
      const state = current(keyOf(emailNorm, ip));
      if (!state) return 0;
      const remaining = state.last + delayAfter(state.failures) - now().getTime();
      return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
    },
    recordFailure(emailNorm: string, ip: string | null): void {
      const k = keyOf(emailNorm, ip);
      const state = current(k);
      put.run(k, (state?.failures ?? 0) + 1, now().getTime());
    },
    clear(emailNorm: string, ip: string | null): void {
      del.run(keyOf(emailNorm, ip));
    },
    prune(): void {
      prune.run(now().getTime() - FORGET_AFTER_MS);
    },
  };
}

export type LoginThrottle = ReturnType<typeof createLoginThrottle>;
