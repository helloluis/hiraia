'use client';

import { useState } from 'react';

/**
 * Click-to-play YouTube embed. Renders a lightweight poster + play button (matching
 * the landing design) and only mounts the actual YouTube <iframe> on click, so the
 * page stays light until someone wants the video — then it plays INLINE (autoplay on
 * the click gesture), never navigating away. Uses youtube-nocookie for privacy.
 */
export function YouTubeEmbed({
  id,
  title = 'Video',
  poster,
}: {
  /** YouTube video id (e.g. the `nmoIvZcPmEE` in youtu.be/nmoIvZcPmEE). */
  id: string;
  title?: string;
  /** Cover image shown before play; defaults to YouTube's own thumbnail. */
  poster?: string;
}) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-[18px] border-[3px] border-[var(--ink,#1C3B2E)] bg-black">
        <iframe
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={`Play video: ${title}`}
      className="group relative flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded-[18px] border-[3px] border-[var(--ink,#1C3B2E)] bg-black/40"
    >
      {/* Cover image */}
      <div
        className="absolute inset-0 bg-cover bg-center filter brightness-[0.4] group-hover:scale-105 transition-transform duration-500"
        style={{ backgroundImage: `url('${poster ?? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`}')` }}
      />

      {/* Play Button Icon */}
      <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--gold,#D8A03A)] text-[var(--ink,#1C3B2E)] shadow-lg transition-transform duration-300 group-hover:scale-110 sm:h-20 sm:w-20">
        <svg className="w-6 h-6 sm:w-8 sm:h-8 fill-current ml-1" viewBox="0 0 24 24" aria-hidden>
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>

      {/* Overlay Vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
    </button>
  );
}
