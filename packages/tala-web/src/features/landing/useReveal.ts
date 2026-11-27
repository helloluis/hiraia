'use client';
/**
 * A picture rises into place the first time it scrolls into view (globals.css, `.tala-landing-reveal`).
 *
 * Nothing is hidden unless this script is running and motion is wanted: the server sends the pictures fully visible,
 * and only a picture that is still below the screen when the page comes alive is set back to wait for its turn. With
 * "reduce motion" on, or without IntersectionObserver, they simply stay as they are.
 */
import { useEffect, useRef } from 'react';

export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Already on screen (or above it): leave it alone, a visible thing must not blink out.
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    el.dataset.reveal = 'wait';
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        el.dataset.reveal = 'in';
        io.disconnect();
      },
      { rootMargin: '0px 0px -12% 0px' }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      delete el.dataset.reveal;
    };
  }, []);
  return ref;
}
