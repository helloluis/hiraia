'use client';
/**
 * The teacher's "reduce motion" setting. The base stylesheet already switches every CSS animation and transition off
 * under it; anything moved from script (the reorder, a scroll that follows it) asks here first, because that rule
 * cannot reach it.
 */
import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(QUERY).matches
  );
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** Follows the setting while the screen is open (false while rendering on the server). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
