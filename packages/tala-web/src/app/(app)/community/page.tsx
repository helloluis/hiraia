import { Suspense } from 'react';
import { CommunityScreen } from '@/features/community/CommunityScreen';

export const metadata = { title: 'Community' };

export default function Page() {
  return (
    <Suspense>
      <CommunityScreen />
    </Suspense>
  );
}
