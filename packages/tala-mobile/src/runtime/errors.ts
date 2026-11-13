import type { StringKey } from '../i18n/en';
/** Never show server English prose or raw codes in the Filipino interface. */
export function messageForError(error: unknown): StringKey {
  if (!error || typeof error !== 'object') return 'failed';
  const e = error as { code?: string; details?: { reason?: string } };
  const reasons: Record<string, StringKey> = {
    email_taken: 'emailTaken',
    invalid_credentials: 'invalidCredentials',
    password_too_common: 'passwordUnsafe',
    password_too_simple: 'passwordUnsafe',
    password_matches_account: 'passwordUnsafe',
    link_invalid_or_expired: 'authLinkExpired',
    wrong_password: 'invalidCredentials',
    rate_limited: 'tryLater',
    account_deleted: 'signInAgain',
    revoked: 'signInAgain',
    expired: 'signInAgain',
    no_credentials: 'signInAgain',
    cross_site: 'signInAgain',
    body_too_large: 'requestTooLarge',
  };
  if (e.details?.reason && reasons[e.details.reason]) return reasons[e.details.reason]!;
  if (e.code === 'unauthenticated') return 'signInAgain';
  if (e.code === 'rate_limited' || e.code === 'quota_exceeded') return 'tryLater';
  return 'failed';
}
