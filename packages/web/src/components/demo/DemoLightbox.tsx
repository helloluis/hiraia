'use client';

import './demo.css';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useDemoStore } from '@/store/useDemoStore';
import { DemoLoader } from './DemoLoader';
import { BrandLoadingScreen } from '@/components/brand/GrowingGlyph';
import { OnboardingCarousel } from './onboarding/OnboardingCarousel';

/** The dynamic chunk, named once so the warm-up below and the render agree on it. */
const loadCardFeed = () => import('./cards/CardFeedDemo');

// Seed (5 Q1 cards × 8 grades) rides in this chunk. The rest of a grade's first quarter
// is a separate JSON import after language + grade are known. Landing does not pay for it.
const CardFeedDemo = dynamic(() => loadCardFeed().then((m) => m.CardFeedDemo), {
  ssr: false,
  loading: () => <BrandLoadingScreen />,
});

/** Phone-sized demo shell: restore → onboarding → branded loading → card feed. */
export function DemoLightbox() {
  const isOpen = useDemoStore((s) => s.isOpen);
  const restoring = useDemoStore((s) => s.restoring);
  const phase = useDemoStore((s) => s.phase);
  const language = useDemoStore((s) => s.language);
  const grade = useDemoStore((s) => s.grade);
  const closeDemo = useDemoStore((s) => s.closeDemo);
  const pickLanguage = useDemoStore((s) => s.pickLanguage);
  const pickGrade = useDemoStore((s) => s.pickGrade);
  const finishOnboarding = useDemoStore((s) => s.finishOnboarding);

  /**
   * Warm the feed's chunk the moment the demo opens, rather than at the instant it is needed.
   *
   * `dynamic(..., { ssr: false })` on a component that is not in the initial render tree gets
   * no preload link, so the seed chunk only began downloading when the cold-start loader
   * handed off — putting a small generic spinner immediately after the branded one on a slow
   * connection. Onboarding spends that time on the seed download. The rest of the chosen
   * grade's Q1 pack starts after language + grade. Visitors who never open the demo still
   * pay nothing.
   */
  useEffect(() => {
    if (isOpen) void loadCardFeed().catch(() => undefined);
  }, [isOpen]);

  // Close on Escape and lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDemo();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, closeDemo]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Hiraia web demo"
      onClick={closeDemo}
    >
      <div
        className="demo-app relative flex h-[100dvh] w-full min-h-0 flex-col overflow-hidden bg-[var(--board)] shadow-2xl sm:h-[min(92dvh,56rem)] sm:w-[min(100%,25rem)] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button floats over every phase. */}
        <button
          type="button"
          onClick={closeDemo}
          aria-label="Close demo"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur transition-colors hover:bg-black/40"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {restoring ? (
          <BrandLoadingScreen />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {phase === 'onboarding' && (
              <OnboardingCarousel
                initialLanguage={language}
                initialGrade={grade}
                onPickLanguage={pickLanguage}
                onPickGrade={pickGrade}
                onFinish={finishOnboarding}
              />
            )}
            {phase === 'loading' && <DemoLoader />}
            {phase === 'cards' && <CardFeedDemo />}
          </div>
        )}
      </div>
    </div>
  );
}
