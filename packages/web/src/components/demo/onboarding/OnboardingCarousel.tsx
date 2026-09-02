'use client';

/**
 * The web demo's onboarding, printed as THREE PAGES OF THE PAD.
 *
 * A port of the app's packages/mobile/src/components/onboarding/OnboardingCarousel.tsx:
 * language → grade → deck tutorial, ending on a gold Ticket that starts the demo. Picking a
 * language on page 1 advances; picking a grade on page 2 applies it and advances; the Ticket
 * on page 3 dismisses onboarding and hands off to the cold-start loader. The visitor can go
 * back at any time and change either answer.
 *
 * The app prints these three on its mid-century flash-card stock. The browser demo's feed is
 * still the lined notebook pad (see the note at the top of parts.tsx), so these are notebook
 * pages — one product, not two. Gold survives the change of stock because gold is a MEANING
 * ("the ordinary way onward"), not a texture; it appears once, on the Ticket.
 *
 * PAGING: a scroll-snap strip rather than a transform track, so a phone visitor gets the
 * native horizontal swipe for free and the pager stays one element for the keyboard and for
 * assistive tech. All three pages stay mounted (that is what makes a swipe back instant),
 * which is why every page takes an `active` prop — the typewriters and the tutorial loop are
 * gated on it, or three animations would run at once behind the visitor's back.
 *
 * THE LANGUAGE GATE IS ON THE PAGER, not on the NEXT button. Hiding NEXT stops a click and
 * nothing else: the strip was `overflow-x-auto`, so a swipe (or a trackpad flick, or a
 * programmatic scroll) carried a first-time visitor straight past page 1 to the gold Ticket
 * with no language chosen. Pressing it ran the whole demo on the `?? 'tagalog'` fallback and
 * saved nothing, so that visitor was re-onboarded on every visit, forever. Easiest to hit on a
 * phone, which is this demo's primary device. Until a language is picked the strip does not
 * scroll at all (`overflow-x-hidden` still permits the programmatic `scrollLeft` that
 * animateScrollTo uses) and any momentum that lands past page 1 is snapped back.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_GRADE, type GradeLevel } from '@/config/grades';
import type { LanguageKey } from '@/config/model';

import { NAV_BACK, NAV_NEXT } from './copy';
import { GradeSlide } from './GradeSlide';
import { LanguageSlide } from './LanguageSlide';
import { TutorialSlide } from './TutorialSlide';
import { prefersReducedMotion } from './useTypewriter';

const SLIDES = 3;

/** How long a programmatic page change takes. */
const PAGE_MS = 320;

/**
 * Scroll the pager to `left` over PAGE_MS.
 *
 * Hand-rolled rather than `scrollTo({ behavior: 'smooth' })`, which MEASURABLY DOES NOTHING
 * in the WKWebView this demo gets embedded in: a smooth scrollTo on a snap container leaves
 * scrollLeft at 0 there while a direct assignment moves it, so every language/grade pick
 * silently left the visitor looking at page 1 while the dots and the tutorial loop had moved
 * on. Assigning scrollLeft per frame works everywhere.
 *
 * Snapping is switched off for the duration: with `scroll-snap-type: mandatory` the browser
 * re-snaps after each assignment, which would yank a half-finished animation to whichever
 * page it had passed the midpoint of. It is restored on the frame the animation lands.
 *
 * Returns a cancel function — a visitor who starts swiping mid-animation must win.
 */
function animateScrollTo(el: HTMLElement, left: number): () => void {
  if (prefersReducedMotion()) {
    el.scrollLeft = left;
    return () => {};
  }
  const from = el.scrollLeft;
  const delta = left - from;
  if (delta === 0) return () => {};

  const startedAt = performance.now();
  const snap = el.style.scrollSnapType;
  el.style.scrollSnapType = 'none';
  let frame = 0;
  const done = () => {
    el.style.scrollSnapType = snap;
  };
  const step = (now: number) => {
    const t = Math.min(1, (now - startedAt) / PAGE_MS);
    // ease-out cubic: quick off the mark, settles rather than stops
    el.scrollLeft = from + delta * (1 - Math.pow(1 - t, 3));
    if (t < 1) frame = requestAnimationFrame(step);
    else done();
  };
  frame = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(frame);
    done();
  };
}

export function OnboardingCarousel({
  initialLanguage,
  initialGrade,
  onPickLanguage,
  onPickGrade,
  onFinish,
}: {
  /** A language already on file (the visitor reopened onboarding to change it). */
  initialLanguage: LanguageKey | null;
  initialGrade: GradeLevel | null;
  onPickLanguage: (lang: LanguageKey) => void;
  onPickGrade: (grade: GradeLevel) => void;
  onFinish: () => void;
}) {
  const pager = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  // The language driving pages 2-3's copy: whatever is on file, else Tagalog (the default).
  const [lang, setLang] = useState<LanguageKey>(initialLanguage ?? 'tagalog');
  // Whether a language has actually been CHOSEN — pre-set, or picked here. Gates NEXT on
  // page 1 so a first-time visitor cannot skip past the one question with no default.
  const [chosen, setChosen] = useState(initialLanguage != null);
  const [grade, setGrade] = useState<GradeLevel>(initialGrade ?? DEFAULT_GRADE);
  // Which language page 1's cycling question is in. Owned here, not by the page, because the
  // page stays mounted while the visitor is elsewhere.
  const [cycle, setCycle] = useState(0);

  /** Cancels the page change in flight, if any (see animateScrollTo). */
  const cancelScroll = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelScroll.current?.(), []);

  const goTo = useCallback((i: number) => {
    const el = pager.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(SLIDES - 1, i));
    cancelScroll.current?.();
    cancelScroll.current = animateScrollTo(el, clamped * el.clientWidth);
    // Set it optimistically too: the scroll is animated, and the pages read `active` to
    // decide whether to run their typewriter or their loop — waiting for onScroll would
    // start page 3's tutorial a third of a second late every time.
    setIndex(clamped);
  }, []);

  const handlePickLanguage = (picked: LanguageKey) => {
    setLang(picked);
    setChosen(true);
    onPickLanguage(picked);
    goTo(1);
  };

  const handlePickGrade = (picked: GradeLevel) => {
    setGrade(picked);
    onPickGrade(picked);
    goTo(2);
  };

  const showBack = index > 0;
  // NEXT: page 1 needs a real language pick; every later page shows it immediately, because
  // Grade 5 is a real default and tapping a grade is optional. The last page has its Ticket.
  const showNext = index === 0 ? chosen : index < SLIDES - 1;

  // Desktop visitors have no swipe, and the BACK/NEXT plates are small — arrow keys are the
  // pager's keyboard equivalent. Escape stays the lightbox's (it closes the whole demo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && showNext) goTo(index + 1);
      else if (e.key === 'ArrowLeft' && showBack) goTo(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, index, showBack, showNext]);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-[var(--board)]">
      <div
        ref={pager}
        onScroll={(e) => {
          const el = e.currentTarget;
          // Belt and braces to the overflow gate below: a fling started before the pick, or a
          // browser that scrolls a hidden-overflow box anyway, cannot land past page 1.
          if (!chosen && el.scrollLeft > 0) {
            el.scrollLeft = 0;
            setIndex(0);
            return;
          }
          if (el.clientWidth > 0) setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
        // A visitor who starts swiping (or spins a trackpad) mid-animation wins: their
        // gesture and a running rAF scroll would otherwise fight each other frame by frame.
        onPointerDown={() => cancelScroll.current?.()}
        onWheel={() => cancelScroll.current?.()}
        className={`flex flex-1 snap-x snap-mandatory overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
          chosen ? 'overflow-x-auto' : 'overflow-x-hidden'
        }`}
      >
        <div className="w-full shrink-0 snap-center p-3">
          <div className="mc-card flex h-full flex-col overflow-hidden">
            <div className="mc-keyline" aria-hidden />
            <div className="mc-hole mc-hole-a" aria-hidden />
            <div className="mc-hole mc-hole-b" aria-hidden />
          <LanguageSlide
            active={index === 0}
            picked={chosen ? lang : null}
            cycle={cycle}
            onCycle={() => setCycle((c) => c + 1)}
            onPick={handlePickLanguage}
          />
          </div>
        </div>
        <div className="w-full shrink-0 snap-center p-3">
          <div className="mc-card flex h-full flex-col overflow-hidden">
            <div className="mc-keyline" aria-hidden />
            <div className="mc-hole mc-hole-a" aria-hidden />
            <div className="mc-hole mc-hole-b" aria-hidden />
          <GradeSlide
            language={lang}
            selected={grade}
            active={index === 1}
            onPick={handlePickGrade}
          />
          </div>
        </div>
        <div className="w-full shrink-0 snap-center p-3">
          <div className="mc-card flex h-full flex-col overflow-hidden">
            <div className="mc-keyline" aria-hidden />
            <div className="mc-hole mc-hole-a" aria-hidden />
            <div className="mc-hole mc-hole-b" aria-hidden />
          <TutorialSlide language={lang} active={index === 2} onStart={onFinish} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="w-[100px]">
          {showBack && (
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border-2 border-[var(--ink)] bg-[var(--stock)] font-zilla text-[14px] font-bold tracking-[0.06em] text-[var(--ink)]"
            >
              <span aria-hidden>◀</span>
              {NAV_BACK}
            </button>
          )}
        </div>

        {/* The dots: unlit grey, the current one lit gold and stretched. */}
        <div className="flex flex-1 items-center justify-center gap-2" aria-hidden>
          {Array.from({ length: SLIDES }, (_, i) => (
            <span
              key={i}
              className={`h-[8px] rounded-full transition-all ${
                i === index ? 'w-[22px] bg-[var(--gold)]' : 'w-[8px] bg-[var(--stock)]/25'
              }`}
            />
          ))}
        </div>

        <div className="w-[100px]">
          {showNext && (
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border-2 border-[var(--ink)] bg-[var(--gold)] font-zilla text-[14px] font-bold tracking-[0.06em] text-[var(--ink)]"
            >
              {NAV_NEXT}
              <span aria-hidden>▶</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
