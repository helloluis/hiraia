/**
 * Google sign-in and account linking (PRD §13.3, AUTH-9 to AUTH-13), and joining two accounts.
 * OWNER: workstream A. Token verification is in google.ts; this file is what happens after it.
 *
 * The seven numbered cases of §13.3, and where each lives:
 *  1. Same email, Tala email confirmed  → `auth.google` answers 409 `link_required`; the teacher proves the
 *     Tala account once, by password (`auth.googleLink`) or by an emailed link (`auth.googleLinkRequest` then
 *     `auth.googleLinkConfirm`). Both ways of signing in work afterwards.
 *  2. Same email, Tala email NOT confirmed → never linked: 409 `verify_email_first`. Someone who signed up
 *     with another person's address must not inherit that person's Google sign-in.
 *  3. Different emails → only from Settings while signed in, after the password: `auth.googleConnect`.
 *     One Google identity belongs to one Tala account, and an account holds one Google identity.
 *  4. Two accounts already → `account.merge`, after proving control of the other one.
 *  5. Remove a method → `auth.googleDisconnect`, `auth.removePassword`; refused if it is the last one.
 *  6. No forced migration → nothing here touches the password; email sign-in keeps working.
 *  7. Mobile → linking adds a row and changes nothing about existing sessions, so nothing is re-downloaded.
 *
 * Rule that keeps case 2 honest everywhere: a Google identity is only ever attached to an account whose
 * email is confirmed. An account made by Google sign-in is confirmed from the start (AUTH-10).
 *
 * A Google account's email domain confers nothing (AUTH-13): no claim other than the subject, the email and
 * the name is read.
 */
import type { Id } from '@hiraia/tala-core';
import { effectsOf, modulesBlockingMerge, runAccountMergedHooks } from '../../kernel/auth';
import { HttpError, requireUser } from '../../kernel/types';
import type { Ctx, Handler } from '../../kernel/types';
import { deviceLabelFrom, normaliseEmail } from './accounts';
import type { UserRow } from './accounts';
import { BAD_CREDENTIALS, BAD_LINK, authResult, cleanDisplayName, limit, limitByAddress, passwordMatches, seedProfile } from './auth-handlers';
import type { GoogleIdentity } from './google';
import { mailLink } from './mailer';
import { PENDING_ROUTES } from './pending-routes';
import type { PendingBody, PendingRouteName } from './pending-routes';
import { coreState } from './state';
import type { CoreState } from './state';

const HOUR = 3600;
const GOOGLE = 'google';

const MESSAGES = {
  off: 'Signing in with Google is not available yet. Please use your email and password.',
  notConfigured: 'Signing in with Google is not set up yet. Please use your email and password.',
  unreachable: 'We could not reach Google just now. Please try again in a moment, or use your email and password.',
  refused: 'We could not confirm your Google sign-in. Please try again.',
  googleEmailUnconfirmed: 'Google has not confirmed the email of this Google account yet. Confirm it with Google first, or use your email and password.',
  linkRequired: 'You already have a Tala account with this email. Enter your Tala password once to connect Google to it.',
  verifyFirst: 'There is a Tala account with this email, but its email is not confirmed yet. Sign in with your password and confirm the email (or use "Forgot password"), then connect Google.',
  otherGoogle: 'This Tala account is already connected to a different Google account.',
  googleInUse: 'That Google account is already connected to another Tala account.',
  noAccount: 'There is no Tala account with this email yet. Choose "Continue with Google" to create one.',
  wrongPassword: 'The password is not right.',
  confirmEmailBeforeConnect: 'Confirm your email first, then connect Google.',
  lastMethodGoogle: 'Google is the only way into this account. Set a password first (use "Forgot password"), then you can disconnect Google.',
  lastMethodPassword: 'The password is the only way into this account. Connect Google first, then you can remove the password.',
  mergeUnavailable: 'Joining two accounts is not available yet.',
  mergeProof: 'We could not confirm the other account. Check its email and password and try again.',
  mergeSame: 'That is the account you are signed in to.',
} as const;

function requireGoogle(ctx: Ctx): CoreState {
  if (!ctx.config.features.googleSignIn) throw new HttpError('not_implemented', MESSAGES.off, { reason: 'google_sign_in_not_available' });
  const state = coreState(ctx);
  if (state.googleClientIds.length === 0) throw new HttpError('unavailable', MESSAGES.notConfigured, { reason: 'google_not_configured' });
  return state;
}

/** Verify an ID token or answer why not. The token itself is never logged, only the kind of problem. */
async function verifiedIdentity(ctx: Ctx, idToken: string): Promise<GoogleIdentity> {
  const result = await coreState(ctx).google.verify(idToken);
  if (result.ok) return result.identity;
  ctx.log.warn('google_token_refused', { problem: result.problem });
  if (result.problem === 'keys_unavailable') throw new HttpError('unavailable', MESSAGES.unreachable, { reason: 'google_unreachable' });
  if (result.problem === 'email_not_verified') throw new HttpError('forbidden', MESSAGES.googleEmailUnconfirmed, { reason: 'google_email_not_verified' });
  throw new HttpError('unauthenticated', MESSAGES.refused, { reason: 'google_token_invalid' });
}

function signIn(ctx: Ctx, row: UserRow, deviceLabel: string) {
  const { accounts } = coreState(ctx);
  const session = accounts.issueSession(row.id, deviceLabelFrom(deviceLabel, effectsOf(ctx).userAgent));
  ctx.log.info('signed_in_with_google', { userId: row.id });
  return authResult(ctx, accounts.toUser(row), session);
}

const userOut = (ctx: Ctx, userId: Id) => {
  const { accounts } = coreState(ctx);
  const row = accounts.userById(userId);
  if (!row) throw new HttpError('unauthenticated', 'Please sign in again.');
  return { user: accounts.toUser(row) };
};

function signedInRow(ctx: Ctx): UserRow {
  const row = coreState(ctx).accounts.userById(requireUser(ctx).id);
  if (!row) throw new HttpError('unauthenticated', 'Please sign in again.');
  return row;
}

/** Why a Google identity cannot simply be attached to the account that has its email, if it cannot. */
function linkObstacle(ctx: Ctx, account: UserRow): HttpError | null {
  const { accounts } = coreState(ctx);
  if (accounts.identityOfUser(account.id, GOOGLE)) return new HttpError('conflict', MESSAGES.otherGoogle, { reason: 'google_already_linked' });
  if (account.email_verified !== 1) return new HttpError('conflict', MESSAGES.verifyFirst, { reason: 'verify_email_first' });
  return null;
}

/* ---------------- auth.google (in the contract) ---------------- */

export const googleSignIn: Handler<'auth.google'> = async (ctx, { body }) => {
  const { accounts } = requireGoogle(ctx);
  limitByAddress(ctx, 'google', ctx.config.abuse.loginPerIpPerMinute, 60);
  const identity = await verifiedIdentity(ctx, body.idToken);

  // Twice at most: the second pass is for losing a race with another first sign-in for the same address.
  for (let attempt = 0; attempt < 2; attempt++) {
    const linked = accounts.identityBySubject(GOOGLE, identity.subject);
    if (linked) {
      const row = accounts.userById(linked.user_id);
      if (!row) throw new HttpError('unauthenticated', MESSAGES.refused, { reason: 'google_token_invalid' });
      // The identity is the subject. If the Google account's address changed, note it; the Tala account's own email stays.
      if (linked.email !== identity.email) accounts.rememberIdentityEmail(GOOGLE, identity.subject, identity.email);
      return signIn(ctx, row, body.deviceLabel);
    }

    const existing = accounts.userByEmail(identity.email);
    if (existing) {
      const obstacle = linkObstacle(ctx, existing);
      if (obstacle) throw obstacle;
      // Case 1: same, confirmed email. Never attached on Google's word alone.
      throw new HttpError('conflict', MESSAGES.linkRequired, { reason: 'link_required', methods: existing.password_hash ? ['password', 'email_link'] : ['email_link'] });
    }

    // AUTH-10: a new Google sign-in creates an account whose email is already confirmed.
    const displayName = cleanDisplayName(identity.name ?? identity.email.split('@')[0] ?? 'Teacher');
    const created = ctx.db
      .transaction((): UserRow | null => {
        const row = accounts.createUser({ email: identity.email, displayName, uiLanguage: 'fil', passwordHash: null, emailVerified: true });
        if (!row) return null;
        if (!accounts.attachIdentity(row.id, GOOGLE, identity.subject, identity.email)) throw new Error('identity taken during account creation');
        seedProfile(ctx, row.id, displayName, 'fil');
        return row;
      })
      .immediate();
    if (created) {
      ctx.log.info('account_created_with_google', { userId: created.id });
      return signIn(ctx, created, body.deviceLabel);
    }
  }
  throw new HttpError('conflict', MESSAGES.linkRequired, { reason: 'link_required', methods: ['password', 'email_link'] });
};

/* ---------------- routes waiting for the contract (pending-routes.ts) ---------------- */

type PendingHandler<K extends PendingRouteName> = (ctx: Ctx, body: PendingBody<K>) => unknown;

/** Case 1 by password. */
const googleLink: PendingHandler<'auth.googleLink'> = async (ctx, body) => {
  const { accounts } = requireGoogle(ctx);
  limitByAddress(ctx, 'google', ctx.config.abuse.loginPerIpPerMinute, 60);
  const identity = await verifiedIdentity(ctx, body.idToken);

  const linked = accounts.identityBySubject(GOOGLE, identity.subject);
  if (linked) {
    // Already connected (a repeated tap): Google's proof is enough to sign in.
    const row = accounts.userById(linked.user_id);
    if (!row) throw new HttpError('unauthenticated', MESSAGES.refused, { reason: 'google_token_invalid' });
    return signIn(ctx, row, body.deviceLabel);
  }
  const account = accounts.userByEmail(identity.email);
  if (!account) throw new HttpError('conflict', MESSAGES.noAccount, { reason: 'no_account_to_link' });
  const obstacle = linkObstacle(ctx, account);
  if (obstacle) throw obstacle;
  if (!(await passwordMatches(ctx, account, account.email_norm, body.password))) {
    throw new HttpError('unauthenticated', BAD_CREDENTIALS, { reason: 'invalid_credentials' });
  }
  if (!accounts.attachIdentity(account.id, GOOGLE, identity.subject, identity.email)) throw new HttpError('conflict', MESSAGES.googleInUse, { reason: 'google_in_use' });
  ctx.log.info('google_linked', { userId: account.id, by: 'password' });
  return signIn(ctx, account, body.deviceLabel);
};

/** Case 1 by emailed link: ask. */
const googleLinkRequest: PendingHandler<'auth.googleLinkRequest'> = async (ctx, body) => {
  requireGoogle(ctx);
  limitByAddress(ctx, 'google-link-request', 20, HOUR);
  const identity = await verifiedIdentity(ctx, body.idToken);
  effectsOf(ctx).after.push(async () => {
    const { accounts, mailer } = coreState(ctx);
    const account = accounts.userByEmail(identity.email);
    if (!account || linkObstacle(ctx, account) || accounts.identityBySubject(GOOGLE, identity.subject)) return;
    if (!ctx.services.rateLimit.take(`link-mail:user:${account.id}`, 3, HOUR)) return;
    // The link remembers which Google account asked, so opening it can only attach that one.
    const token = accounts.issueEmailToken(account, 'link_google', { subject: identity.subject, email: identity.email });
    await mailer.sendAny({
      to: account.email,
      template: 'link_google',
      lang: account.ui_language === 'en' ? 'en' : 'fil',
      vars: { displayName: account.display_name, googleEmail: identity.email, link: mailLink(ctx.config, 'link_google', token) },
    });
  });
  return { ok: true as const };
};

/** Case 1 by emailed link: the link was opened. */
const googleLinkConfirm: PendingHandler<'auth.googleLinkConfirm'> = (ctx, body) => {
  const { accounts } = requireGoogle(ctx);
  limitByAddress(ctx, 'google-link-confirm', 30, HOUR);
  const found = accounts.consumeEmailTokenWithPayload(body.token, 'link_google');
  if (!found || typeof found.payload.subject !== 'string' || typeof found.payload.email !== 'string') {
    throw new HttpError('invalid_input', BAD_LINK, { reason: 'link_invalid_or_expired' });
  }
  const obstacle = linkObstacle(ctx, found.user);
  if (obstacle) throw obstacle;
  if (!accounts.attachIdentity(found.user.id, GOOGLE, found.payload.subject, found.payload.email)) throw new HttpError('conflict', MESSAGES.googleInUse, { reason: 'google_in_use' });
  ctx.log.info('google_linked', { userId: found.user.id, by: 'email_link' });
  return { ok: true as const };
};

/** Case 3: from Settings. */
const googleConnect: PendingHandler<'auth.googleConnect'> = async (ctx, body) => {
  const { accounts } = requireGoogle(ctx);
  const row = signedInRow(ctx);
  limit(ctx, `google-connect:user:${row.id}`, 10, HOUR);
  if (row.email_verified !== 1) throw new HttpError('forbidden', MESSAGES.confirmEmailBeforeConnect, { reason: 'verify_email_first' });
  if (row.password_hash && !(await passwordMatches(ctx, row, row.email_norm, body.password))) {
    throw new HttpError('forbidden', MESSAGES.wrongPassword, { reason: 'wrong_password' });
  }
  const identity = await verifiedIdentity(ctx, body.idToken);
  const mine = accounts.identityOfUser(row.id, GOOGLE);
  if (mine) {
    if (mine.subject === identity.subject) return userOut(ctx, row.id);
    throw new HttpError('conflict', MESSAGES.otherGoogle, { reason: 'google_already_linked' });
  }
  if (!accounts.attachIdentity(row.id, GOOGLE, identity.subject, identity.email)) throw new HttpError('conflict', MESSAGES.googleInUse, { reason: 'google_in_use' });
  ctx.log.info('google_linked', { userId: row.id, by: 'settings' });
  return userOut(ctx, row.id);
};

/** Case 5: remove the Google link. Works even if Google sign-in has since been switched off. */
const googleDisconnect: PendingHandler<'auth.googleDisconnect'> = async (ctx, body) => {
  const { accounts } = coreState(ctx);
  const row = signedInRow(ctx);
  limit(ctx, `google-disconnect:user:${row.id}`, 10, HOUR);
  if (!accounts.identityOfUser(row.id, GOOGLE)) return userOut(ctx, row.id);
  if (!row.password_hash) throw new HttpError('forbidden', MESSAGES.lastMethodGoogle, { reason: 'last_sign_in_method' });
  if (!(await passwordMatches(ctx, row, row.email_norm, body.password))) throw new HttpError('forbidden', MESSAGES.wrongPassword, { reason: 'wrong_password' });
  accounts.detachIdentity(row.id, GOOGLE);
  ctx.log.info('google_unlinked', { userId: row.id });
  return userOut(ctx, row.id);
};

/** Case 5: remove the password. */
const removePassword: PendingHandler<'auth.removePassword'> = async (ctx, body) => {
  const { accounts } = coreState(ctx);
  const row = signedInRow(ctx);
  limit(ctx, `password-remove:user:${row.id}`, 10, HOUR);
  if (!row.password_hash) return userOut(ctx, row.id);
  if (!accounts.identityOfUser(row.id, GOOGLE)) throw new HttpError('forbidden', MESSAGES.lastMethodPassword, { reason: 'last_sign_in_method' });
  if (!(await passwordMatches(ctx, row, row.email_norm, body.currentPassword))) throw new HttpError('forbidden', MESSAGES.wrongPassword, { reason: 'wrong_password' });
  accounts.clearPassword(row.id);
  ctx.log.info('password_removed', { userId: row.id });
  return userOut(ctx, row.id);
};

/** Case 4: join another account of the same teacher into this one. */
const accountMerge: PendingHandler<'account.merge'> = async (ctx, body) => {
  const state = coreState(ctx);
  const { accounts, records } = state;
  const survivor = signedInRow(ctx);
  limit(ctx, `merge:user:${survivor.id}`, 10, HOUR);

  // A module that keeps per-teacher rows but cannot hand them over would leave them orphaned, or we would
  // have to delete them (a teacher's community posts, for one). Neither is acceptable: wait for the module.
  const blocking = modulesBlockingMerge(ctx.db);
  if (blocking.length > 0) throw new HttpError('unavailable', MESSAGES.mergeUnavailable, { reason: 'merge_not_available', modules: blocking });

  // A merge can hand this account a new way in (the other account's Google link). A borrowed, still
  // signed-in device must not be enough for that: the signed-in account proves itself again.
  if (survivor.password_hash && !(await passwordMatches(ctx, survivor, survivor.email_norm, body.currentPassword ?? ''))) {
    throw new HttpError('forbidden', MESSAGES.wrongPassword, { reason: 'wrong_password' });
  }

  let other: UserRow | null = null;
  if (body.idToken !== undefined) {
    requireGoogle(ctx);
    const identity = await verifiedIdentity(ctx, body.idToken);
    const linked = accounts.identityBySubject(GOOGLE, identity.subject);
    other = linked ? accounts.userById(linked.user_id) : null;
  } else if (body.email !== undefined && body.password !== undefined) {
    const emailNorm = normaliseEmail(body.email);
    const candidate = accounts.userByEmail(emailNorm);
    other = (await passwordMatches(ctx, candidate, emailNorm, body.password)) ? candidate : null;
  } else {
    throw new HttpError('invalid_input', 'Give the other account’s email and password, or sign in to it with Google.', { reason: 'merge_proof_missing' });
  }
  if (!other) throw new HttpError('forbidden', MESSAGES.mergeProof, { reason: 'other_account_not_proven' });
  if (other.id === survivor.id) throw new HttpError('invalid_input', MESSAGES.mergeSame, { reason: 'same_account' });

  const from = other;
  const outcome = ctx.db
    .transaction(() => {
      const modules = runAccountMergedHooks(ctx.db, from.id, survivor.id);
      const moved = records.reassignOwner(from.id, survivor.id);
      // The surviving account keeps its own Google link; if it has none, it inherits the other's.
      if (!accounts.identityOfUser(survivor.id, GOOGLE) && accounts.identityOfUser(from.id, GOOGLE)) accounts.moveIdentity(from.id, survivor.id, GOOGLE);
      // Its devices are told the account was joined, not deleted, so they do not throw unsent work away.
      accounts.deleteUser(from, 'account_merged');
      return { modules, moved };
    })
    .immediate();
  ctx.log.info('accounts_merged', { userId: survivor.id, records: outcome.moved.moved, modules: outcome.modules.length });
  return { ...userOut(ctx, survivor.id), movedRecords: outcome.moved.moved };
};

const PENDING_HANDLERS: { [K in PendingRouteName]: PendingHandler<K> } = {
  'auth.googleLink': googleLink,
  'auth.googleLinkRequest': googleLinkRequest,
  'auth.googleLinkConfirm': googleLinkConfirm,
  'auth.googleConnect': googleConnect,
  'auth.googleDisconnect': googleDisconnect,
  'auth.removePassword': removePassword,
  'account.merge': accountMerge,
};

/**
 * Handlers for the pending routes, in the kernel's handler shape. Each validates its body against the spec
 * in pending-routes.ts again: if the contract adopts a route with a different body, the mismatch shows up
 * as a clear 400 instead of undefined behaviour.
 */
export function pendingHandlers(): Record<PendingRouteName, (ctx: Ctx, input: { body: unknown }) => unknown> {
  const out = {} as Record<PendingRouteName, (ctx: Ctx, input: { body: unknown }) => unknown>;
  for (const name of Object.keys(PENDING_HANDLERS) as PendingRouteName[]) {
    out[name] = (ctx, input) => {
      const parsed = PENDING_ROUTES[name].body.safeParse(input.body);
      if (!parsed.success) {
        throw new HttpError('invalid_input', 'Some of the details sent were not right. Please check them and try again.', {
          issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: ['body', ...i.path].join('.'), message: i.message })),
        });
      }
      return (PENDING_HANDLERS[name] as (ctx: Ctx, body: unknown) => unknown)(ctx, parsed.data);
    };
  }
  return out;
}
