'use client';

/**
 * Furniture shared by the three onboarding pages.
 *
 * The pages are printed on the SAME lined pad the feed's cards are (`.notebook-paper` +
 * the 58px left gutter that clears the red margin rule), because onboarding and the feed
 * are one product. That is why none of this is the app's mid-century flash-card die-cut:
 * the browser demo's pages are notebook pages, and a cream deck card dealt in front of a
 * ruled pad would be two products in one lightbox. The vocabulary borrowed from the deck
 * is the one thing that survives the change of stock — GOLD means "the ordinary way
 * onward", which is what the Ticket is.
 */
import type { ReactNode } from 'react';

/** Content starts to the RIGHT of the red margin rule (44-46px in .notebook-paper). */
export const GUTTER_LEFT = 58;

/**
 * The page's header: the cat stamp, a small-caps label naming what KIND of page this is,
 * and the rule under it. Every page of the pad carries one, which is what makes the three
 * onboarding pages read as pages of the same pad rather than three modals.
 */
export function PageHeader({ label }: { label: string }) {
  return (
    // `pr-8` keeps the rule (and the label) clear of the lightbox's floating close button.
    <div className="mb-2 flex items-center gap-2.5 border-b border-[rgba(12,52,61,0.14)] pb-2 pr-8">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/hiraia-profile.png"
        alt=""
        width={26}
        height={26}
        className="h-[26px] w-[26px] shrink-0 rounded-full ring-1 ring-[rgba(12,52,61,0.15)]"
      />
      <span className="truncate font-hand text-[13px] uppercase tracking-[0.16em] text-[#5a7178]">
        {label}
      </span>
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
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center justify-center gap-2.5 rounded-2xl border-2 border-[#0c343d] bg-[#f3a228] px-5 py-3.5 shadow-[0_4px_0_rgba(12,52,61,0.35)] transition-transform active:translate-y-[3px] active:shadow-[0_1px_0_rgba(12,52,61,0.35)] motion-reduce:active:translate-y-0 ${className}`}
    >
      <span className="font-display text-[26px] leading-none text-[#0c343d]">{label}</span>
      <span className="text-[18px] leading-none text-[#0c343d]">⤴</span>
    </button>
  );
}

/** A page of the pad: the gutter + the vertical rhythm every slide shares. */
export function SlideBody({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex h-full flex-col overflow-y-auto pb-4 pr-[26px] pt-2.5"
      style={{ paddingLeft: GUTTER_LEFT }}
    >
      {children}
    </div>
  );
}
