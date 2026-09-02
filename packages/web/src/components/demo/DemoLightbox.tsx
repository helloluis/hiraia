'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useDemoStore } from '@/store/useDemoStore';
import { DemoLoader } from './DemoLoader';
import { LANG_CHANGE } from './onboarding/copy';
import { OnboardingCarousel } from './onboarding/OnboardingCarousel';

/** The dynamic chunk, named once so the warm-up below and the render agree on it. */
const loadCardFeed = () => import('./cards/CardFeedDemo');

// The card feed + its ~4.7 MB of bundled demo data (cards + MCQ bank + df table) load on
// demand, client-only, so the landing page doesn't pay for a demo the visitor may never open.
const CardFeedDemo = dynamic(() => loadCardFeed().then((m) => m.CardFeedDemo), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[var(--board)]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--gold)]/30 border-t-[var(--gold)]" />
    </div>
  ),
});

/**
 * The "Try the web demo" lightbox: a fixed-overlay modal that runs the whole setup flow —
 * onboarding (language → grade → tutorial) → cold-start loader → the question-cards feed —
 * mirroring the mobile app's first launch. On reopen it briefly restores this browser's
 * prior demo session (keyed by an anonymous localStorage session id).
 *
 * Onboarding runs once per browser (see ONBOARDING_KEY in useDemoStore); the loader runs every
 * time, because on device it is the model actually loading. The loader's "change the language"
 * plate re-runs the whole flow; the feed carries its own language pill for the far commoner
 * case of just wanting a different language (the loader auto-advances in ~6.9 s, so a control
 * that lives only there is a control with an expiry date).
 */
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
  const restartOnboarding = useDemoStore((s) => s.restartOnboarding);

  /**
   * Warm the feed's chunk the moment the demo opens, rather than at the instant it is needed.
   *
   * `dynamic(..., { ssr: false })` on a component that is not in the initial render tree gets
   * no preload link, so the 4.7 MB / 1.5 MB-gzipped chunk only began downloading when the
   * cold-start loader handed off — putting a small generic spinner immediately after a
   * six-second branded one on any slow connection, which is most Philippine mobile links. The
   * onboarding and the loader are between 7 and 60 seconds of screen time that were being
   * spent on nothing; this spends them on the download. Visitors who never open the demo still
   * pay nothing.
   */
  useEffect(() => {
    if (isOpen) void loadCardFeed();
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
        className="relative flex h-[100dvh] w-full min-h-0 flex-col overflow-hidden bg-[var(--board)] shadow-2xl sm:h-[min(92dvh,56rem)] sm:w-[min(100%,28rem)] sm:rounded-3xl"
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
          <div className="flex h-full w-full items-center justify-center bg-[var(--board)]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--gold)]/30 border-t-[var(--gold)]" />
          </div>
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
            {phase === 'loading' && (
              <>
                <DemoLoader />
                <button
                  type="button"
                  onClick={restartOnboarding}
                  className="absolute left-3 top-3 z-10 rounded-full bg-black/25 px-3 py-1.5 font-zilla text-[13px] font-bold text-white backdrop-blur transition-colors hover:bg-black/40"
                >
                  {LANG_CHANGE[language ?? 'tagalog']}
                </button>
              </>
            )}
            {phase === 'cards' && <CardFeedDemo />}
          </div>
        )}
      </div>
    </div>
  );
}
