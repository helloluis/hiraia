import type { ReactNode } from 'react';
import { AppShell } from '@/features/shell/AppShell';

/** Signed-in area. The shell (nav, banners, sync indicator) is server-rendered; data hydrates from the device. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
