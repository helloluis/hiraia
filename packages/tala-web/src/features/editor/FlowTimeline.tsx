'use client';
/**
 * Session Flow timeline bar: a calm pastel bar of the time blocks (one segment per block, width ∝ minutes), the
 * end-of-class mark, an unclipped brick overflow treatment, and a live "N out of M minutes" indicator (the
 * accessible source of truth, in a debounced polite live region). Sticky inside its own section only.
 *
 * Segments glide to their new place and size when blocks are moved or their minutes change (`tala-flow-seg`,
 * globals.css); the block that was just moved is ringed for a moment (`movedId`). The bar itself is hidden from
 * screen readers, so none of this is announced.
 */
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { cx } from '@/components/ui';
import { buildFlowTimeline, labelFits, type FlowBlockInput } from './flow-timeline';
import { GROUP_TINTS } from './blocks';

const NEUTRAL = 'bg-sage/30';

export function FlowTimeline({
  blocks,
  duration,
  movedId,
}: {
  blocks: FlowBlockInput[];
  duration: number;
  /** The block the teacher just moved, for about a second. */
  movedId?: string | null;
}) {
  const { t } = useT();
  const model = buildFlowTimeline(blocks, duration);
  const ref = useRef<HTMLDivElement>(null);
  const [pxWidth, setPxWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && setPxWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const text =
    model.state === 'over'
      ? t('flow.over', { n: model.total, m: model.duration })
      : model.state === 'exact'
        ? t('flow.exact', { n: model.total, m: model.duration })
        : t('flow.under', { n: model.total, m: model.duration });
  const sub =
    model.state === 'under' || model.state === 'empty'
      ? t('flow.unassigned', { n: model.remaining })
      : model.state === 'over'
        ? t('flow.overBy', { n: model.overflow })
        : '';
  // Debounced live region so typing minutes does not spam the screen reader.
  const [announced, setAnnounced] = useState(text);
  useEffect(() => {
    const id = setTimeout(() => setAnnounced(`${text}${sub ? `. ${sub}` : ''}`), 800);
    return () => clearTimeout(id);
  }, [text, sub]);

  return (
    <div
      className="sticky z-10 -mx-4 px-4 pt-2 pb-3 bg-white shadow-[0_6px_10px_-8px_rgba(28,59,46,0.35)]"
      style={{ top: 'var(--header-h, 0px)' }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-2">
        <p className={cx('font-medium', model.state === 'over' ? 'text-brick' : 'text-forest')}>
          {model.state === 'over' && <span aria-hidden="true">⚠ </span>}
          {text}
        </p>
        {sub && (
          <p
            className={cx('text-small', model.state === 'over' ? 'text-brick' : 'text-forestMuted')}
          >
            {sub}
          </p>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {announced}
      </p>
      <div ref={ref} aria-hidden="true" className="relative h-9 w-full">
        {/* track: class time */}
        <div
          className="absolute inset-y-0 left-0 rounded-l border border-hairline bg-cream/60"
          style={{ width: `${model.classEnd * 100}%` }}
        />
        {/* reserve beyond class time */}
        <div
          className="absolute inset-y-0 right-0 rounded-r border border-dashed border-hairline"
          style={{ width: `${(1 - model.classEnd) * 100}%` }}
        />
        {model.segments.map((s) => {
          const tint =
            s.tintIndex === null
              ? NEUTRAL
              : GROUP_TINTS[
                  ((s.tintIndex % GROUP_TINTS.length) + GROUP_TINTS.length) % GROUP_TINTS.length
                ]!;
          const insideWidth = s.width - s.overflowWidth;
          const fits = labelFits(s.label.length, s.width, pxWidth);
          const fitsMinutes = labelFits(String(s.minutes).length + 1, s.width, pxWidth);
          return (
            <div
              key={s.id}
              data-flow-moved={s.id === movedId ? '' : undefined}
              className="tala-flow-seg absolute inset-y-0"
              style={{ left: `${s.left * 100}%`, width: `${s.width * 100}%` }}
            >
              {insideWidth > 0 && (
                <div
                  className={cx(
                    'tala-flow-part absolute inset-y-0 left-0 border-r border-white',
                    tint
                  )}
                  style={{ width: `${(insideWidth / s.width) * 100}%` }}
                />
              )}
              {s.overflowWidth > 0 && (
                <div
                  className="tala-flow-part absolute inset-y-0 right-0 border border-brick"
                  style={{
                    width: `${(s.overflowWidth / s.width) * 100}%`,
                    backgroundImage:
                      'repeating-linear-gradient(135deg, rgba(122,46,34,0.35) 0 4px, rgba(122,46,34,0.08) 4px 8px)',
                  }}
                />
              )}
              <span className="absolute inset-0 flex items-center justify-center px-1 text-small text-forest whitespace-nowrap overflow-hidden">
                {fits ? s.label : fitsMinutes ? `${s.minutes}′` : ''}
              </span>
            </div>
          );
        })}
        {/* end-of-class mark */}
        <div
          className="absolute -top-1 -bottom-1 w-0.5 bg-forest"
          style={{ left: `calc(${model.classEnd * 100}% - 1px)` }}
        />
      </div>
      <div className="relative h-5 text-small text-forestMuted">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: `${model.classEnd * 100}%` }}
        >
          {t('flow.classEnd', { m: model.duration })}
        </span>
      </div>
    </div>
  );
}
