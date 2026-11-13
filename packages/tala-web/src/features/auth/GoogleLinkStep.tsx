'use client';
/** `link_required` (PRD §13.3 case 1): a confirmed Tala account has this email; prove it once or ask for a mailed link. */
import { useState } from 'react';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { getClient } from '@/data/client';
import { Banner, Button, TextInput, Waiting } from '@/components/ui';
import { useAuthForm } from './useAuthForm';

export function GoogleLinkStep({ idToken, email, onLinked, onCancel }: { idToken: string; email: string; onLinked: () => void; onCancel: () => void }) {
  const { t } = useT();
  const { googleLink } = useSession();
  const [password, setPassword] = useState('');
  const [mailed, setMailed] = useState(false);
  const form = useAuthForm();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async e => {
        e.preventDefault();
        if (!password) return;
        const ok = await form.run(() => googleLink(idToken, password), { unauthenticated: 'auth.invalid' });
        if (ok) onLinked();
      }}
    >
      <h1 className="text-display">{t('google.linkTitle')}</h1>
      <p>{t('google.linkBody', { email })}</p>
      {mailed ? (
        <Banner kind="success">{t('google.linkMailSent')}</Banner>
      ) : (
        <>
          <TextInput label={t('auth.password')} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          {form.error && <Banner kind="error">{form.error}</Banner>}
          {form.busy ? <Waiting label={t('common.waiting')} onCancel={form.cancel} /> : null}
          <Button type="submit" variant="primary" full busy={form.busy} disabled={!password}>
            {t('google.linkWithPassword')}
          </Button>
          <Button
            full
            disabled={form.busy}
            onClick={async () => {
              const ok = await form.run(async signal => {
                await getClient().call('auth.googleLinkRequest', { body: { idToken }, signal });
              });
              if (ok) setMailed(true);
            }}
          >
            {t('google.emailMeLink')}
          </Button>
        </>
      )}
      <Button variant="quiet" onClick={onCancel}>
        {t('common.back')}
      </Button>
    </form>
  );
}
