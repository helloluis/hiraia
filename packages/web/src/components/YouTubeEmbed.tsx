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
      <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl">
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
      className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black/40 border border-white/10 shadow-2xl flex items-center justify-center group cursor-pointer"
    >
      {/* Cover image */}
      <div
        className="absolute inset-0 bg-cover bg-center filter brightness-[0.4] group-hover:scale-105 transition-transform duration-500"
        style={{ backgroundImage: `url('${poster ?? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`}')` }}
      />

      {/* Play Button Icon */}
      <div className="relative z-10 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg shadow-red-600/30 group-hover:bg-red-700 group-hover:scale-110 transition-all duration-300">
        <svg className="w-6 h-6 sm:w-8 sm:h-8 fill-current ml-1" viewBox="0 0 24 24" aria-hidden>
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>

      {/* Overlay Vignette */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />
    </button>
  );
}
