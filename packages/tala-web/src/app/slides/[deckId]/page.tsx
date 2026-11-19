import { Suspense } from 'react';
import { DeckEditorScreen } from '@/features/slides/DeckEditor';

export const metadata = { title: 'My slides' };

/** "Edit my copy": a teacher's own copy of a pack's slides. Its own full-width screen, outside the app shell. */
export default async function Page({ params }: { params: Promise<{ deckId: string }> }) {
  const { deckId } = await params;
  return (
    <Suspense>
      <DeckEditorScreen deckId={deckId} />
    </Suspense>
  );
}
