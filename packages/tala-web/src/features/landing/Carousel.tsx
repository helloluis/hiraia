'use client';
/**
 * Features carousel: CSS scroll-snap, works without JS (it is just a horizontally scrolling list), swipe and
 * keyboard friendly (the strip is focusable and arrow keys scroll it), prev/next buttons for pointer users,
 * reduced-motion honoured (no smooth scrolling then). Images lazy-load below the fold. No carousel library.
 */
import { useRef } from 'react';
import { useT, type StringKey } from '@/i18n';

export interface Screen {
  name: string;
  w: number;
  h: number;
  captionKey: StringKey;
  /** Phone screens are shown in a narrower frame than desktop ones. */
  kind: 'phone' | 'desktop';
}

export function Carousel({ screens }: { screens: Screen[] }) {
  const { t } = useT();
  const ref = useRef<HTMLUListElement>(null);
  const scrollBy = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({
      left: dir * Math.round(el.clientWidth * 0.85),
      behavior: reduce ? 'auto' : 'smooth',
    });
  };
  return (
    <div className="relative">
      <ul
        ref={ref}
        tabIndex={0}
        aria-label={t('landing.carouselLabel')}
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-px-4 px-4 pb-4 -mx-4 wide:mx-0 wide:px-0 wide:scroll-px-0 [scrollbar-width:thin] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-talaTeal rounded"
      >
        {screens.map((s) => (
          <li
            key={s.name}
            className={`snap-start shrink-0 ${s.kind === 'phone' ? 'w-[min(78vw,300px)]' : 'w-[min(92vw,640px)]'} flex flex-col gap-3`}
          >
            <figure className="m-0 rounded-[1.25rem] overflow-hidden border border-hairline bg-white shadow-[0_10px_30px_rgba(28,59,46,0.10)]">
              <picture>
                <source type="image/webp" srcSet={`/screens/${s.name}.webp`} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/screens/${s.name}.jpg`}
                  alt={t(s.captionKey)}
                  width={s.w}
                  height={s.h}
                  loading="lazy"
                  decoding="async"
                  className="block w-full h-auto"
                />
              </picture>
            </figure>
            <p className="text-body leading-snug px-1">{t(s.captionKey)}</p>
          </li>
        ))}
      </ul>
      <div className="hidden wide:flex gap-2 justify-end mt-2">
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          aria-label={t('landing.prev')}
          className="min-h-touch min-w-touch rounded border border-hairline bg-white px-3"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => scrollBy(1)}
          aria-label={t('landing.next')}
          className="min-h-touch min-w-touch rounded border border-hairline bg-white px-3"
        >
          →
        </button>
      </div>
    </div>
  );
}
