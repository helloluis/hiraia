import { ArtifactScreen } from '@/features/community/ArtifactScreen';

export default async function Page({ params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  return <ArtifactScreen artifactId={artifactId} />;
}
