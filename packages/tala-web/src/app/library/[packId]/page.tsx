import { Suspense } from 'react';
import { PackScreen } from '@/features/library/PackScreen';

export default async function Page({ params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  return (
    <Suspense>
      <PackScreen packId={packId} />
    </Suspense>
  );
}
