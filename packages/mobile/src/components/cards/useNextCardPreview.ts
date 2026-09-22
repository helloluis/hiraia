import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import type { Language } from '@hiraia/shared';
import { previewNextPage, useCardStore, type FeedPreview } from '../../store/cardStore';
import { useReviewStore } from '../../reviews/store';
import { warmPage } from '../../data/cards';
import { artSourceFor } from '../../data/artSource';

/** Prepare one read-only neighbour during reading time. Stale async loads never publish. */
export function useNextCardPreview(language: Language): FeedPreview | null {
  const state = useCardStore();
  const review = useReviewStore((s) => s.data);
  const [ready, setReady] = useState<{
    source: typeof state;
    review: typeof review;
    language: Language;
    page: FeedPreview;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Defer selection until the current card has committed. In particular, don't walk
    // the curriculum index in the render or native scroll event handler.
    const timer = setTimeout(() => {
      const page = previewNextPage(language);
      if (!page) return;
      void (async () => {
        await warmPage([
          page.fact?.id,
          ...page.choices.map((c) => c.factId),
          ...(page.lessonRecap?.cardIds ?? []),
        ]);
        const sources = [page.fact?.slug, ...(page.titleCard?.slugs ?? [])]
          .map((slug) => artSourceFor(slug))
          .filter((source) => source !== null);
        await Promise.all(
          sources.map(async (source) => {
            const uri = Image.resolveAssetSource(source)?.uri;
            if (uri) await Image.prefetch(uri).catch(() => false);
          })
        );
        if (!cancelled) setReady({ source: state, review, language, page });
      })().catch((error) => console.warn('[cards] next-page prefetch failed', error));
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, review, language]);
  return ready?.source === state && ready.review === review && ready.language === language
    ? ready.page
    : null;
}
