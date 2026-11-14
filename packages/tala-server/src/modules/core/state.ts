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
import { createGoogleKeyFetcher, createGoogleVerifier, googleClientIdsFromEnv } from './google';
import type { GoogleKeyFetcher, GoogleVerifier } from './google';
import { createMailer } from './mailer';
import type { MailTransport } from './mailer';
import { DEFAULT_ARGON2_COST, createPasswordHasher } from './passwords';
import type { Argon2Cost, PasswordHasher } from './passwords';
import { createLoginThrottle, createSqliteRateLimiter } from './rate-limit';
import type { LoginThrottle } from './rate-limit';
import { createRecordEngine } from './records';
import type { RecordEngine } from './records';
import { createRevisions } from './revisions';
import type { Revisions } from './revisions';
import { serverVersion } from './version';
import type { Mailer, RateLimiter } from '../../kernel/types';

export interface CoreOptions {
  /** Argon2id cost. Leave unset outside tests. */
  argon2?: Argon2Cost;
  /** Delivers email. Without one, local and staging write to the dev outbox and production refuses to send. */
  mailTransport?: MailTransport;
  /**
   * Google sign-in. `clientIds` defaults to GOOGLE_OAUTH_CLIENT_ID (comma-separated for several);
   * `fetchKeys` defaults to Google's published keys. Tests pass their own of both.
   */
  google?: { clientIds?: string[]; fetchKeys?: GoogleKeyFetcher };
  /**
   * STOP-GAP until a mail provider is chosen (default: TALA_AUTH_AUTO_VERIFY). With no mail transport, new
   * accounts count as email-confirmed at sign-up and nothing is ever mailed. Ignored when a transport exists.
   */
  autoVerifyEmail?: boolean;
  /** Label of the running build for `system.health` (default: TALA_BUILD_ID). */
  buildId?: string;
}

/**
 * What happens to mail on this server:
 *  - 'transport'   a real transport delivers it;
 *  - 'outbox'      local and staging: written to the dev outbox table for the developer to read;
 *  - 'unavailable' production with no transport: sending fails closed (nothing is stored);
 *  - 'off'         the auto-verify stop-gap: nothing is sent and nothing fails; sign-up confirms the email.
 */
export type MailMode = 'transport' | 'outbox' | 'unavailable' | 'off';

function envFlag(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes((process.env[name] ?? '').trim().toLowerCase());
}

export function mailModeFor(
  environment: BaseDeps['config']['environment'],
  options: CoreOptions
): MailMode {
  if (options.mailTransport) return 'transport';
  if (options.autoVerifyEmail ?? envFlag('TALA_AUTH_AUTO_VERIFY')) return 'off';
  return environment === 'production' ? 'unavailable' : 'outbox';
}

export interface CoreState {
  accounts: Accounts;
  hasher: PasswordHasher;
  throttle: LoginThrottle;
  limiter: RateLimiter & { prune(): void };
  mailer: Mailer;
  mailMode: MailMode;
  /** Reported by `system.health`. */
  version: string;
  /** Client ids a Google ID token may be issued for. Empty = Google sign-in is not configured. */
  googleClientIds: string[];
  google: GoogleVerifier;
  revisions: Revisions;
  records: RecordEngine;
}

const STATES = new WeakMap<Db, CoreState>();

export function initCoreState(base: BaseDeps, options: CoreOptions): CoreState {
  const existing = STATES.get(base.db);
  if (existing) return existing;
  const accounts = createAccounts(base.db, base.config, base.now, base.newId);
  const revisions = createRevisions(base.db, base.now);
  const googleClientIds = options.google?.clientIds ?? googleClientIdsFromEnv();
  const mailMode = mailModeFor(base.config.environment, options);
  const state: CoreState = {
    accounts,
    mailMode,
    version: serverVersion(options.buildId ?? process.env.TALA_BUILD_ID),
    googleClientIds,
    google: createGoogleVerifier({
      clientIds: googleClientIds,
      fetchKeys: options.google?.fetchKeys ?? createGoogleKeyFetcher(),
      now: base.now,
    }),
    revisions,
    records: createRecordEngine({
      db: base.db,
      now: base.now,
      log: base.log,
      revisions,
      // The profile record is where a teacher edits their name; emails and sessions read it from the account.
      onProfile: (ownerId, profile) =>
        accounts.updateProfile(ownerId, profile.displayName, profile.uiLanguage),
    }),
    hasher: createPasswordHasher(options.argon2 ?? DEFAULT_ARGON2_COST),
    throttle: createLoginThrottle(base.db, base.now),
    limiter: createSqliteRateLimiter(base.db, base.now),
    mailer: createMailer({
      db: base.db,
      config: base.config,
      now: base.now,
      newId: base.newId,
      log: base.log,
      transport: options.mailTransport,
      mode: mailMode,
    }),
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
