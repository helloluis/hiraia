'use client';

/**
 * Page 1 of the onboarding pad: "how do you want to use Hiraia?" typewriters on, cycling
 * Tagalog → English → Bisaya → (loop), each question replacing the last; three language
 * plates, each written IN its own language, below.
 *
 * Ported from the app's packages/mobile/src/components/onboarding/LanguageSlide.tsx. It
 * supersedes DemoLanguagePicker, whose whole job — a trilingual framing line and three
 * plates — is now the first page of a three-page flow rather than a screen of its own. The
 * trilingual line is gone because the cycling question does the same work better: it shows
 * the tutor SPEAKING each language instead of listing them.
 *
 * Language is still undecided while this page is up, so the header label rides the same
 * cycle the question does — it says WIKA under the Tagalog question, LANGUAGE under the
 * English one.
 */
import { useEffect, useRef } from 'react';

import type { LanguageKey } from '@/config/model';

import {
  LANGUAGE_OPTIONS,
  LANG_BUTTON,
  LANG_CYCLE,
  LANG_REASSURE,
  Q_HOW_USE,
  SLIDE_BAND,
} from './copy';
import { Caret, PageHeader, SlideBody } from './parts';
import { useTypewriter } from './useTypewriter';

const HOLD_MS = 1500; // how long a fully-typed question lingers before the next language

export function LanguageSlide({
  active,
  picked,
  cycle,
  onCycle,
  onPick,
}: {
  /** True while this page is the one on screen — the question only cycles then. */
  active: boolean;
  /** The language already chosen, if the visitor came back to change it. */
  picked: LanguageKey | null;
  /**
   * Which language the cycling question is currently in. Owned by the carousel rather than
   * by this page: the pager keeps all three pages mounted, so state kept here would carry
   * on ticking (and re-rendering) while the visitor is two pages away.
   */
  cycle: number;
  onCycle: () => void;
  onPick: (lang: LanguageKey) => void;
}) {
  const lang = LANG_CYCLE[cycle % LANG_CYCLE.length]!;
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);

  const typed = useTypewriter(Q_HOW_USE[lang], {
    playKey: `${cycle}/${active ? 1 : 0}`,
    stepMs: 48,
    onDone: () => {
      if (!active) return;
      if (hold.current) clearTimeout(hold.current);
      hold.current = setTimeout(onCycle, HOLD_MS);
    },
  });

  // Drop a pending hold when the page goes off-screen or unmounts, so a visitor who moves
  // on doesn't come back to a question that advanced behind their back.
  useEffect(
    () => () => {
      if (hold.current) clearTimeout(hold.current);
    },
    [active]
  );

  return (
    <SlideBody>
      <PageHeader label={SLIDE_BAND[lang].language} />

      <div className="flex flex-1 flex-col items-center justify-center pb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hiraia-profile.png"
          alt="Hiraia"
          className="h-[76px] w-[76px] rounded-full ring-1 ring-[rgba(12,52,61,0.12)]"
        />
        <h2 className="mt-2 font-slab text-[32px] leading-none tracking-wide text-[var(--ink)]">HIRAIA</h2>

        <div className="flex min-h-[4.5rem] items-center justify-center">
          <p className="text-center font-zilla text-[1.15rem] font-bold leading-snug text-[var(--ink)]">
            {typed}
            <Caret />
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {LANGUAGE_OPTIONS.map((opt) => (
          <button
            key={opt.lang}
            type="button"
            onClick={() => onPick(opt.lang)}
            className={`flex items-center gap-2.5 rounded-[13px] border-[3px] border-[var(--ink)] px-4 py-3 text-left ${
              picked === opt.lang ? 'bg-[var(--ink)]' : 'bg-[var(--stock)]'
            }`}
          >
            <span
              className={`min-w-0 flex-1 truncate font-zilla text-[18px] font-bold ${
                picked === opt.lang ? 'text-[var(--stock)]' : 'text-[var(--ink)]'
              }`}
            >
              {LANG_BUTTON[opt.lang]}
            </span>
            {opt.beta && (
              <span className="mc-chip !h-5 shrink-0 !text-[9px]">beta</span>
            )}
            <span
              className={`shrink-0 font-slab text-[14px] ${
                picked === opt.lang ? 'text-[var(--gold)]' : 'text-[var(--ink)]'
              }`}
              aria-hidden
            >
              ▶
            </span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-center font-zilla text-sm font-medium text-[var(--olive)]">
        {LANG_REASSURE[picked ?? lang]}
      </p>
    </SlideBody>
  );
}
