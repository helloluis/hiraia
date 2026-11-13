/**
 * Routes core needs for Google account linking and account merging (PRD §13.3 cases 1 to 5) that are
 * NOT in the contract table yet. OWNER: workstream A; the contract itself is the orchestrator's.
 *
 * To adopt them: copy each entry into `API` in packages/tala-core/src/contracts/api.ts (wrapped in
 * `route(...)`), and add `linkGoogle: '/link-google'` to `MAIL_LINK_PATHS`. The handlers are already
 * written (google-handlers.ts) and register themselves the moment a route with the same name appears in
 * the table: no change is needed here. Until then nothing below is reachable in a real server; tests
 * reach them through `createTestServer({ extraRoutes: PENDING_ROUTES, core: { pendingRoutes: true } })`.
 */
import { AuthResult, Email, Ok, User } from '@hiraia/tala-core';
import type { RouteSpec } from '@hiraia/tala-core';
import { z } from 'zod';

const IdToken = z.string().max(4000);
const PasswordEntry = z.string().max(200);
const UserOut = z.object({ user: User });

export const PENDING_ROUTES = {
  /**
   * Case 1, password path. "Continue with Google" found a Tala account with the same, confirmed email
   * (`auth.google` answered 409 `link_required`). The teacher types their Tala password once; the Google
   * identity is attached and they are signed in.
   */
  'auth.googleLink': {
    method: 'POST', path: '/auth/google/link', auth: 'none', owner: 'core',
    body: z.object({ idToken: IdToken, password: PasswordEntry, deviceLabel: z.string().max(80).default('') }),
    response: AuthResult,
  },
  /**
   * Case 1, emailed-link path (for a teacher who does not remember the password). Always answers ok.
   * If the address has a confirmed Tala account, a single-use 30-minute link is mailed to it.
   */
  'auth.googleLinkRequest': {
    method: 'POST', path: '/auth/google/link/request', auth: 'none', owner: 'core',
    body: z.object({ idToken: IdToken }),
    response: Ok,
  },
  /** The page behind the emailed link posts its token here. The Google identity that asked is attached. */
  'auth.googleLinkConfirm': {
    method: 'POST', path: '/auth/google/link/confirm', auth: 'none', owner: 'core',
    body: z.object({ token: z.string().min(6).max(200) }),
    response: Ok,
  },
  /** Case 3. Settings: connect a Google account (its email may differ) after re-entering the Tala password. */
  'auth.googleConnect': {
    method: 'POST', path: '/auth/google/connect', auth: 'user', owner: 'core',
    body: z.object({ idToken: IdToken, password: PasswordEntry }),
    response: UserOut,
  },
  /** Case 5. Settings: remove the Google link. Refused when Google is the only way into the account. */
  'auth.googleDisconnect': {
    method: 'POST', path: '/auth/google/disconnect', auth: 'user', owner: 'core',
    body: z.object({ password: PasswordEntry }),
    response: UserOut,
  },
  /** Case 5. Settings: remove the password. Refused when the password is the only way into the account. */
  'auth.removePassword': {
    method: 'POST', path: '/auth/password/remove', auth: 'user', owner: 'core',
    body: z.object({ currentPassword: PasswordEntry }),
    response: UserOut,
  },
  /**
   * Case 4. Settings: join another account of the same teacher into the signed-in one.
   * Control of BOTH is proven: the signed-in account by `currentPassword` (required when it has a password),
   * the other by its `email` + `password`, or by a Google `idToken` for the identity linked to it.
   * Records move to the signed-in account; the other account is removed.
   */
  'account.merge': {
    method: 'POST', path: '/account/merge', auth: 'user', owner: 'core',
    body: z.object({
      confirm: z.literal('MERGE'),
      currentPassword: PasswordEntry.optional(),
      email: Email.optional(),
      password: PasswordEntry.optional(),
      idToken: IdToken.optional(),
    }),
    response: z.object({ user: User, movedRecords: z.number().int() }),
  },
} satisfies Record<string, RouteSpec>;

export type PendingRouteName = keyof typeof PENDING_ROUTES;
export type PendingBody<K extends PendingRouteName> = z.output<(typeof PENDING_ROUTES)[K]['body']>;
