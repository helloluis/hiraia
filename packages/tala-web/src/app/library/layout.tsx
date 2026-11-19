import type { ReactNode } from 'react';
import { LibraryShell } from '@/features/library/LibraryShell';

export const metadata = { title: 'Teaching packs' };

export default function LibraryLayout({ children }: { children: ReactNode }) {
  return <LibraryShell>{children}</LibraryShell>;
}
