import { Suspense } from 'react';
import { GenerateScreen } from '@/features/generate/GenerateScreen';

export default function Page() {
  return (
    <Suspense>
      <GenerateScreen />
    </Suspense>
  );
}
