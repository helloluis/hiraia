import { EditorScreen } from '@/features/editor/EditorScreen';

export default async function Page({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  return <EditorScreen planId={planId} />;
}
