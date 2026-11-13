'use client';
/** `/link-google` (MAIL_LINK_PATHS.linkGoogle): the emailed link's fragment token is posted to `auth.googleLinkConfirm`. */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { getClient } from '@/data/client';
import { Banner, Placeholder } from '@/components/ui';
import { errorKey } from '@/data/errors';

export function LinkGoogleScreen() {
  const { t } = useT();
  const [state, setState] = useState<'working' | 'done' | 'bad' | 'none'>('working');
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const run = (token: string) => {
      setState('working');
      getClient()
        .call('auth.googleLinkConfirm', { body: { token } })
        .then(() => setState('done'))
        .catch((err) => {
          setMessage(t(errorKey(err)));
          setState('bad');
        });
    };
    const readHash = () => {
      const m = window.location.hash.match(/token=([^&]+)/);
      if (!m?.[1]) return setState('none');
      history.replaceState(null, '', window.location.pathname);
      run(decodeURIComponent(m[1]));
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, [t]);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-display">{t('google.confirmTitle')}</h1>
      {state === 'working' && <Placeholder rows={2} />}
      {state === 'done' && <Banner kind="success">{t('google.confirmBody')}</Banner>}
      {(state === 'bad' || state === 'none') && (
        <Banner kind="warn">{state === 'none' ? t('google.confirmBad') : message}</Banner>
      )}
      <Link
        href="/sign-in"
        className="inline-flex items-center justify-center min-h-touch rounded bg-talaTeal text-white px-4 font-medium"
      >
        {t('auth.signIn')}
      </Link>
    </div>
  );
}
