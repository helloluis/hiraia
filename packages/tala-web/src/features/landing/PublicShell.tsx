'use client';
/** Public pages (home, download): hiraia.org-style header and footer (QVAC mark and the same disclaimer). */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { HiraiaGlyph, TalaWordmark } from '@/components/Brand';
import { LanguageSwitch } from '@/features/auth/LanguageSwitch';

export function PublicShell({
  children,
  overlayHeader,
}: {
  children: ReactNode;
  overlayHeader?: boolean;
}) {
  const { t } = useT();
  const { status } = useSession();
  return (
    <div className="min-h-dvh flex flex-col">
      <header
        className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 wide:px-8 ${overlayHeader ? 'absolute inset-x-0 top-0 z-20' : ''}`}
      >
        <Link href="/" className="flex items-center gap-2 min-h-touch rounded bg-cream px-2">
          <HiraiaGlyph size={28} />
          <TalaWordmark height={24} />
        </Link>
        <div className="flex flex-wrap items-center gap-2 rounded bg-cream px-1">
          <LanguageSwitch />
          <Link
            href={status === 'signedIn' ? '/week' : '/sign-in'}
            className="inline-flex items-center min-h-touch px-3 rounded text-talaTealText underline underline-offset-4"
          >
            {status === 'signedIn' ? t('landing.openWeek') : t('landing.login')}
          </Link>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="border-t-[3px] border-forest px-4 py-10 wide:px-8">
        <div className="mx-auto max-w-5xl flex flex-col gap-6">
          <div className="flex flex-col gap-4 wide:flex-row wide:items-center wide:justify-between">
            <a href="https://qvac.tether.io" className="inline-block opacity-90 hover:opacity-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/built-with-qvac-sdk.png"
                alt={t('landing.builtWithQvac')}
                width={675}
                height={200}
                className="h-10 w-auto wide:h-12"
              />
            </a>
            <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-small uppercase tracking-[0.18em] text-sage">
              <Link href="/" className="hover:text-gold">
                Home
              </Link>
              <Link href="/download" className="hover:text-gold">
                Android
              </Link>
              <a href="https://hiraia.org" className="hover:text-gold">
                hiraia.org
              </a>
            </nav>
          </div>
          <p className="max-w-3xl text-[11px] leading-relaxed text-forestMuted wide:text-xs">
            {t('landing.footerDeped')}
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Benefit-led block: a strong one-line headline and one or two plain sentences. */
export function Feature({
  kicker,
  body,
  badge,
  onDark,
}: {
  kicker: string;
  body: string;
  badge?: string;
  onDark?: boolean;
}) {
  return (
    <div
      className={`rounded-[1rem] p-5 flex flex-col gap-2 ${onDark ? 'bg-transparent' : 'bg-white border border-hairline'}`}
    >
      <h3
        className={`font-display text-[1.25rem] leading-snug flex flex-wrap items-center gap-2 ${onDark ? 'text-yellow' : 'text-forest'}`}
      >
        {kicker}
        {badge && (
          <span className="font-body text-small rounded-sm bg-yellow text-forest px-2 py-0.5">
            {badge}
          </span>
        )}
      </h3>
      <p className={`text-body leading-relaxed ${onDark ? 'text-cream' : 'text-forestMuted'}`}>
        {body}
      </p>
    </div>
  );
}
