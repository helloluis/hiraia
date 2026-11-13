/**
 * Per-server state of the core module.
 * OWNER: workstream A.
 *
 * One module object can serve several servers in one process (every test builds its own), so nothing is
 * kept in module-level variables: state hangs off the database connection.
 */
import type { Db } from '../../kernel/db';
import type { BaseDeps, Ctx } from '../../kernel/types';
import { createAccounts } from './accounts';
import type { Accounts } from './accounts';
import { createMailer } from './mailer';
import type { MailTransport } from './mailer';
import { DEFAULT_ARGON2_COST, createPasswordHasher } from './passwords';
import type { Argon2Cost, PasswordHasher } from './passwords';
import { createLoginThrottle, createSqliteRateLimiter } from './rate-limit';
import type { LoginThrottle } from './rate-limit';
import type { Mailer, RateLimiter } from '../../kernel/types';

export interface CoreOptions {
  /** Argon2id cost. Leave unset outside tests. */
  argon2?: Argon2Cost;
  /** Delivers email. Without one, local and staging write to the dev outbox and production refuses to send. */
  mailTransport?: MailTransport;
}

export interface CoreState {
  accounts: Accounts;
  hasher: PasswordHasher;
  throttle: LoginThrottle;
  limiter: RateLimiter & { prune(): void };
  mailer: Mailer;
}

const STATES = new WeakMap<Db, CoreState>();

export function initCoreState(base: BaseDeps, options: CoreOptions): CoreState {
  const existing = STATES.get(base.db);
  if (existing) return existing;
  const state: CoreState = {
    accounts: createAccounts(base.db, base.config, base.now, base.newId),
    hasher: createPasswordHasher(options.argon2 ?? DEFAULT_ARGON2_COST),
    throttle: createLoginThrottle(base.db, base.now),
    limiter: createSqliteRateLimiter(base.db, base.now),
    mailer: createMailer({ db: base.db, config: base.config, now: base.now, newId: base.newId, log: base.log, transport: options.mailTransport }),
  };
  STATES.set(base.db, state);
  return state;
}

export function coreState(dbOrCtx: Db | Ctx): CoreState {
  const db = 'db' in dbOrCtx && 'services' in dbOrCtx ? dbOrCtx.db : (dbOrCtx as Db);
  const state = STATES.get(db);
  if (!state) throw new Error('The core module has not been started for this database.');
  return state;
}
