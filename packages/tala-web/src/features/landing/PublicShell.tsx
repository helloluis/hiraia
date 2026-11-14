'use client';
/** Public pages (home, download): hiraia.org-style header and footer. No auth, no app chrome. */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import { useSession } from '@/data/session';
import { HiraiaGlyph, TalaWordmark } from '@/components/Brand';
import { LanguageSwitch } from '@/features/auth/LanguageSwitch';

export function PublicShell({ children }: { children: ReactNode }) {
  const { t } = useT();
  const { status } = useSession();
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 wide:px-8">
        <Link href="/" className="flex items-center gap-2 min-h-touch">
          <HiraiaGlyph size={28} />
          <TalaWordmark height={24} />
        </Link>
        <div className="flex flex-wrap items-center gap-2">
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
      <footer className="px-4 py-10 wide:px-8 border-t border-hairline">
        <div className="mx-auto max-w-5xl flex flex-col gap-3 text-small text-forestMuted">
          <p className="flex items-center gap-2">
            <HiraiaGlyph size={20} />
            <a href="https://hiraia.org" className="underline underline-offset-4 text-talaTealText">
              {t('landing.footerHiraia')}
            </a>
          </p>
          <p>{t('landing.footerDeped')}</p>
          <p>
            <Link href="/download" className="underline underline-offset-4 text-talaTealText">
              {t('landing.download')}
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

/** Uppercase eyebrow label over a section headline (hiraia.org pattern). */
export function Eyebrow({ children, onDark }: { children: ReactNode; onDark?: boolean }) {
  return (
    <p
      className={`text-small font-medium uppercase tracking-[0.12em] ${onDark ? 'text-yellow' : 'text-talaTealText'}`}
    >
      {children}
    </p>
  );
}

/** Benefit-led block: one-line kicker + two or three plain sentences. */
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
      className={`rounded border p-5 flex flex-col gap-2 ${onDark ? 'border-transparent bg-transparent' : 'border-hairline bg-white'}`}
    >
      <p
        className={`text-small font-medium uppercase tracking-[0.12em] flex flex-wrap items-center gap-2 ${onDark ? 'text-yellow' : 'text-talaTealText'}`}
      >
        {kicker}
        {badge && (
          <span className="normal-case tracking-normal rounded-sm bg-yellow text-forest px-2 py-0.5">
            {badge}
          </span>
        )}
      </p>
      <p className={`text-body leading-relaxed ${onDark ? 'text-cream' : 'text-forest'}`}>{body}</p>
    </div>
  );
}
