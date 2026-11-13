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
};

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
