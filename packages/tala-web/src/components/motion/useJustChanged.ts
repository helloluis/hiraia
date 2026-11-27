'use client';
/**
 * "This part just changed, and not by your typing": true for a moment after a value is replaced from outside (an AI
 * rewrite that was applied, an earlier version put back, an edit that arrived from another device). The caller marks
 * its own edits with `mine(...)`, so the teacher's typing never sets it off.
 *
 * The screen shows it as a ring that fades (the same ring as a block that was just moved); with reduced motion the
 * ring stands still and is then removed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the mark stays. */
export const JUST_CHANGED_MS = 1500;

/** Is going from `before` to `now` a change from outside? Not on first sight, not when nothing changed, not her own edit. */
export function isOutsideChange(before: string | null, now: string, own: string | null): boolean {
  return before !== null && before !== now && own !== now;
}

/**
 * `settled`: false while what is shown is not the real value yet (records still loading, a blank stand-in on screen).
 * Watching starts with the first settled value, so a screen that opens never marks what it has just loaded.
 */
export function useJustChanged(
  signature: string,
  settled = true
): {
  changed: boolean;
  mine: (signature: string) => void;
} {
  const last = useRef<string | null>(null);
  const own = useRef<string | null>(null);
  const timer = useRef(0);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (!settled) {
      last.current = null;
      return;
    }
    const before = last.current;
    last.current = signature;
    if (!isOutsideChange(before, signature, own.current)) return;
    setChanged(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setChanged(false), JUST_CHANGED_MS);
  }, [signature, settled]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const mine = useCallback((s: string) => {
    own.current = s;
  }, []);
  return { changed, mine };
}
