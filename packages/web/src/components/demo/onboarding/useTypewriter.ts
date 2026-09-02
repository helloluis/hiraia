'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Typewriter a string on, char by char. Returns the partial text. A verbatim port of the
 * mobile app's packages/mobile/src/components/onboarding/useTypewriter.ts.
 *
 * `playKey` lets a caller restart the animation (change it to replay); `startDelay` waits
 * before typing; `onDone` fires once the full string is shown. All timers are cleaned up on
 * unmount / key change, so it is safe inside a looping animation.
 *
 * Honours `prefers-reduced-motion`: a visitor who has asked for less motion gets the whole
 * string immediately rather than a character crawl.
 */
export function useTypewriter(
  full: string,
  opts: { stepMs?: number; startDelay?: number; playKey?: string | number; onDone?: () => void } = {}
): string {
  const { stepMs = 45, startDelay = 0, playKey = full, onDone } = opts;
  const [text, setText] = useState('');
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (prefersReducedMotion()) {
      setText(full);
      // Still fire onDone, or the language cycle on slide 1 would stop after one question.
      timers.push(setTimeout(() => onDoneRef.current?.(), 0));
      return () => {
        for (const t of timers) clearTimeout(t);
      };
    }

    setText('');
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      i += 1;
      setText(full.slice(0, i));
      if (i < full.length) timers.push(setTimeout(tick, stepMs));
      else onDoneRef.current?.();
    };
    timers.push(setTimeout(tick, startDelay));
    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    };
  }, [playKey, full, stepMs, startDelay]);

  return text;
}

/** True when the visitor's OS asks for reduced motion. SSR-safe (false on the server). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
