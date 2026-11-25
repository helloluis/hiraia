import { Suspense } from 'react';
import { UploadsScreen } from '@/features/slides/UploadsScreen';

export const metadata = { title: 'My own slides' };

/** A teacher's own uploaded PowerPoint files: the list, and the one place to bring another. Private to the account. */
export default function Page() {
  return (
    <Suspense>
      <UploadsScreen />
    </Suspense>
  );
}
