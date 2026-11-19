'use client';
/**
 * The library is open to everyone: signed-in teachers see it inside the app (navigation, sync indicator); visitors
 * see it on the public site, so a teacher can read and download a Ready pack before registering.
 */
import type { ReactNode } from 'react';
import { useSession } from '@/data/session';
import { AppShell } from '@/features/shell/AppShell';
import { PublicShell } from '@/features/landing/PublicShell';

export function LibraryShell({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === 'signedIn') return <AppShell wide>{children}</AppShell>;
  return (
    <PublicShell>
      <div className="w-full max-w-[76rem] mx-auto px-4 py-5 wide:px-8">{children}</div>
    </PublicShell>
  );
}
