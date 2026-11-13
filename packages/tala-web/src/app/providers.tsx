'use client';
import type { ReactNode } from 'react';
import { LangProvider } from '@/i18n';
import { SessionProvider } from '@/data/session';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LangProvider>
      <SessionProvider>{children}</SessionProvider>
    </LangProvider>
  );
}
