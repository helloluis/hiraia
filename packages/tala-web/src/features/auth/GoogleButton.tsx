'use client';
/** "Continue with Google" — shown only when `config.features.googleSignIn` is on. Falls back to a plain message. */
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { Banner } from '@/components/ui';
import { GOOGLE_CLIENT_ID, renderGoogleButton } from './google';

export function GoogleButton({ onCredential, text }: { onCredential: (idToken: string) => void; text?: 'continue_with' | 'signin_with' | 'signup_with' }) {
  const { t, lang } = useT();
  const { config } = useSession();
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed' | 'unconfigured'>('loading');
  const enabled = config?.features.googleSignIn === true;
  useEffect(() => {
    if (!enabled || !ref.current) return;
    if (!GOOGLE_CLIENT_ID) return setState('unconfigured');
    let alive = true;
    renderGoogleButton(ref.current, onCredential, { locale: lang === 'fil' ? 'fil' : 'en', text })
      .then(() => alive && setState('ready'))
      .catch(() => alive && setState('failed'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lang]);
  if (!enabled) return null;
  return (
    <div className="flex flex-col gap-2">
      <div ref={ref} aria-label={t('google.continue')} className="min-h-touch flex justify-center" />
      {state === 'loading' && <p className="text-small text-forestMuted text-center">{t('google.loading')}</p>}
      {state === 'failed' && <Banner kind="info">{t('google.unreachable')}</Banner>}
      {state === 'unconfigured' && <Banner kind="info">{t('google.notConfigured')}</Banner>}
      <p className="text-center text-small text-forestMuted" aria-hidden="true">
        — {t('google.or')} —
      </p>
    </div>
  );
}
