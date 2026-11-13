'use client';
import Link from 'next/link';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { Banner } from '@/components/ui';

/** Short plain banner saying which rung we are on (PRD §14.2.1). Nothing on rung 1. */
export function NetworkBanner() {
  const { t } = useT();
  const { network, sessionLapsed, mergedAway } = useSession();
  if (network.rung === 'readonly') {
    return (
      <div className="px-3 pt-3">
        <Banner
          kind="warn"
          action={
            sessionLapsed && network.online ? (
              <Link
                href="/sign-in"
                className="min-h-touch inline-flex items-center px-3 text-talaTealText underline"
              >
                {t('auth.signIn')}
              </Link>
            ) : undefined
          }
        >
          <strong>{t('network.readOnlyTitle')}.</strong>{' '}
          {mergedAway
            ? t('google.accountMerged')
            : network.readOnlyReason === 'storage_full'
              ? t('network.storageFull')
              : t('network.readOnly')}
        </Banner>
      </div>
    );
  }
  if (network.rung === 'offline')
    return (
      <div className="px-3 pt-3">
        <Banner kind="info">{t('network.offline')}</Banner>
      </div>
    );
  if (network.rung === 'low')
    return (
      <div className="px-3 pt-3">
        <Banner kind="info">{t('network.slow')}</Banner>
      </div>
    );
  return null;
}
