'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { Banner, Button, TextInput, Waiting } from '@/components/ui';
import { useAuthForm, validEmail } from './useAuthForm';
import { GoogleButton } from './GoogleButton';
import { GoogleLinkStep } from './GoogleLinkStep';
import { idTokenEmail } from './google';
import { errorKey, errorReason } from '@/data/errors';

export function RegisterScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const { register, signInWithGoogle, config } = useSession();
  const [link, setLink] = useState<{ idToken: string; email: string } | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const form = useAuthForm();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = t('auth.required');
    if (!validEmail(email)) next.email = t('auth.emailInvalid');
    if (password.length < 10) next.password = t('auth.passwordShort');
    setErrors(next);
    if (Object.keys(next).length) return;
    const ok = await form.run(() => register(email.trim(), password, name.trim(), lang), {
      conflict: 'auth.emailTaken',
    });
    if (ok) router.replace(config?.features.emailDelivery === false ? '/week' : '/verify-email');
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

  if (link)
    return (
      <GoogleLinkStep
        idToken={link.idToken}
        email={link.email}
        onLinked={() => router.replace('/week')}
        onCancel={() => setLink(null)}
      />
    );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-display">{t('auth.register')}</h1>
      <GoogleButton onCredential={(id) => void onGoogle(id)} text="signup_with" />
      {googleError && <Banner kind="warn">{googleError}</Banner>}
      <TextInput
        label={t('auth.displayName')}
        hint={t('auth.displayNameHint')}
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        required
      />
      <TextInput
        label={t('auth.email')}
        type="email"
        autoComplete="email"
        inputMode="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
        required
      />
      <TextInput
        label={t('auth.password')}
        hint={t('auth.passwordHint')}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        required
        minLength={10}
      />
      {form.error && <Banner kind="error">{form.error}</Banner>}
      {form.busy ? <Waiting label={t('common.waiting')} onCancel={form.cancel} /> : null}
      <Button type="submit" variant="primary" full busy={form.busy}>
        {t('auth.register')}
      </Button>
      <p className="pt-2 border-t border-hairline">
        {t('auth.haveAccount')}{' '}
        <Link
          href="/sign-in"
          className="text-talaTealText underline min-h-touch inline-flex items-center"
        >
          {t('auth.signIn')}
        </Link>
      </p>
    </form>
  );
}
