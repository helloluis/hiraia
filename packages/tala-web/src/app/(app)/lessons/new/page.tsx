import { Suspense } from 'react';
import { NewLessonScreen } from '@/features/lessons/NewLessonScreen';

export default function Page() {
  return (
    <Suspense>
      <NewLessonScreen />
    </Suspense>
  );
}
