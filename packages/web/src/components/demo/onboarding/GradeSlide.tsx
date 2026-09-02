'use client';

/**
 * Page 2 of the onboarding pad: "what grade are you in?" typewriters on in the language
 * just picked on page 1, above a 2×4 grid of grade plates (3–10). Ported from the app's
 * packages/mobile/src/components/onboarding/GradeSlide.tsx.
 *
 * Grade 5 is pre-highlighted, because most of our kids are behind academically and the
 * tutor pitches low unless told otherwise (DEFAULT_GRADE). The current grade is knocked out
 * in ink — the pad's loudest "this one is set", and unlike gold or the blue choice ink it
 * carries no instruction of its own, so a pre-set default never reads as a thing to press.
 *
 * Picking applies immediately and advances, exactly as on device. What the grade REACHES in
 * the browser demo is documented on `grade` in useDemoStore — read it before adding copy
 * here that promises a re-weighted feed.
 */
import type { LanguageKey } from '@/config/model';
import { GRADE_OPTIONS, GRADE_WORD, type GradeLevel } from '@/config/grades';

import { GRADE_NOTE, Q_GRADE, SLIDE_BAND } from './copy';
import { Caret, PageHeader, SlideBody } from './parts';
import { useTypewriter } from './useTypewriter';

export function GradeSlide({
  language,
  selected,
  active,
  onPick,
}: {
  language: LanguageKey;
  selected: GradeLevel;
  /** True while this page is the one on screen — the question (re)types on arrival. */
  active: boolean;
  onPick: (grade: GradeLevel) => void;
}) {
  const typed = useTypewriter(Q_GRADE[language], {
    playKey: `${language}/${active ? 1 : 0}`,
    stepMs: 48,
  });

  return (
    <SlideBody>
      <PageHeader label={SLIDE_BAND[language].grade} />

      <div className="flex flex-1 flex-col items-center justify-center pb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hiraia-profile.png"
          alt=""
          className="h-[72px] w-[72px] rounded-full ring-1 ring-[rgba(12,52,61,0.12)]"
        />

        {/* Fixed height, matching page 1's, so the grid never jumps as the question types. */}
        <div className="flex min-h-[4.5rem] items-center justify-center">
          <p className="text-center font-zilla text-[1.15rem] font-bold leading-snug text-[var(--ink)]">
            {typed}
            <Caret />
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {GRADE_OPTIONS.map((g) => {
          const isSelected = g === selected;
          return (
            <button
              key={g}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onPick(g)}
              className={`rounded-[13px] border-[3px] border-[var(--ink)] px-3 py-2.5 ${
                isSelected ? 'bg-[var(--ink)]' : 'bg-[var(--stock)]'
              }`}
            >
              <span
                className={`block truncate font-zilla text-[17px] font-bold ${
                  isSelected ? 'text-[var(--stock)]' : 'text-[var(--ink)]'
                }`}
              >
                {GRADE_WORD[language]} {g}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-center font-zilla text-sm font-medium text-[var(--olive)]">
        {GRADE_NOTE[language]}
      </p>
    </SlideBody>
  );
}
