import { Suspense } from 'react';
import { RosterImportScreen } from '@/features/roster/RosterImportScreen';

export default function Page() {
  return (
    <Suspense>
      <RosterImportScreen />
    </Suspense>
  );
}
