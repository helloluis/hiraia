import { PackScreen } from '@/features/library/PackScreen';

export default async function Page({ params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  return <PackScreen packId={packId} />;
}
