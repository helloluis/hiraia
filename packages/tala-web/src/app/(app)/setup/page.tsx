import { Suspense } from 'react';
import { SetupScreen } from '@/features/setup/SetupScreen';

export default function Page() {
  return (
    <Suspense>
      <SetupScreen />
    </Suspense>
  );
}
