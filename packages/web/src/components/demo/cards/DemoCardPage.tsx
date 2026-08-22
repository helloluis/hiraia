'use client';

/**
 * One notebook page of the question-cards feed — WEB DEMO port of the mobile
 * packages/mobile/src/components/cards/CardPage.tsx (keep in sync): illustration + the
 * fact, typewritered onto a blank page, with blue-ink "teacher's note" choices
 * at the bottom corners. Click anywhere while typing → complete instantly.
 *
 * Typography reacts to content length: short facts go BIG in felt marker (centered),
 * long facts settle into smaller handwriting (top-left). The typewriter renders the
 * full text invisibly to reserve layout, revealing a prefix — so centered text never
 * re-wraps/jumps as it types.
 */
import { useEffect, useState } from 'react';

import type { LanguageKey } from '@/config/model';
import { cardText, type CardChoice, type CardFact } from '@/data/cards';

// Content starts to the RIGHT of the red margin rule (44-46px in .notebook-paper).
const GUTTER_LEFT = 58;

const CHARS_PER_TICK = 5;
const TICK_MS = 24; // ≈ 210 chars/s — a card lands in ~1s; click to finish instantly

interface Tier {
  fontClass: string;
  fontSize: number;
  lineHeight: number;
  textAlign: 'center' | 'left';
  centered: boolean; // vertical centering + image size
}

function tierFor(text: string): Tier {
  const n = text.length;
  if (n <= 70) return { fontClass: 'font-display', fontSize: 30, lineHeight: 44, textAlign: 'center', centered: true };
  if (n <= 150) return { fontClass: 'font-display', fontSize: 27, lineHeight: 38, textAlign: 'center', centered: true };
  if (n <= 260) return { fontClass: 'font-hand', fontSize: 20, lineHeight: 30, textAlign: 'left', centered: false };
  return { fontClass: 'font-hand', fontSize: 17, lineHeight: 26, textAlign: 'left', centered: false };
}

interface DemoCardPageProps {
  fact: CardFact;
  choices: CardChoice[];
  language: LanguageKey;
  onChoose: (choice: CardChoice) => void;
  /** Render fully typed with no animation (the outgoing page during the flip). */
  instant?: boolean;
}

export function DemoCardPage({ fact, choices, language, onChoose, instant = false }: DemoCardPageProps) {
  const text = cardText(fact, language);
  const tier = tierFor(text);
  // Two choices == this page forks; nextChoices returns one on a normal page.
  const branching = choices.length > 1;
  const [shown, setShown] = useState(instant ? text.length : 0);
  const [imgFailed, setImgFailed] = useState(false);
  const done = shown >= text.length;

  // typewriter (starts shortly after mount, i.e. as the page flip settles)
  useEffect(() => {
    if (instant) {
      setShown(text.length);
      return;
    }
    setShown(0);
    let i = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (cancelled) return;
      i += CHARS_PER_TICK;
      setShown(i);
      if (i < text.length) timer = setTimeout(tick, TICK_MS);
    };
    const start = setTimeout(tick, 260);
    return () => {
      cancelled = true;
      clearTimeout(start);
      if (timer) clearTimeout(timer);
    };
  }, [fact.id, text, instant]);

  const skip = () => {
    if (!done) setShown(text.length);
  };

  const visible = text.slice(0, Math.min(shown, text.length));
  const hidden = text.slice(Math.min(shown, text.length));
  const extras = {
    opacity: done ? 1 : 0,
    transition: 'opacity 240ms ease-out',
  } as const;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className="relative flex h-full flex-col pb-[78px] pr-[26px] pt-2"
      style={{ paddingLeft: GUTTER_LEFT }}
      onClick={skip}
    >
      <div
        className={
          tier.centered
            ? 'flex flex-1 flex-col items-center justify-center'
            : 'flex flex-1 flex-col items-start pt-2'
        }
      >
        {!imgFailed && (
          <div className="mx-auto" style={{ ...extras, width: tier.centered ? 250 : 190 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/demo/cards/${fact.slug}.png`}
              alt={fact.topic}
              onError={() => setImgFailed(true)}
              className="aspect-square w-full rounded-[14px] border border-dashed border-[rgba(12,52,61,0.12)] bg-white object-cover"
            />
          </div>
        )}
        <p
          className={`${tier.fontClass} mt-3.5 text-[#0c343d]`}
          style={{
            fontSize: tier.fontSize,
            lineHeight: `${tier.lineHeight}px`,
            textAlign: tier.textAlign,
          }}
        >
          {visible}
          <span className="opacity-0">{hidden}</span>
        </p>
      </div>

      {/*
        Teacher's-note choices, blue ink, along the bottom. A normal page is SINGLE-PATH —
        one centred note — so turning the page stays a rhythm rather than a decision. On a
        fork (BRANCH_EVERY cadence or a dead end, see nextChoices) the second note appears
        and the pair splits to the corners, so a fork reads as a real moment.
      */}
      <div
        className={`absolute bottom-3 right-[22px] flex items-end ${branching ? 'justify-between' : 'justify-center'}`}
        style={{ ...extras, left: GUTTER_LEFT, pointerEvents: done ? 'auto' : 'none' }}
      >
        {choices[0] && (
          <button
            type="button"
            onClick={() => onChoose(choices[0]!)}
            className={`border-b-[1.5px] border-[#2743a6] pb-px ${
              branching ? 'max-w-[46%] -rotate-2 text-left' : 'max-w-[80%] -rotate-1 text-center'
            }`}
          >
            <span className="block truncate whitespace-nowrap font-display text-[23px] text-[#2743a6]">
              {choices[0].label} <span className="text-[16px]">⤴</span>
            </span>
          </button>
        )}
        {branching && choices[1] && (
          <button
            type="button"
            onClick={() => onChoose(choices[1]!)}
            className="max-w-[46%] rotate-[1.5deg] border-b-[1.5px] border-[#2743a6] pb-px text-right"
          >
            <span className="block truncate whitespace-nowrap font-display text-[23px] text-[#2743a6]">
              {choices[1].label} <span className="text-[16px]">⤴</span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
