'use client';

/**
 * One laminated flash card of the question-cards feed — WEB DEMO port of the mobile
 * packages/mobile/src/components/cards/CardPage.tsx: index band, peach-matted engraving,
 * typewritten fact, and a mustard ticket (or a pair of fork tickets) for the next card.
 */
import { useEffect, useState } from 'react';

import type { LanguageKey } from '@/config/model';
import { cardText, type CardChoice, type CardFact } from '@/data/cards';

const CHARS_PER_TICK = 5;
const TICK_MS = 24;

interface DemoCardPageProps {
  fact: CardFact;
  choices: CardChoice[];
  language: LanguageKey;
  onChoose: (choice: CardChoice) => void;
  instant?: boolean;
}

export function DemoCardPage({ fact, choices, language, onChoose, instant = false }: DemoCardPageProps) {
  const text = cardText(fact, language);
  const branching = choices.length > 1;
  const [shown, setShown] = useState(instant ? text.length : 0);
  const [imgFailed, setImgFailed] = useState(false);
  const done = shown >= text.length;

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
    <div className="relative z-[1] flex h-full flex-col" onClick={skip}>
      <div className={`mc-band mb-3 ${branching ? 'mc-band-olive' : ''}`}>
        <span className="mc-topic">{fact.topic}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hiraia-profile.png" alt="" width={26} height={26} className="mc-stamp" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {!imgFailed && fact.slug ? (
          <div className="mc-plate mx-auto mb-3 w-full max-w-[min(100%,18rem)]" style={extras}>
            <div className="mc-window aspect-square max-h-[42svh]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/demo/cards/${fact.slug}.png`}
                alt=""
                onError={() => setImgFailed(true)}
              />
            </div>
          </div>
        ) : null}
        <p className="relative z-[1] font-zilla text-[15px] font-medium leading-snug text-[var(--ink)] sm:text-[16px]">
          {visible}
          <span className="opacity-0">{hidden}</span>
        </p>
      </div>

      <div
        className={`relative z-[1] mt-3 flex gap-2 ${branching ? '' : ''}`}
        style={{ ...extras, pointerEvents: done ? 'auto' : 'none' }}
      >
        {choices[0] && (
          <div className="mc-ledge min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onChoose(choices[0]!)}
              className={`mc-ticket ${branching ? 'mc-ticket-a' : ''}`}
            >
              <span className="flex-1 truncate">{choices[0].label}</span>
              <span className="mc-arrow" aria-hidden />
            </button>
          </div>
        )}
        {branching && choices[1] && (
          <div className="mc-ledge min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onChoose(choices[1]!)}
              className="mc-ticket mc-ticket-b"
            >
              <span className="flex-1 truncate">{choices[1].label}</span>
              <span className="mc-arrow" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
