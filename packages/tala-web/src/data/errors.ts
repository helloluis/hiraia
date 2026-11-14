/**
 * Plain-language failure messages (RES-9, SIMPLE-6). Server messages are English; the client localises by
 * `code` and the stable `details.reason` strings the core module sends (kernel CONTRACT-REQUESTS §5).
 */
import { TalaApiError } from '@hiraia/tala-core/contracts';
import type { StringKey } from '@/i18n/en';

const REASONS: Record<string, StringKey> = {
  email_taken: 'auth.emailTaken',
  invalid_credentials: 'auth.invalid',
  password_too_common: 'auth.passwordCommon',
  password_too_simple: 'auth.passwordCommon',
  password_matches_account: 'auth.passwordCommon',
  link_invalid_or_expired: 'auth.resetBadLink',
  wrong_password: 'auth.wrongPassword',
  rate_limited: 'error.rateLimited',
  account_deleted: 'auth.failed',
  revoked: 'network.readOnly',
  expired: 'network.readOnly',
  no_credentials: 'network.readOnly',
  cross_site: 'error.generic',
  body_too_large: 'error.generic',
  google_sign_in_not_available: 'google.unavailable',
  google_not_configured: 'google.notConfigured',
  google_unreachable: 'google.unreachable',
  google_token_invalid: 'google.tokenInvalid',
  google_email_not_verified: 'google.emailNotVerified',
  verify_email_first: 'google.verifyFirst',
  google_already_linked: 'google.alreadyLinked',
  google_in_use: 'google.inUse',
  no_account_to_link: 'google.noAccount',
  last_sign_in_method: 'google.lastMethod',
  account_merged: 'google.accountMerged',
  other_account_not_proven: 'merge.notProven',
  same_account: 'merge.same',
  merge_proof_missing: 'merge.proofMissing',
};

/** The stable `details.reason` of an API error, if any. */
export function errorReason(err: unknown): string | null {
  if (err instanceof TalaApiError)
    return (err.details as { reason?: string } | undefined)?.reason ?? null;
  return null;
}

export function errorKey(err: unknown): StringKey {
  if (err instanceof TalaApiError) {
    const reason = (err.details as { reason?: string } | undefined)?.reason;
    if (reason && REASONS[reason]) return REASONS[reason]!;
    switch (err.code) {
      case 'network':
      case 'timeout':
      case 'unavailable':
        return 'network.offline';
      case 'rate_limited':
        return 'error.rateLimited';
      case 'unauthenticated':
        return 'auth.invalid';
      case 'conflict':
        return 'auth.emailTaken';
      case 'not_implemented':
        return 'common.comingSoonBody';
      default:
        return 'error.generic';
    }
  }
  return 'error.generic';
}
