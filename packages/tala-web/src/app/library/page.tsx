import { Suspense } from 'react';
import { LibraryScreen } from '@/features/library/LibraryScreen';

export default function Page() {
  return (
    <Suspense>
      <LibraryScreen />
    </Suspense>
  );
}
