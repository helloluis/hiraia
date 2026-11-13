import { Suspense } from 'react';
import { PrintPage } from '@/features/editor/PrintPage';

export default async function Page({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  return (
    <Suspense>
      <PrintPage planId={planId} />
    </Suspense>
  );
}
