'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { Banner, Button, TextInput, Waiting } from '@/components/ui';
import { useAuthForm } from './useAuthForm';

/** Emailed link is `<origin>/verify-email#token=…`: the token stays in the fragment and is posted from here. */
export function VerifyEmailScreen() {
  const { t } = useT();
  const router = useRouter();
  const { user, refreshUser, status } = useSession();
  const [code, setCode] = useState('');
  const [done, setDone] = useState(false);
  const [resent, setResent] = useState(false);
  const form = useAuthForm();

  const verify = async (token: string) => {
    const ok = await form.run(async signal => {
      await getClient().call('auth.verifyEmail', { body: { token }, signal });
    }, { invalid_input: 'auth.verifyFailed', not_found: 'auth.verifyFailed' } as never);
    if (ok) {
      setDone(true);
      await refreshUser();
    }
  };

  useEffect(() => {
    const readHash = () => {
      const m = window.location.hash.match(/token=([^&]+)/);
      if (!m?.[1]) return;
      const token = decodeURIComponent(m[1]);
      setCode(token);
      void verify(token);
      history.replaceState(null, '', window.location.pathname);
    };
    readHash();
    // The link may also arrive while this page is already open (same tab, hash-only navigation).
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resend = async () => {
    const ok = await form.run(async signal => {
      await getClient().call('auth.sendVerification', { signal });
    });
    if (ok) setResent(true);
  };

  if (done || user?.emailVerified) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-display">{t('auth.verifyTitle')}</h1>
        <Banner kind="success">{t('auth.verified')}</Banner>
        <Button variant="primary" full onClick={() => router.replace('/week')}>
          {t('common.done')}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        if (code.trim()) void verify(code.trim());
      }}
      className="flex flex-col gap-4"
    >
      <h1 className="text-display">{t('auth.verifyTitle')}</h1>
      <p>{t('auth.verifyBody', { email: user?.email ?? '' })}</p>
      <TextInput label={t('auth.verifyCode')} value={code} onChange={e => setCode(e.target.value)} autoComplete="one-time-code" inputMode="text" />
      {form.error && <Banner kind="error">{form.error}</Banner>}
      {resent && <Banner kind="success">{t('auth.resent')}</Banner>}
      {form.busy ? <Waiting label={t('common.waiting')} onCancel={form.cancel} /> : null}
      <Button type="submit" variant="primary" full busy={form.busy} disabled={!code.trim()}>
        {t('auth.verify')}
      </Button>
      {status === 'signedIn' && (
        <Button variant="secondary" full onClick={() => void resend()} disabled={form.busy}>
          {t('auth.resend')}
        </Button>
      )}
      <Button variant="quiet" full onClick={() => router.replace(status === 'signedIn' ? '/week' : '/sign-in')}>
        {t('auth.skipForNow')}
      </Button>
    </form>
  );
}
