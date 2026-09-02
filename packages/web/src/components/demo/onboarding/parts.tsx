'use client';

/**
 * Furniture shared by the three onboarding pages.
 *
 * The pages are printed on the same laminated flash-card stock as the feed, so
 * onboarding and the deck read as one product. Gold still means "the ordinary way
 * onward" — it appears once, on the Ticket that starts the demo.
 */
import type { ReactNode } from 'react';

export const GUTTER_LEFT = 16;

/**
 * The page's header: the cat stamp, a small-caps label naming what KIND of page this is,
 * and the rule under it. Every page of the pad carries one, which is what makes the three
 * onboarding pages read as pages of the same pad rather than three modals.
 */
export function PageHeader({ label }: { label: string }) {
  return (
    // `pr-8` keeps the rule (and the label) clear of the lightbox's floating close button.
    <div className="mc-band mb-3 pr-8">
      <span className="mc-topic">{label}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hiraia-profile.png" alt="" width={26} height={26} className="mc-stamp" />
    </div>
  );
}

/**
 * The blinking caret the two typewritered questions end on. Quiet grey, not the blue the
 * feed writes its choices in: a caret is neither an instruction nor a thing to press, and
 * spending the ink colour on it would dilute the only meaning that ink carries.
 */
export function Caret() {
  return <span className="ml-0.5 animate-pulse text-[#5a7178]">▍</span>;
}

/**
 * The GOLD TICKET — the deck's one piece of vocabulary that crosses onto the pad. Gold is
 * reserved, here as on device, for the ordinary continuation, so it appears exactly once in
 * onboarding: the button that ends it. `⤴` is the same glyph the feed's teacher's-note
 * choices carry, so the first thing a visitor presses is shaped like everything they will
 * press afterwards.
 */
export function Ticket({
  label,
  onClick,
  className = '',
}: {
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <div className={`mc-ledge ${className}`}>
      <button type="button" onClick={onClick} className="mc-ticket">
        <span className="flex-1">{label}</span>
        <span className="mc-arrow" aria-hidden />
      </button>
    </div>
  );
}

/** A page of the pad: the gutter + the vertical rhythm every slide shares. */
export function SlideBody({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto p-1">
      {children}
    </div>
  );
}
