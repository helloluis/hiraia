'use client';

/**
 * Page 3 of the onboarding pad — the TUTORIAL, and the last page: a self-contained,
 * looping mock of the FEED being turned, plus the gold Ticket that ends onboarding.
 *
 * Ported from the app's packages/mobile/src/components/onboarding/DemoSlide.tsx, which
 * replaced a chat mock for the same reason this one does not use one: the deck is the
 * product, so the tutorial teaches the deck. Pure animation — no store, no feed state, no
 * retrieval.
 *
 * WHAT IT TEACHES, in loop order: press the single blue note (the page lifts off, the next
 * page is already underneath); then, on a FORK, press A; then press B.
 *
 *   - The app's loop has a fourth beat — swipe UP for the next card — and shows two of its
 *     four as swipes, because its feed honours a corner-peel throw from any edge. THE
 *     BROWSER FEED HAS NO DRAG HANDLER: CardFeedDemo turns a page when a teacher's-note
 *     choice is CLICKED, and nothing else moves it. Teaching a swipe here would be the one
 *     lie in the onboarding, so every beat is a press and the fourth beat is dropped rather
 *     than mimed. The app's swipe wording is parked verbatim in the comment on DEMO_HINT,
 *     ready for the day the web feed grows a drag.
 *   - A fork still gets TWO beats, A then B, because the point of a fork is that both are
 *     real and the child picks; one beat would teach a fork as a thing that happens to you.
 *
 * THE PEEL IS THE REAL ONE. The lift is the feed's own `demo-page-peel` geometry — the page
 * hinges on the bottom corner of the note that was pressed, carries past the top of the pad
 * and takes the same 360ms — with the next page already sitting underneath, which is what
 * the outgoing/incoming layer pair in CardFeedDemo actually does.
 *
 * Everything is printed on the same lined pad as the feed's cards, so the pad in the mock
 * and the pad the visitor lands on a second later are the same object.
 */
import { useEffect, useState } from 'react';

import type { LanguageKey } from '@/config/model';

import { DEMO_CAPTION, DEMO_HINT, DEMO_IMAGE_SRC, DEMO_MINI, DEMO_START, SLIDE_BAND } from './copy';
import { PageHeader, SlideBody, Ticket } from './parts';
import { prefersReducedMotion } from './useTypewriter';

/** The three things a visitor can do to a page, in the order the loop teaches them. */
const BEATS = ['next', 'left', 'right'] as const;
type Beat = (typeof BEATS)[number];

/** Which beats are printed on a FORK page (two notes) rather than one centred note. */
const isFork = (b: Beat) => b === 'left' || b === 'right';

/** The loop's phases. `swap` is the one frame spent off-screen changing the page's face. */
type Phase = 'rest' | 'press' | 'peel' | 'swap';

// ---- timings: the peel is the feed's own; the rest is the loop's pacing ----
const FLIP_MS = 360; // matches the .demo-page-peel keyframe CardFeedDemo uses
const HOLD_MS = 780; // how long a page sits at rest before it is acted on
const PRESS_MS = 190; // how long a pressed note stays down
const SWAP_MS = 40; // one frame, off-screen, to change the face before the reset
const BETWEEN_MS = 240; // the breath between one page landing and the next being acted on

/**
 * Where each beat's note sits — as a percentage across the mock, measured to the MIDDLE of
 * the note rather than to its edge (a fork's picks sit hard against the mini page's 26px
 * gutter and its 12px right margin, so their centres land near 16% and 87% at every width
 * the lightbox takes) — and which bottom corner the page therefore hinges on. A single-path page prints ONE note, centred — so
 * turning the page stays a rhythm rather than a decision — and a fork splits its two to the
 * corners, which is exactly what DemoCardPage does at full size.
 */
const NOTE: Record<Beat, { x: number; side: 'left' | 'right' }> = {
  next: { x: 51, side: 'left' },
  left: { x: 16, side: 'left' },
  right: { x: 87, side: 'right' },
};

/** How far a lifted page drifts sideways as it hinges off its corner, and how far it tilts. */
const DRIFT_PCT = 12;
const TILT_DEG = 8;

export function TutorialSlide({
  language,
  active,
  onStart,
}: {
  language: LanguageKey;
  /** True while this page is the one on screen — the loop only runs then. */
  active: boolean;
  onStart: () => void;
}) {
  const mini = DEMO_MINI[language];
  const hint = DEMO_HINT[language];

  const [beat, setBeat] = useState(0);
  const [phase, setPhase] = useState<Phase>('rest');
  // The illustration is optional: a missing file leaves the mat, so the mock keeps its
  // proportions instead of the layout collapsing around a hole.
  const [artFailed, setArtFailed] = useState(false);

  const reduced = useReducedMotion();

  /**
   * The loop. One timer at a time, chained: rest → press → peel → swap (advance the beat
   * off-screen) → rest. It does not run while the visitor is on another page — the pager
   * keeps all three mounted, so an ungated loop would animate and re-render behind them.
   */
  useEffect(() => {
    if (!active) {
      setPhase('rest');
      return;
    }
    // Under prefers-reduced-motion nothing lifts: the faces simply change on a slow beat,
    // which still teaches which note belongs to which page.
    if (reduced) {
      const t = setInterval(() => setBeat((b) => (b + 1) % BEATS.length), 2600);
      return () => clearInterval(t);
    }

    const next: Record<Phase, { to: Phase; ms: number }> = {
      rest: { to: 'press', ms: HOLD_MS },
      press: { to: 'peel', ms: PRESS_MS },
      peel: { to: 'swap', ms: FLIP_MS },
      swap: { to: 'rest', ms: SWAP_MS },
    };
    const step = next[phase];
    const t = setTimeout(() => {
      // Advance the beat while the peeled page is still off-screen, so the face swap and
      // the snap back to rest happen in the same frame and neither is ever seen.
      if (phase === 'peel') setBeat((b) => (b + 1) % BEATS.length);
      setPhase(step.to);
    }, phase === 'swap' ? step.ms + BETWEEN_MS : step.ms);
    return () => clearTimeout(t);
  }, [active, phase, reduced]);

  const current = BEATS[beat]!;
  const under = BEATS[(beat + 1) % BEATS.length]!;
  const note = NOTE[current];

  // The lifting page. `swap` is the one phase with no transition — that is the frame the
  // page snaps back to rest in, and animating it would run the peel backwards on screen.
  const lifting = phase === 'peel';
  const drift = note.side === 'left' ? DRIFT_PCT : -DRIFT_PCT;
  const tilt = note.side === 'left' ? TILT_DEG : -TILT_DEG;

  return (
    <SlideBody>
      <PageHeader label={SLIDE_BAND[language].demo} />

      <p className="mb-2 text-center font-zilla text-[1.05rem] font-bold leading-snug text-[var(--ink)]">
        {DEMO_CAPTION[language]}
      </p>

      <div className="relative min-h-[220px] flex-1 overflow-hidden rounded-[18px] bg-[var(--board)] p-2.5">
        <div
          className="pointer-events-none absolute inset-x-5 bottom-2 top-5 rounded-[16px] border-[3px] border-[var(--ink)] bg-[var(--stock)] opacity-40"
          style={{ transform: 'rotate(-2deg)' }}
          aria-hidden
        />
        {/* the card already underneath */}
        <div className="absolute inset-2 origin-top">
          <MiniPage
            mini={mini}
            fork={isFork(under)}
            pressed={null}
            artFailed={artFailed}
            onArtError={() => setArtFailed(true)}
          />
        </div>

        <div
          className="absolute inset-2"
          style={{
            transformOrigin: note.side === 'left' ? 'left bottom' : 'right bottom',
            transform: lifting
              ? `translate(${drift}%, -118%) rotate(${tilt}deg)`
              : 'translate(0, 0) rotate(0deg)',
            opacity: lifting ? 0 : 1,
            boxShadow: lifting ? '0 10px 18px rgba(28, 59, 46, 0.35)' : 'none',
            transition:
              phase === 'swap'
                ? 'none'
                : `transform ${FLIP_MS}ms cubic-bezier(0.55,0.06,0.68,0.19), opacity ${FLIP_MS}ms ease-in`,
          }}
        >
          <MiniPage
            mini={mini}
            fork={isFork(current)}
            pressed={phase === 'press' ? (isFork(current) ? current : 'next') : null}
            artFailed={artFailed}
            onArtError={() => setArtFailed(true)}
          />
        </div>

        {!reduced && (
          <div
            aria-hidden
            className="pointer-events-none absolute h-[26px] w-[26px] rounded-full border-2 border-[var(--gold)] bg-[var(--stock)]/80"
            style={{
              left: `calc(${note.x}% - 13px)`,
              bottom: 18,
              opacity: phase === 'rest' ? 0.55 : phase === 'press' ? 1 : 0,
              transform: phase === 'press' ? 'scale(0.82)' : 'scale(1)',
              transition: 'opacity 160ms ease-out, transform 160ms ease-out',
            }}
          />
        )}
      </div>

      <p className="mt-2 flex h-[44px] items-center justify-center text-center font-zilla text-[14px] font-medium leading-snug text-[var(--olive)]">
        {hint[current]}
      </p>

      <Ticket label={DEMO_START[language]} onClick={onStart} />
    </SlideBody>
  );
}

/**
 * One face of the mini pad: the same page, printed small. A topic header, the engraving,
 * and a foot that is either one centred blue note or a fork's two — the two states
 * DemoCardPage itself has.
 *
 * `pressed` names whichever note THIS face's beat is about, so it can sink under the cue.
 */
function MiniPage({
  mini,
  fork,
  pressed,
  artFailed,
  onArtError,
}: {
  mini: { band: string; next: string; pickA: string; pickB: string };
  fork: boolean;
  pressed: 'next' | 'left' | 'right' | null;
  artFailed: boolean;
  onArtError: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[14px] border-[3px] border-[var(--ink)] bg-[var(--stock)] p-2">
      <div className="mb-1.5 flex h-6 items-center rounded-md bg-[var(--ink)] px-1.5">
        <span className="min-w-0 flex-1 truncate font-band text-[8px] uppercase tracking-[0.12em] text-[var(--stock)]">
          {mini.band}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center">
        {artFailed ? (
          <div className="aspect-square h-full max-h-[96px] rounded-[6px] border-2 border-[var(--ink)] bg-[var(--peach)]" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={DEMO_IMAGE_SRC}
            alt=""
            onError={onArtError}
            className="aspect-square h-full max-h-[96px] rounded-[6px] border-2 border-[var(--ink)] bg-[var(--peach)] object-contain mix-blend-multiply"
          />
        )}
      </div>

      <div className="mt-1.5 flex h-[28px] items-end gap-1">
        {fork ? (
          <>
            <MiniNote label={mini.pickA} tone="a" down={pressed === 'left'} />
            <MiniNote label={mini.pickB} tone="b" down={pressed === 'right'} />
          </>
        ) : (
          <MiniNote label={mini.next} tone="gold" down={pressed === 'next'} />
        )}
      </div>
    </div>
  );
}

function MiniNote({
  label,
  tone,
  down,
}: {
  label: string;
  tone: 'gold' | 'a' | 'b';
  down: boolean;
}) {
  const fill =
    tone === 'gold' ? 'bg-[var(--gold)]' : tone === 'a' ? 'bg-[var(--fork-a)]' : 'bg-[var(--fork-b)]';
  const ink = tone === 'gold' ? 'text-[var(--ink)]' : 'text-[var(--stock)]';
  return (
    <span
      className={`flex min-w-0 flex-1 items-center justify-between rounded-md border-2 border-[var(--ink)] px-1.5 py-0.5 font-zilla text-[10px] font-bold leading-none ${fill} ${ink}`}
      style={{
        transform: `translateY(${down ? 2 : 0}px)`,
        transition: 'transform 150ms ease-out',
      }}
    >
      <span className="truncate">{label}</span>
      <span aria-hidden className="ml-1">▶</span>
    </span>
  );
}

/** `prefers-reduced-motion`, as reactive state (it can change while the demo is open). */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(prefersReducedMotion());
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
