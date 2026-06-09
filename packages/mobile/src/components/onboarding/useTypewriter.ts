import { useEffect, useRef, useState } from 'react';

/**
 * Typewriter a string on, char by char. Returns the partial text. `playKey` lets a
 * caller restart the animation (change it to replay). `startDelay` waits before typing;
 * `onDone` fires once the full string is shown. All timers are cleaned up on unmount /
 * key change, so it's safe inside a looping animation.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, full, stepMs, startDelay]);

  return text;
}
