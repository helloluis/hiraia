'use client';
import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import { BrandLockup } from '@/components/Brand';
import { LanguageSwitch } from './LanguageSwitch';

export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useT();
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <BrandLockup byline={t('app.byHiraia')} />
        <LanguageSwitch />
      </header>
      <main id="main" className="flex-1 w-full max-w-[28rem] mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
