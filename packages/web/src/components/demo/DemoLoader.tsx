'use client';

import { useEffect, useRef, useState } from 'react';
import type { LanguageKey } from '@/config/model';
import { useDemoStore } from '@/store/useDemoStore';

/**
 * Web mirror of the mobile cold-start loader: the cat mascot dozes while the
 * model "warms up", then wakes as the progress bar fills, then hands off to the
 * chat. There's no real model to load in the web demo, so progress is a short
 * simulated ramp (~6s) — just enough to land the charming wake-up beat before
 * the trivia card appears.
 */

const SLEEPING_SRC = '/demo/cat-sleeping-loop.mp4';
const WAKING_SRC = '/demo/cat-waking.mp4';

export function DemoLoader() {
  const language = useDemoStore((s) => s.language) ?? 'tagalog';
  const finishLoading = useDemoStore((s) => s.finishLoading);

  const [progress, setProgress] = useState(0);
  const [waking, setWaking] = useState(false);
  const finishedRef = useRef(false);

  // Simulated warm-up: 0 → 100 over ~6s. Cross into the "waking" clip at 85%.
  useEffect(() => {
    const start = Date.now();
    const DURATION = 6000;
    const interval = setInterval(() => {
      const pct = Math.min(100, Math.round(((Date.now() - start) / DURATION) * 100));
      setProgress(pct);
      if (pct >= 85) setWaking(true);
      if (pct >= 100) clearInterval(interval);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  // Hand off to chat once the bar is full and the wake-up clip has had a beat to play.
  useEffect(() => {
    if (progress >= 100 && !finishedRef.current) {
      finishedRef.current = true;
      const t = setTimeout(() => finishLoading(), 900);
      return () => clearTimeout(t);
    }
  }, [progress, finishLoading]);

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-between py-12"
      // Matches the baked-in background of the cat clips so the video reads as
      // one seamless surface (same value the mobile loader uses).
      style={{ backgroundColor: '#165a69' }}
    >
      <div className="px-8 text-center">
        <h2
          className="font-display text-3xl text-[#fdfdf6] sm:text-4xl"
          style={{ textShadow: '1px 2px 3px rgba(0,0,0,0.15)' }}
        >
          {welcomeMessage(language)}
        </h2>
      </div>

      <div className="flex w-full flex-1 items-center justify-center">
        <video
          key={waking ? 'waking' : 'sleeping'}
          src={waking ? WAKING_SRC : SLEEPING_SRC}
          autoPlay
          muted
          playsInline
          loop={!waking}
          className="w-full max-w-md object-contain"
        />
      </div>

      <div className="w-full px-8">
        <div className="h-3 w-full overflow-hidden rounded-full border border-[#fdfdf6]/25 bg-[#fdfdf6]/15">
          <div
            className="h-full rounded-full bg-[#f3a228] transition-[width] duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="font-body text-base text-[#fdfdf6]/70">
            {subtextMessage(language, progress)}
          </span>
          <span className="font-body text-lg text-[#f3a228]">{progress}%</span>
        </div>
      </div>
    </div>
  );
}

function welcomeMessage(lang: LanguageKey): string {
  switch (lang) {
    case 'cebuano':
      return 'pagmata na, hiraia!';
    case 'english':
      return 'wake up, hiraia!';
    case 'tagalog':
    default:
      return 'gising na, hiraia!';
  }
}

function subtextMessage(lang: LanguageKey, progress: number): string {
  if (progress < 15) {
    switch (lang) {
      case 'cebuano':
        return 'nag-boot up pa...';
      case 'english':
        return 'starting up...';
      default:
        return 'nag-bo-boot up pa...';
    }
  } else if (progress < 85) {
    switch (lang) {
      case 'cebuano':
        return 'gipang-load ang utak ni Hiraia...';
      case 'english':
        return "loading Hiraia's memory...";
      default:
        return 'niloload ang utak ni Hiraia...';
    }
  } else if (progress < 95) {
    switch (lang) {
      case 'cebuano':
        return 'nagmata na siya...';
      case 'english':
        return 'waking her up...';
      default:
        return 'nagigising na siya...';
    }
  }
  switch (lang) {
    case 'cebuano':
      return 'hapit na...';
    case 'english':
      return 'almost ready...';
    default:
      return 'malapit na...';
  }
}
