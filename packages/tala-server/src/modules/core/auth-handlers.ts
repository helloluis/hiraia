/**
 * Sign-up, sign-in, sessions, email verification and password reset (PRD §13.2).
 * OWNER: workstream A.
 *
 * What these handlers promise:
 *  - A wrong email and a wrong password give the same answer and take about the same time.
 *  - Asking for a reset always answers "ok", whether or not the email has an account (AUTH-3).
 *  - Tokens and passwords are never logged, and no log line carries an email address.
 *  - Limits (AUTH-4): per address on sign-up and sign-in, a growing wait after repeated wrong passwords,
 *    and caps on reset and verification mail so nobody can be mail-bombed through Tala.
 *
 * One thing the contract does not allow hiding: `auth.register` returns a session, so signing up with an
 * address that already has an account has to fail visibly. It is rate limited; see CONTRACT-REQUESTS.md.
 */
import { Id, RECORD_SCHEMAS, parseRecordData } from '@hiraia/tala-core';
import type { User } from '@hiraia/tala-core';
import { clearedSessionCookie, effectsOf, sessionCookie } from '../../kernel/auth';
import { HttpError, requireUser } from '../../kernel/types';
import type { Ctx, Handler } from '../../kernel/types';
import { deviceLabelFrom, normaliseEmail } from './accounts';
import type { IssuedSession, UserRow } from './accounts';
import { mailLink } from './mailer';
import { PASSWORD_PROBLEM_MESSAGE, checkPasswordPolicy } from './passwords';
import { tooMany } from './rate-limit';
import { coreState } from './state';

const HOUR = 3600;

/** The one id a profile record may have, read from the contract so a change there needs no change here. */
const PROFILE_ID = RECORD_SCHEMAS.profile.shape.id.value;
/** Whether that id passes the contract's own `Id` rule, without which the record cannot travel in a sync envelope. */
const PROFILE_ID_SYNCS = Id.safeParse(PROFILE_ID).success;

export const BAD_CREDENTIALS = 'That email or password is not right. Please check and try again.';
export const BAD_LINK = 'This link does not work any more. Please ask for a new one.';

export function cleanDisplayName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned)
    throw new HttpError('invalid_input', 'Please type your name.', {
      reason: 'display_name_empty',
    });
  return cleaned;
}

function requirePolicy(password: string, account: { email?: string; displayName?: string }): void {
  const problem = checkPasswordPolicy(password, account);
  if (problem)
    throw new HttpError('invalid_input', PASSWORD_PROBLEM_MESSAGE[problem], {
      reason: `password_${problem}`,
    });
}

export function limit(ctx: Ctx, key: string, max: number, windowSeconds: number): void {
  if (!ctx.services.rateLimit.take(key, max, windowSeconds)) tooMany();
}

/** How much larger the shared limit is when the client address is not known. */
const UNKNOWN_ADDRESS_FACTOR = 50;

/**
 * A limit per client address. When the address is unknown (no trusted proxy configured, see the kernel
 * README), every caller would share one bucket and a handful of people could lock out everyone. The shared
 * bucket is therefore made much larger: abuse is still bounded, ordinary use is not blocked.
 */
export function limitByAddress(ctx: Ctx, name: string, max: number, windowSeconds: number): void {
  if (ctx.ip) limit(ctx, `${name}:ip:${ctx.ip}`, max, windowSeconds);
  else limit(ctx, `${name}:ip:unknown`, max * UNKNOWN_ADDRESS_FACTOR, windowSeconds);
}

/**
 * Check a password with the same protections as sign-in: a ceiling per account, and a growing wait per
 * (email, address) after repeated wrong tries. Used wherever a password is asked for again.
 */
export async function passwordMatches(
  ctx: Ctx,
  row: UserRow | null,
  emailNorm: string,
  password: string
): Promise<boolean> {
  const { hasher, throttle } = coreState(ctx);
  limit(ctx, `login:email:${emailNorm}`, 100, HOUR);
  const wait = throttle.waitSeconds(emailNorm, ctx.ip);
  if (wait > 0) tooMany(wait);
  let ok = false;
  if (row?.password_hash) ok = await hasher.verify(row.password_hash, password);
  else await hasher.verifyDummy(password);
  if (ok) throttle.clear(emailNorm, ctx.ip);
  else throttle.recordFailure(emailNorm, ctx.ip);
  return ok;
}

/** Every account starts with its profile record, so two devices signing in fresh agree on it from the first sync. */
export function seedProfile(
  ctx: Ctx,
  userId: string,
  displayName: string,
  uiLanguage: 'fil' | 'en'
): void {
  // Schema defaults fill in the rest. (Core's own store, not ctx.services.records: a test may have swapped that
  // service for a fake.) Skipped while the profile's fixed id is not a valid record id.
  if (!PROFILE_ID_SYNCS) return;
  coreState(ctx).records.service.put(
    userId,
    'profile',
    parseRecordData('profile', { id: PROFILE_ID, displayName, uiLanguage })
  );
}

export function authResult(ctx: Ctx, user: User, session: IssuedSession) {
  const maxAge = (session.expiresAt.getTime() - ctx.now().getTime()) / 1000;
  effectsOf(ctx).cookies.push(sessionCookie(ctx.config, session.token, maxAge));
  return { user, token: session.token, expiresAt: session.expiresAt.toISOString() };
}

function sendVerificationMail(ctx: Ctx, user: UserRow): Promise<void> {
  const { accounts, mailer } = coreState(ctx);
  const token = accounts.issueEmailToken(user, 'verify_email');
  return mailer.send({
    to: user.email,
    template: 'verify_email',
    lang: user.ui_language === 'en' ? 'en' : 'fil',
    vars: { displayName: user.display_name, link: mailLink(ctx.config, 'verify_email', token) },
  });
}

export const register: Handler<'auth.register'> = async (ctx, { body }) => {
  const { accounts, hasher } = coreState(ctx);
  limitByAddress(ctx, 'register', ctx.config.abuse.registerPerIpPerHour, HOUR);

  const displayName = cleanDisplayName(body.displayName);
  requirePolicy(body.password, { email: body.email, displayName });

  // Hash before looking at whether the address is taken, so both outcomes cost the same.
  const passwordHash = await hasher.hash(body.password);
  const row = accounts.createUser({
    email: body.email,
    displayName,
    uiLanguage: body.uiLanguage,
    passwordHash,
  });
  if (!row) {
    throw new HttpError(
      'conflict',
      'There is already an account with this email. Sign in instead, or reset your password if you forgot it.',
      {
        reason: 'email_taken',
      }
    );
  }
  seedProfile(ctx, row.id, displayName, body.uiLanguage);
  const session = accounts.issueSession(
    row.id,
    deviceLabelFrom(body.deviceLabel, effectsOf(ctx).userAgent)
  );
  ctx.log.info('account_created', { userId: row.id });
  // The account exists whether or not the mail goes out; the teacher can ask for it again.
  effectsOf(ctx).after.push(() => sendVerificationMail(ctx, row));
  return authResult(ctx, accounts.toUser(row), session);
};

export const login: Handler<'auth.login'> = async (ctx, { body }) => {
  const { accounts, hasher } = coreState(ctx);
  const emailNorm = normaliseEmail(body.email);
  limitByAddress(ctx, 'login', ctx.config.abuse.loginPerIpPerMinute, 60);
  const row = accounts.userByEmail(emailNorm);
  if (!(await passwordMatches(ctx, row, emailNorm, body.password)) || !row) {
    throw new HttpError('unauthenticated', BAD_CREDENTIALS, { reason: 'invalid_credentials' });
  }
  if (row.password_hash && hasher.needsRehash(row.password_hash))
    accounts.setPassword(row.id, await hasher.hash(body.password));

  // Signing in again on a browser that already has this account's session replaces it.
  if (ctx.user?.id === row.id) accounts.revokeSession(row.id, ctx.user.sessionId);
  const session = accounts.issueSession(
    row.id,
    deviceLabelFrom(body.deviceLabel, effectsOf(ctx).userAgent)
  );
  ctx.log.info('signed_in', { userId: row.id });
  return authResult(ctx, accounts.toUser(row), session);
};

export const logout: Handler<'auth.logout'> = (ctx) => {
  const user = requireUser(ctx);
  coreState(ctx).accounts.revokeSession(user.id, user.sessionId);
  effectsOf(ctx).cookies.push(clearedSessionCookie(ctx.config));
  return { ok: true as const };
};

export const logoutAll: Handler<'auth.logoutAll'> = (ctx) => {
  const user = requireUser(ctx);
  const ended = coreState(ctx).accounts.revokeAllSessions(user.id);
  effectsOf(ctx).cookies.push(clearedSessionCookie(ctx.config));
  ctx.log.info('signed_out_everywhere', { userId: user.id, sessions: ended });
  return { ok: true as const };
};

export const me: Handler<'auth.me'> = (ctx) => {
  const user = requireUser(ctx);
  const { accounts } = coreState(ctx);
  const row = accounts.userById(user.id);
  if (!row) throw new HttpError('unauthenticated', 'Please sign in again.');
  return { user: accounts.toUser(row) };
};

export const sessions: Handler<'auth.sessions'> = (ctx) => {
  const user = requireUser(ctx);
  return {
    sessions: coreState(ctx)
      .accounts.listSessions(user.id)
      .map((s) => ({
        id: s.id,
        deviceLabel: s.device_label,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        current: s.id === user.sessionId,
      })),
  };
};

export const revokeSession: Handler<'auth.revokeSession'> = (ctx, { params }) => {
  const user = requireUser(ctx);
  // Someone else's session id and an id that never existed look the same from here.
  if (!coreState(ctx).accounts.revokeSession(user.id, params.sessionId)) {
    throw new HttpError('not_found', 'We could not find that device.');
  }
  if (params.sessionId === user.sessionId)
    effectsOf(ctx).cookies.push(clearedSessionCookie(ctx.config));
  return { ok: true as const };
};

export const sendVerification: Handler<'auth.sendVerification'> = async (ctx) => {
  const user = requireUser(ctx);
  const row = coreState(ctx).accounts.userById(user.id);
  if (!row) throw new HttpError('unauthenticated', 'Please sign in again.');
  if (row.email_verified === 1) return { ok: true as const };
  limit(ctx, `verify-mail:user:${user.id}`, 5, HOUR);
  try {
    await sendVerificationMail(ctx, row);
  } catch {
    throw new HttpError(
      'unavailable',
      'We could not send the email right now. Please try again in a little while.',
      { reason: 'mail_unavailable' }
    );
  }
  return { ok: true as const };
};

export const verifyEmail: Handler<'auth.verifyEmail'> = (ctx, { body }) => {
  limitByAddress(ctx, 'verify', 30, HOUR);
  const { accounts } = coreState(ctx);
  const row = accounts.consumeEmailToken(body.token, 'verify_email');
  if (!row) throw new HttpError('invalid_input', BAD_LINK, { reason: 'link_invalid_or_expired' });
  accounts.markEmailVerified(row.id);
  ctx.log.info('email_verified', { userId: row.id });
  return { ok: true as const };
};

export const requestReset: Handler<'auth.requestReset'> = (ctx, { body }) => {
  limitByAddress(ctx, 'reset-request', 20, HOUR);
  const emailNorm = normaliseEmail(body.email);
  // Everything that depends on whether the account exists happens after the answer has gone out,
  // so the answer and its timing are the same for every address.
  effectsOf(ctx).after.push(async () => {
    const { accounts, mailer } = coreState(ctx);
    const row = accounts.userByEmail(emailNorm);
    if (!row) return;
    // At most a few reset mails per account per hour, whoever asks.
    if (!ctx.services.rateLimit.take(`reset-mail:user:${row.id}`, 3, HOUR)) return;
    const token = accounts.issueEmailToken(row, 'password_reset');
    await mailer.send({
      to: row.email,
      template: 'password_reset',
      lang: row.ui_language === 'en' ? 'en' : 'fil',
      vars: { displayName: row.display_name, link: mailLink(ctx.config, 'password_reset', token) },
    });
  });
  return { ok: true as const };
};

export const reset: Handler<'auth.reset'> = async (ctx, { body }) => {
  limitByAddress(ctx, 'reset', 30, HOUR);
  const { accounts, hasher } = coreState(ctx);
  // Look first, so a password that fails the policy does not burn the link.
  const candidate = accounts.peekEmailToken(body.token, 'password_reset');
  if (!candidate)
    throw new HttpError('invalid_input', BAD_LINK, { reason: 'link_invalid_or_expired' });
  requirePolicy(body.password, { email: candidate.email, displayName: candidate.display_name });
  const passwordHash = await hasher.hash(body.password);

  const row = accounts.consumeEmailToken(body.token, 'password_reset');
  if (!row) throw new HttpError('invalid_input', BAD_LINK, { reason: 'link_invalid_or_expired' });
  accounts.setPassword(row.id, passwordHash);
  // The link proved who holds the mailbox.
  if (row.email_verified !== 1) accounts.markEmailVerified(row.id);
  // Whoever knew the old password is signed out everywhere.
  const ended = accounts.revokeAllSessions(row.id);
  ctx.log.info('password_reset', { userId: row.id, sessions: ended });
  return { ok: true as const };
};

export const changePassword: Handler<'auth.changePassword'> = async (ctx, { body }) => {
  const user = requireUser(ctx);
  const { accounts, hasher } = coreState(ctx);
  limit(ctx, `password-change:user:${user.id}`, 10, HOUR);
  const row = accounts.userById(user.id);
  if (!row) throw new HttpError('unauthenticated', 'Please sign in again.');
  if (!row.password_hash) {
    // An account without a password proves the mailbox instead: the reset link sets the first password.
    throw new HttpError(
      'forbidden',
      'This account has no password yet. Use "Forgot password" to set one by email.',
      { reason: 'no_password' }
    );
  }
  if (!(await hasher.verify(row.password_hash, body.currentPassword))) {
    throw new HttpError('forbidden', 'The current password is not right.', {
      reason: 'wrong_password',
    });
  }
  requirePolicy(body.newPassword, { email: row.email, displayName: row.display_name });
  accounts.setPassword(row.id, await hasher.hash(body.newPassword));
  const ended = accounts.revokeAllSessions(row.id, { except: user.sessionId });
  ctx.log.info('password_changed', { userId: row.id, sessions: ended });
  return { ok: true as const };
};
