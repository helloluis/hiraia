'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { Banner, Button, TextInput, Waiting } from '@/components/ui';
import { useAuthForm, validEmail } from './useAuthForm';

export function RegisterScreen() {
  const { t, lang } = useT();
  const router = useRouter();
  const { register } = useSession();
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
    const ok = await form.run(() => register(email.trim(), password, name.trim(), lang), { conflict: 'auth.emailTaken' });
    if (ok) router.replace('/verify-email');
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-display">{t('auth.register')}</h1>
      <TextInput label={t('auth.displayName')} hint={t('auth.displayNameHint')} autoComplete="name" value={name} onChange={e => setName(e.target.value)} error={errors.name} required />
      <TextInput label={t('auth.email')} type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} error={errors.email} required />
      <TextInput label={t('auth.password')} hint={t('auth.passwordHint')} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} error={errors.password} required minLength={10} />
      {form.error && <Banner kind="error">{form.error}</Banner>}
      {form.busy ? <Waiting label={t('common.waiting')} onCancel={form.cancel} /> : null}
      <Button type="submit" variant="primary" full busy={form.busy}>
        {t('auth.register')}
      </Button>
      <p className="pt-2 border-t border-hairline">
        {t('auth.haveAccount')}{' '}
        <Link href="/sign-in" className="text-talaTealText underline min-h-touch inline-flex items-center">
          {t('auth.signIn')}
        </Link>
      </p>
    </form>
  );
}
