'use client';
/** A slide as a small picture you can tap: the grid on the pack page, the carousel's filmstrip, the editor's list. */
import type { ReactNode } from 'react';
import type { SlideLayout } from '@hiraia/tala-core/decks';
import { useT, type StringKey, type Vars } from '@/i18n';
import { cx } from '@/components/ui';
import { slideTitle, type DeckView } from './deck-model';
import { SlideView } from './SlideView';

type T = (key: StringKey, vars?: Vars) => string;

/** What kind of slide this is, in a word or two (the label printed on the slide, or a name for the plain ones). */
export function kindCaption(t: T, layout: SlideLayout): string {
  if (layout.kind === 'cover') return t('sl.kind.cover');
  if (layout.kind === 'day') return t('sl.kind.day', { n: layout.day });
  if (layout.kind === 'credits') return t('sl.kind.credits');
  return layout.label ?? '';
}

/** "Slide 7 of 53: What do magnets attract?" */
export function slideName(t: T, layout: SlideLayout, total: number): string {
  const title = slideTitle(layout) || kindCaption(t, layout);
  return t('sl.slideOfTitle', { n: layout.index + 1, total, title });
}

export function SlideThumb({
  view,
  layout,
  onOpen,
  current,
  caption = true,
  mark,
  className,
  frameClassName,
  tone = 'light',
}: {
  view: DeckView;
  layout: SlideLayout;
  onOpen: (index: number) => void;
  /** The slide showing now (carousel, editor). */
  current?: boolean;
  caption?: boolean;
  /** A small note under the picture, e.g. "Changed". */
  mark?: ReactNode;
  className?: string;
  frameClassName?: string;
  /** `dark`: on the carousel's dark filmstrip. */
  tone?: 'light' | 'dark';
}) {
  const { t } = useT();
  const n = layout.index + 1;
  const title = slideTitle(layout) || kindCaption(t, layout);
  return (
    <button
      type="button"
      onClick={() => onOpen(layout.index)}
      aria-label={t('sl.openSlide', { n, title })}
      aria-current={current ? 'true' : undefined}
      data-slide-thumb={layout.id}
      className={cx('group flex min-w-0 flex-col gap-1.5 rounded text-left', className)}
    >
      <span
        className={cx(
          'block overflow-hidden rounded-sm transition-shadow',
          tone === 'dark'
            ? current
              ? 'ring-[3px] ring-yellow'
              : 'ring-1 ring-cream/25 group-hover:ring-cream/60'
            : current
              ? 'shadow-card ring-[3px] ring-talaTeal'
              : 'shadow-card ring-1 ring-hairline group-hover:shadow-lift group-hover:ring-talaTeal/50',
          frameClassName
        )}
      >
        <SlideView layout={layout} number={n} mediaUrl={view.mediaUrl} pictureUrl={view.slidePictureUrl?.(layout.index)} decorative />
      </span>
      {caption && (
        <span className={cx('flex items-baseline gap-1.5 px-0.5 text-small leading-snug', tone === 'dark' ? 'text-cream/80' : 'text-forestMuted')}>
          <span className={cx('font-semibold tabular-nums', tone === 'dark' ? 'text-cream' : 'text-forest')}>{n}</span>
          <span className="min-w-0 truncate">{kindCaption(t, layout)}</span>
          {mark}
        </span>
      )}
    </button>
  );
}
