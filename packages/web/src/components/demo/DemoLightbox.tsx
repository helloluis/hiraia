'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useDemoStore } from '@/store/useDemoStore';
import { DemoLanguagePicker } from './DemoLanguagePicker';
import { DemoLoader } from './DemoLoader';

// The card feed + its ~1.1 MB of bundled demo data load on demand, client-only, so
// the landing page bundle doesn't pay for a demo the visitor may never open.
const CardFeedDemo = dynamic(() => import('./cards/CardFeedDemo').then((m) => m.CardFeedDemo), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#fdfdf6]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600/30 border-t-primary-600" />
    </div>
  ),
});

/**
 * The "Try the web demo" lightbox: a fixed-overlay modal that runs the whole
 * setup flow — pick language → cold-start loader → the question-cards feed —
 * mirroring the mobile app's first launch. On reopen it briefly restores this
 * browser's prior demo session (keyed by an anonymous localStorage session id).
 */
export function DemoLightbox() {
  const isOpen = useDemoStore((s) => s.isOpen);
  const restoring = useDemoStore((s) => s.restoring);
  const phase = useDemoStore((s) => s.phase);
  const closeDemo = useDemoStore((s) => s.closeDemo);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4 md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Hiraia web demo"
      onClick={closeDemo}
    >
      <div
        className="relative flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(760px,92vh)] sm:max-w-md sm:rounded-3xl"
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
          <div className="flex h-full w-full items-center justify-center bg-[#fdfdf6]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600/30 border-t-primary-600" />
          </div>
        ) : (
          <>
            {phase === 'language' && <DemoLanguagePicker />}
            {phase === 'loading' && <DemoLoader />}
            {phase === 'cards' && <CardFeedDemo />}
          </>
        )}
      </div>
    </div>
  );
}
