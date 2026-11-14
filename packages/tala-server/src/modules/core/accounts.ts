/**
 * Accounts, sessions and emailed tokens.
 * OWNER: workstream A.
 *
 * - An account is keyed by an internal id, never by its email (AUTH-11), so a Google identity can be
 *   attached later without moving any data.
 * - Session and email tokens are 256 random bits. Only their SHA-256 is stored, so reading the database
 *   does not let anyone sign in. They are never logged.
 * - Sessions slide: each use extends the expiry, so a phone that syncs occasionally stays signed in and
 *   one that is offline for 30 days is still signed in when it comes back (OFF-5).
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Id, User } from '@hiraia/tala-core';
import type { Db } from '../../kernel/db';
import type { AuthOutcome } from '../../kernel/auth';
import type { SessionUser, TalaServerConfig } from '../../kernel/types';

const DAY_MS = 86_400_000;
/** Do not write to the session row more often than this. */
const TOUCH_AFTER_MS = 60 * 60 * 1000;
/** How long we remember why a token ended. */
const ENDED_TOKEN_DAYS = 120;

export const VERIFY_EMAIL_TTL_MS = 48 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const LINK_GOOGLE_TTL_MS = 30 * 60 * 1000;

export type EmailTokenPurpose = 'verify_email' | 'password_reset' | 'link_google';

export interface IdentityRow {
  provider: string;
  subject: string;
  user_id: string;
  email: string;
}

/** How an account's email came to count as confirmed. 'auto' proves nothing about who holds the mailbox. */
export type VerifiedHow = 'link' | 'reset' | 'google' | 'auto';

export interface UserRow {
  id: string;
  email: string;
  email_norm: string;
  email_verified: number;
  /** 'link' | 'reset' | 'google' | 'auto' (confirmed at sign-up because no mail could be sent), or null. */
  email_verified_how: string | null;
  display_name: string;
  ui_language: string;
  password_hash: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  device_label: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export function normaliseEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** A coarse, friendly default when the client did not name the device. Nothing identifying is kept. */
export function deviceLabelFrom(label: string, userAgent: string | null): string {
  const given = label.trim();
  if (given) return given.slice(0, 80);
  const ua = userAgent ?? '';
  if (/android/i.test(ua)) return /mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/cros/i.test(ua)) return 'Chromebook';
  if (/windows/i.test(ua)) return 'Windows computer';
  if (/macintosh|mac os/i.test(ua)) return 'Mac';
  if (/linux/i.test(ua)) return 'Linux computer';
  return 'Unknown device';
}

export interface IssuedSession {
  sessionId: Id;
  token: string;
  expiresAt: Date;
}

export function createAccounts(db: Db, config: TalaServerConfig, now: () => Date, newId: () => Id) {
  const ttlMs = config.session.ttlDays * DAY_MS;

  const q = {
    userById: db.prepare('SELECT * FROM core_users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM core_users WHERE email_norm = ?'),
    insertUser: db.prepare(
      `INSERT INTO core_users (id, email, email_norm, email_verified, email_verified_how, display_name, ui_language, password_hash, password_changed_at, created_at, updated_at)
       VALUES (@id, @email, @email_norm, @email_verified, @email_verified_how, @display_name, @ui_language, @password_hash, @password_changed_at, @created_at, @updated_at)`
    ),
    setPassword: db.prepare(
      'UPDATE core_users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?'
    ),
    setVerified: db.prepare(
      'UPDATE core_users SET email_verified = 1, email_verified_how = ?, updated_at = ? WHERE id = ?'
    ),
    setProfile: db.prepare(
      'UPDATE core_users SET display_name = ?, ui_language = ?, updated_at = ? WHERE id = ?'
    ),
    deleteUser: db.prepare('DELETE FROM core_users WHERE id = ?'),
    deleteMailTo: db.prepare('DELETE FROM core_mail_outbox WHERE lower(to_email) = ?'),
    hasGoogle: db.prepare(
      `SELECT 1 FROM core_identities WHERE user_id = ? AND provider = 'google' LIMIT 1`
    ),
    identityBySubject: db.prepare(
      'SELECT * FROM core_identities WHERE provider = ? AND subject = ?'
    ),
    identityOfUser: db.prepare('SELECT * FROM core_identities WHERE user_id = ? AND provider = ?'),
    insertIdentity: db.prepare(
      'INSERT INTO core_identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)'
    ),
    deleteIdentity: db.prepare('DELETE FROM core_identities WHERE user_id = ? AND provider = ?'),
    moveIdentity: db.prepare(
      'UPDATE core_identities SET user_id = ? WHERE user_id = ? AND provider = ?'
    ),
    setIdentityEmail: db.prepare(
      'UPDATE core_identities SET email = ? WHERE provider = ? AND subject = ?'
    ),
    clearPassword: db.prepare(
      'UPDATE core_users SET password_hash = NULL, password_changed_at = ?, updated_at = ? WHERE id = ?'
    ),

    insertSession: db.prepare(
      `INSERT INTO core_sessions (id, user_id, token_hash, device_label, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    sessionByHash: db.prepare('SELECT * FROM core_sessions WHERE token_hash = ?'),
    sessionsOfUser: db.prepare(
      'SELECT * FROM core_sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC, created_at DESC'
    ),
    sessionOfUser: db.prepare('SELECT * FROM core_sessions WHERE id = ? AND user_id = ?'),
    allSessionsOfUser: db.prepare('SELECT * FROM core_sessions WHERE user_id = ?'),
    touchSession: db.prepare(
      'UPDATE core_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?'
    ),
    deleteSession: db.prepare('DELETE FROM core_sessions WHERE id = ?'),
    endToken: db.prepare(
      'INSERT OR REPLACE INTO core_ended_tokens (token_hash, reason, ended_at) VALUES (?, ?, ?)'
    ),
    endedToken: db.prepare('SELECT reason FROM core_ended_tokens WHERE token_hash = ?'),
    pruneEnded: db.prepare('DELETE FROM core_ended_tokens WHERE ended_at < ?'),
    pruneSessions: db.prepare('DELETE FROM core_sessions WHERE expires_at < ?'),

    insertEmailToken: db.prepare(
      `INSERT INTO core_email_tokens (id, user_id, purpose, token_hash, email_norm, created_at, expires_at, used_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`
    ),
    emailTokenByHash: db.prepare(
      'SELECT * FROM core_email_tokens WHERE token_hash = ? AND purpose = ?'
    ),
    useEmailToken: db.prepare(
      'UPDATE core_email_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL'
    ),
    retireEmailTokens: db.prepare(
      'UPDATE core_email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL'
    ),
    pruneEmailTokens: db.prepare('DELETE FROM core_email_tokens WHERE expires_at < ?'),
  };

  function toUser(row: UserRow): User {
    return {
      id: row.id,
      email: row.email,
      emailVerified: row.email_verified === 1,
      displayName: row.display_name,
      hasPassword: row.password_hash !== null,
      hasGoogle: q.hasGoogle.get(row.id) !== undefined,
      createdAt: row.created_at,
    };
  }

  function endSessionRow(
    row: SessionRow,
    reason: 'revoked' | 'account_deleted' | 'account_merged'
  ): void {
    q.endToken.run(row.token_hash, reason, now().toISOString());
    q.deleteSession.run(row.id);
  }

  return {
    toUser,

    userById(id: Id): UserRow | null {
      return (q.userById.get(id) as UserRow | undefined) ?? null;
    },

    userByEmail(email: string): UserRow | null {
      return (q.userByEmail.get(normaliseEmail(email)) as UserRow | undefined) ?? null;
    },

    /** Returns null when the email is already taken. */
    createUser(input: {
      email: string;
      displayName: string;
      uiLanguage: string;
      passwordHash: string | null;
      /** Set when the email already counts as confirmed, with how it came to. */
      verified?: VerifiedHow;
    }): UserRow | null {
      const at = now().toISOString();
      const row: UserRow = {
        id: newId(),
        email: input.email.trim(),
        email_norm: normaliseEmail(input.email),
        email_verified: input.verified ? 1 : 0,
        email_verified_how: input.verified ?? null,
        display_name: input.displayName.trim(),
        ui_language: input.uiLanguage,
        password_hash: input.passwordHash,
        password_changed_at: input.passwordHash ? at : null,
        created_at: at,
        updated_at: at,
      };
      try {
        q.insertUser.run(row);
      } catch (err) {
        if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return null;
        throw err;
      }
      return row;
    },

    setPassword(userId: Id, passwordHash: string): void {
      const at = now().toISOString();
      q.setPassword.run(passwordHash, at, at, userId);
    },

    markEmailVerified(userId: Id, how: VerifiedHow): void {
      q.setVerified.run(how, now().toISOString(), userId);
    },

    /** Keep the account's name and language in step with the teacher's synced profile record. */
    updateProfile(userId: Id, displayName: string, uiLanguage: string): void {
      q.setProfile.run(displayName, uiLanguage, now().toISOString(), userId);
    },

    /**
     * Remove the account. Its sessions are remembered (as hashes) as ended by deletion, so its other devices
     * learn why they were signed out. Rows in tables that reference the user go with it.
     */
    deleteUser(
      user: UserRow,
      reason: 'account_deleted' | 'account_merged' = 'account_deleted'
    ): void {
      for (const row of q.allSessionsOfUser.all(user.id) as SessionRow[])
        endSessionRow(row, reason);
      q.deleteMailTo.run(user.email_norm);
      q.deleteUser.run(user.id);
    },

    /* ---------------- sessions ---------------- */

    issueSession(userId: Id, deviceLabel: string): IssuedSession {
      const token = newToken();
      const at = now();
      const expiresAt = new Date(at.getTime() + ttlMs);
      const sessionId = newId();
      q.insertSession.run(
        sessionId,
        userId,
        hashToken(token),
        deviceLabel,
        at.toISOString(),
        at.toISOString(),
        expiresAt.toISOString()
      );
      return { sessionId, token, expiresAt };
    },

    /** Turn a presented token into a user. Never throws for a bad token. */
    authenticate(token: string): AuthOutcome {
      const tokenHash = hashToken(token);
      const session = q.sessionByHash.get(tokenHash) as SessionRow | undefined;
      const at = now();
      if (!session) {
        const ended = q.endedToken.get(tokenHash) as { reason: string } | undefined;
        if (ended?.reason === 'account_deleted') return { user: null, reason: 'account_deleted' };
        if (ended?.reason === 'account_merged') return { user: null, reason: 'account_merged' };
        if (ended) return { user: null, reason: 'revoked' };
        return { user: null, reason: 'unknown' };
      }
      if (session.expires_at <= at.toISOString()) {
        q.deleteSession.run(session.id);
        return { user: null, reason: 'expired' };
      }
      const user = q.userById.get(session.user_id) as UserRow | undefined;
      if (!user) return { user: null, reason: 'unknown' };
      if (at.getTime() - Date.parse(session.last_seen_at) >= TOUCH_AFTER_MS) {
        q.touchSession.run(
          at.toISOString(),
          new Date(at.getTime() + ttlMs).toISOString(),
          session.id
        );
      }
      const sessionUser: SessionUser = {
        id: user.id,
        email: user.email,
        emailVerified: user.email_verified === 1,
        displayName: user.display_name,
        sessionId: session.id,
      };
      return { user: sessionUser };
    },

    listSessions(userId: Id): SessionRow[] {
      return q.sessionsOfUser.all(userId, now().toISOString()) as SessionRow[];
    },

    /** False when the session is not this user's (or does not exist): callers answer "not found" either way. */
    revokeSession(userId: Id, sessionId: Id): boolean {
      const row = q.sessionOfUser.get(sessionId, userId) as SessionRow | undefined;
      if (!row) return false;
      endSessionRow(row, 'revoked');
      return true;
    },

    revokeAllSessions(
      userId: Id,
      options: { except?: Id; reason?: 'revoked' | 'account_deleted' } = {}
    ): number {
      let n = 0;
      for (const row of q.allSessionsOfUser.all(userId) as SessionRow[]) {
        if (row.id === options.except) continue;
        endSessionRow(row, options.reason ?? 'revoked');
        n++;
      }
      return n;
    },

    /* ---------------- emailed tokens ---------------- */

    /** Issue a single-use token. Earlier unused tokens of the same purpose stop working. */
    issueEmailToken(
      user: UserRow,
      purpose: EmailTokenPurpose,
      payload: Record<string, string> | null = null
    ): string {
      const token = newToken();
      const at = now();
      const ttl =
        purpose === 'verify_email'
          ? VERIFY_EMAIL_TTL_MS
          : purpose === 'password_reset'
            ? PASSWORD_RESET_TTL_MS
            : LINK_GOOGLE_TTL_MS;
      q.retireEmailTokens.run(at.toISOString(), user.id, purpose);
      q.insertEmailToken.run(
        newId(),
        user.id,
        purpose,
        hashToken(token),
        user.email_norm,
        at.toISOString(),
        new Date(at.getTime() + ttl).toISOString(),
        payload ? JSON.stringify(payload) : null
      );
      return token;
    },

    /** Like consumeEmailToken, and also hands back what was stored with the token. */
    consumeEmailTokenWithPayload(
      token: string,
      purpose: EmailTokenPurpose
    ): { user: UserRow; payload: Record<string, string> } | null {
      const row = q.emailTokenByHash.get(hashToken(token), purpose) as
        | {
            id: string;
            user_id: string;
            email_norm: string;
            expires_at: string;
            used_at: string | null;
            payload: string | null;
          }
        | undefined;
      const at = now().toISOString();
      if (!row || row.used_at !== null || row.expires_at <= at || row.payload === null) return null;
      if (q.useEmailToken.run(at, row.id).changes !== 1) return null;
      const user = q.userById.get(row.user_id) as UserRow | undefined;
      if (!user || user.email_norm !== row.email_norm) return null;
      return { user, payload: JSON.parse(row.payload) as Record<string, string> };
    },

    /* ---------------- external identities (Google) ---------------- */

    identityBySubject(provider: string, subject: string): IdentityRow | null {
      return (q.identityBySubject.get(provider, subject) as IdentityRow | undefined) ?? null;
    },

    identityOfUser(userId: Id, provider: string): IdentityRow | null {
      return (q.identityOfUser.get(userId, provider) as IdentityRow | undefined) ?? null;
    },

    /** False when that identity already belongs to an account (one identity, one account: AUTH-11). */
    attachIdentity(userId: Id, provider: string, subject: string, email: string): boolean {
      try {
        q.insertIdentity.run(provider, subject, userId, email, now().toISOString());
        return true;
      } catch (err) {
        if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return false;
        throw err;
      }
    },

    detachIdentity(userId: Id, provider: string): boolean {
      return q.deleteIdentity.run(userId, provider).changes > 0;
    },

    moveIdentity(fromUserId: Id, toUserId: Id, provider: string): void {
      q.moveIdentity.run(toUserId, fromUserId, provider);
    },

    rememberIdentityEmail(provider: string, subject: string, email: string): void {
      q.setIdentityEmail.run(email, provider, subject);
    },

    /** The account keeps working through its other sign-in method. The caller has checked that there is one. */
    clearPassword(userId: Id): void {
      const at = now().toISOString();
      q.clearPassword.run(at, at, userId);
    },

    /** The account a still-valid token belongs to, without using it up. */
    peekEmailToken(token: string, purpose: EmailTokenPurpose): UserRow | null {
      const row = q.emailTokenByHash.get(hashToken(token), purpose) as
        | { user_id: string; email_norm: string; expires_at: string; used_at: string | null }
        | undefined;
      if (!row || row.used_at !== null || row.expires_at <= now().toISOString()) return null;
      const user = q.userById.get(row.user_id) as UserRow | undefined;
      return user && user.email_norm === row.email_norm ? user : null;
    },

    /**
     * Use a token once. Returns the account it belongs to, or null if it is unknown, expired, already used,
     * or was sent to an address the account no longer has. The caller gives one answer for all of those.
     */
    consumeEmailToken(token: string, purpose: EmailTokenPurpose): UserRow | null {
      const row = q.emailTokenByHash.get(hashToken(token), purpose) as
        | {
            id: string;
            user_id: string;
            email_norm: string;
            expires_at: string;
            used_at: string | null;
          }
        | undefined;
      const at = now().toISOString();
      if (!row || row.used_at !== null || row.expires_at <= at) return null;
      if (q.useEmailToken.run(at, row.id).changes !== 1) return null;
      const user = q.userById.get(row.user_id) as UserRow | undefined;
      if (!user || user.email_norm !== row.email_norm) return null;
      return user;
    },

    /** Housekeeping; safe to run at any time. */
    prune(): void {
      const at = now();
      q.pruneSessions.run(at.toISOString());
      q.pruneEmailTokens.run(new Date(at.getTime() - 7 * DAY_MS).toISOString());
      q.pruneEnded.run(new Date(at.getTime() - ENDED_TOKEN_DAYS * DAY_MS).toISOString());
    },
  };
}

export type Accounts = ReturnType<typeof createAccounts>;
