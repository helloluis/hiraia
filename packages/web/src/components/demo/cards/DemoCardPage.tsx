'use client';

/**
 * One laminated flash card of the question-cards feed — WEB DEMO port of the mobile
 * packages/mobile/src/components/cards/CardPage.tsx: index band, peach-matted engraving,
 * typewritten fact, and a mustard ticket (or a pair of fork tickets) for the next card.
 */
import { useEffect, useState, useRef } from 'react';

import type { LanguageKey } from '@/config/model';
import { cardText, hasDemoArt, type CardChoice, type CardFact } from '@/data/cards';

import { cardStrings } from './strings';

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
  const t = cardStrings(language);
  const text = cardText(fact, language);
  const branching = choices.length > 1;
  const skipRef = useRef(false);
  const [shown, setShown] = useState(instant ? text.length : 0);
  const [imgFailed, setImgFailed] = useState(false);
  const done = shown >= text.length;

  useEffect(() => {
    skipRef.current = false;
    setImgFailed(false);
    if (instant) {
      setShown(text.length);
      return;
    }
    setShown(0);
    let i = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (cancelled || skipRef.current) return;
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
    if (!done) { skipRef.current = true; setShown(text.length); }
  };

  const visible = text.slice(0, Math.min(shown, text.length));
  const hidden = text.slice(Math.min(shown, text.length));
  const extras = {
    opacity: done ? 1 : 0,
    transition: 'opacity 240ms ease-out',
  } as const;
  // Ticket is tappable even while the fact is still typing — same as tapping the page to skip.

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="relative z-[1] flex h-full flex-col" onClick={skip}>
      <div className={`mc-band mb-3 ${branching ? 'mc-band-olive' : ''}`}>
        <span className="mc-topic">{fact.topic}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hiraia-profile.png" alt="" width={26} height={26} className="mc-stamp" />
      </div>

      <div className={`demo-fact-content flex min-h-0 flex-1 flex-col ${imgFailed || !hasDemoArt(fact.slug) ? 'justify-center' : ''}`}>
        {!imgFailed && hasDemoArt(fact.slug) ? (
          <div className="mc-plate demo-fact-art mx-auto mb-3 w-full" style={extras}>
            <div className="mc-window h-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/demo/cards/${fact.slug}.png`}
                alt=""
                onError={() => setImgFailed(true)}
              />
            </div>
          </div>
        ) : null}
        <p className="demo-fact-text relative z-[1] font-zilla text-[18px] font-normal text-[var(--ink)]">
          {visible}
          <span className="opacity-0">{hidden}</span>
        </p>
      </div>

      <div
        className="relative z-[1] mt-3"
        style={{ opacity: 1 }}
      >
        {branching && choices[0] && choices[1] ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hiraia-profile.png"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 rounded-full ring-1 ring-[var(--ink)]/20"
              />
              <span className="font-slab text-[12px] uppercase tracking-[0.14em] text-[var(--fork-a)]">
                {t.fork}
              </span>
              <span className="h-[3px] flex-1 rounded bg-[var(--graph)]" />
            </div>
            <div className="flex flex-col gap-2">
              <div className="mc-ledge min-w-0 flex-1">
                <button type="button" onClick={() => onChoose(choices[0]!)} className="mc-ticket mc-ticket-a">
                  <span className="mc-pick-key">A</span>
                  <span className="min-w-0 flex-1 truncate">{choices[0].label}</span>
                  <span className="mc-arrow" aria-hidden />
                </button>
              </div>
              <div className="mc-ledge min-w-0 flex-1">
                <button type="button" onClick={() => onChoose(choices[1]!)} className="mc-ticket mc-ticket-b">
                  <span className="mc-pick-key">B</span>
                  <span className="min-w-0 flex-1 truncate">{choices[1].label}</span>
                  <span className="mc-arrow" aria-hidden />
                </button>
              </div>
            </div>
          </>
        ) : choices[0] ? (
          <div className="mc-ledge">
            <button type="button" onClick={() => onChoose(choices[0]!)} className="mc-ticket">
              <span className="min-w-0 flex-1 text-left">
                <span className="mc-ticket-eyebrow">{t.nextCard}</span>
                <span className="block truncate">{choices[0].label}</span>
              </span>
              <span className="mc-arrow" aria-hidden />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
