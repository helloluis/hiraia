'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { Banner, Button, TextInput, Waiting } from '@/components/ui';
import { useAuthForm, validEmail } from './useAuthForm';
import { GoogleButton } from './GoogleButton';
import { GoogleLinkStep } from './GoogleLinkStep';
import { idTokenEmail } from './google';
import { errorKey, errorReason } from '@/data/errors';

export function SignInScreen() {
  const { t } = useT();
  const router = useRouter();
  const { signIn, signInWithGoogle, status, sessionLapsed } = useSession();
  const [link, setLink] = useState<{ idToken: string; email: string } | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const form = useAuthForm();

  useEffect(() => {
    if (status === 'signedIn' && !sessionLapsed) router.replace('/week');
  }, [status, sessionLapsed, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validEmail(email)) return setFieldError(t('auth.emailInvalid'));
    if (!password) return setFieldError(t('auth.required'));
    setFieldError(null);
    const ok = await form.run(() => signIn(email.trim(), password), { unauthenticated: 'auth.invalid' });
    if (ok) router.replace('/week');
  };

  const onGoogle = async (idToken: string) => {
    setGoogleError(null);
    try {
      await signInWithGoogle(idToken);
      router.replace('/week');
    } catch (err) {
      const reason = errorReason(err);
      if (reason === 'link_required') setLink({ idToken, email: idTokenEmail(idToken) });
      else setGoogleError(t(errorKey(err)));
    }
  };

  if (link) return <GoogleLinkStep idToken={link.idToken} email={link.email} onLinked={() => router.replace('/week')} onCancel={() => setLink(null)} />;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-display">{t('auth.signIn')}</h1>
      <p className="text-forestMuted">{t('app.tagline')}</p>
      <GoogleButton onCredential={id => void onGoogle(id)} text="signin_with" />
      {googleError && <Banner kind="warn">{googleError}</Banner>}
      <TextInput label={t('auth.email')} type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} error={fieldError && !validEmail(email) ? fieldError : undefined} required />
      <TextInput label={t('auth.password')} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} error={fieldError && validEmail(email) ? fieldError : undefined} required />
      {form.error && <Banner kind="error">{form.error}</Banner>}
      {form.busy ? <Waiting label={t('common.waiting')} onCancel={form.cancel} /> : null}
      <Button type="submit" variant="primary" full busy={form.busy}>
        {t('auth.signIn')}
      </Button>
      <Link href="/reset-password" className="min-h-touch inline-flex items-center text-talaTealText underline">
        {t('auth.forgot')}
      </Link>
      <p className="pt-2 border-t border-hairline">
        {t('auth.noAccount')}{' '}
        <Link href="/register" className="text-talaTealText underline min-h-touch inline-flex items-center">
          {t('auth.register')}
        </Link>
      </p>
    </form>
  );
}
