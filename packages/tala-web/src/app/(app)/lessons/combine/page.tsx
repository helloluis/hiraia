import { Suspense } from 'react';
import { CombineScreen } from '@/features/lessons/CombineScreen';

export default function Page() {
  return (
    <Suspense>
      <CombineScreen />
    </Suspense>
  );
}
