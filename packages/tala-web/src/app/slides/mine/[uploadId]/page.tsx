import { Suspense } from 'react';
import { UploadEditorScreen } from '@/features/slides/UploadEditor';

export const metadata = { title: 'My own slides' };

/** Editing a teacher's own uploaded PowerPoint file. Its own full-width screen, outside the app shell. */
export default async function Page({ params }: { params: Promise<{ uploadId: string }> }) {
  const { uploadId } = await params;
  return (
    <Suspense>
      <UploadEditorScreen uploadId={uploadId} />
    </Suspense>
  );
}
