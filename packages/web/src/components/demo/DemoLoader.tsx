'use client';

import { useEffect, useState } from 'react';
import { GrowingGlyph } from '@/components/brand/GrowingGlyph';
import { useDemoStore } from '@/store/useDemoStore';

/** Readiness-driven boot cover, matching Android's growing glyph and card-peel exit. */
export function DemoLoader() {
  const grade = useDemoStore((s) => s.grade);
  const finishLoading = useDemoStore((s) => s.finishLoading);
  const [exiting, setExiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setFailed(false);
    setExiting(false);
    // Load actual data/chunks; no simulated percentage or fixed model-warmup delay.
    void Promise.all([import('./cards/CardFeedDemo'), import('@/data/cards').then((m) => m.loadGradeQ1(grade))])
      .then(() => {
        if (!alive) return;
        setExiting(true);
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        timer = setTimeout(finishLoading, reduced ? 220 : 420);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [grade, finishLoading, attempt]);

  return <div className={`demo-brand-loader ${exiting ? 'demo-brand-loader-exit' : ''}`} role="status" aria-label="Loading Hiraia">
    <GrowingGlyph />
    {failed ? <button type="button" className="demo-load-retry" onClick={() => setAttempt((n) => n + 1)}>Try loading again</button> : <span className="sr-only">Loading Hiraia…</span>}
  </div>;
}
