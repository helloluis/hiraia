'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { getClient } from '@/data/client';
import { Banner, Button, TextInput, Waiting } from '@/components/ui';
import { useAuthForm, validEmail } from './useAuthForm';

/** Request a link, or — when opened from `<origin>/reset-password#token=…` — set the new password. */
export function ResetPasswordScreen() {
  const { t } = useT();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const form = useAuthForm();

  useEffect(() => {
    const readHash = () => {
      const m = window.location.hash.match(/token=([^&]+)/);
      if (!m?.[1]) return;
      setToken(decodeURIComponent(m[1]));
      history.replaceState(null, '', window.location.pathname);
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validEmail(email)) return setFieldError(t('auth.emailInvalid'));
    setFieldError(null);
    const ok = await form.run(async signal => {
      await getClient().call('auth.requestReset', { body: { email: email.trim() }, signal });
    });
    if (ok) setSent(true);
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setFieldError(t('auth.passwordShort'));
    setFieldError(null);
    const ok = await form.run(async signal => {
      await getClient().call('auth.reset', { body: { token: token!, password }, signal });
    }, { invalid_input: 'auth.resetBadLink', not_found: 'auth.resetBadLink' } as never);
    if (ok) setDone(true);
  };

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-display">{t('auth.resetTitle')}</h1>
        <Banner kind="success">{t('auth.resetDone')}</Banner>
        <Link href="/sign-in" className="inline-flex items-center justify-center min-h-touch rounded bg-talaTeal text-white px-4 font-medium">
          {t('auth.signIn')}
        </Link>
      </div>
    );
  }

  if (token) {
    return (
      <form onSubmit={reset} className="flex flex-col gap-4" noValidate>
        <h1 className="text-display">{t('auth.setPassword')}</h1>
        <TextInput label={t('auth.newPassword')} hint={t('auth.passwordHint')} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} error={fieldError ?? undefined} minLength={10} required />
        {form.error && <Banner kind="error">{form.error}</Banner>}
        {form.busy ? <Waiting label={t('common.waiting')} onCancel={form.cancel} /> : null}
        <Button type="submit" variant="primary" full busy={form.busy}>
          {t('auth.setPassword')}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={request} className="flex flex-col gap-4" noValidate>
      <h1 className="text-display">{t('auth.resetTitle')}</h1>
      <p>{t('auth.resetBody')}</p>
      {sent ? (
        <Banner kind="success">{t('auth.resetSent')}</Banner>
      ) : (
        <>
          <TextInput label={t('auth.email')} type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} error={fieldError ?? undefined} required />
          {form.error && <Banner kind="error">{form.error}</Banner>}
          {form.busy ? <Waiting label={t('common.waiting')} onCancel={form.cancel} /> : null}
          <Button type="submit" variant="primary" full busy={form.busy}>
            {t('auth.sendLink')}
          </Button>
        </>
      )}
      <Link href="/sign-in" className="min-h-touch inline-flex items-center text-talaTealText underline">
        ← {t('auth.signIn')}
      </Link>
    </form>
  );
}
