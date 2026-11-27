'use client';
/**
 * The waiting state while Tala writes (a draft, a rewrite): a calm working mark and bar, one line that says where the
 * request really is, and the time actually waited. It replaces a still grey dot, so a teacher is never left looking
 * at a page that might have frozen.
 *
 *   <AiStatus phase={phase} startedAt={startedAt} label={t('gen.working')} onCancel={cancel} />
 *
 * `phase` comes from the request itself: 'sending' until `generation.create` answers, then the job's own status from
 * `pollJob(…, onTick)` ('queued' | 'running'). The caller shows this only while the request is open and takes it away
 * on done, failed, cancelled or when the screen closes, so nothing keeps running after the request has ended.
 *
 * Honest by construction (see ai-status.ts): no percentage, no invented step, no promise of when it ends.
 * Screen readers: the caption is a polite live region that changes a handful of times per request; the ticking time
 * and the bar are hidden from them. Reduced motion: the mark and the bar stand still (a full, pale bar, so it does not
 * read as "one third done"); the words and the time still update.
 */
import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { Button, Sparkle } from '@/components/ui';
import { aiCaption, formatElapsed, type AiCaption, type AiPhase } from './ai-status';

/** Every line a request can show, in the order it can show them. */
const CAPTIONS: readonly AiCaption[] = [
  'sending',
  'queued',
  'running',
  'still',
  'longer',
  'slow',
  'offline',
];

export function AiStatus({
  phase,
  startedAt,
  label,
  onCancel,
  canBackground = false,
  reachable = true,
}: {
  phase: AiPhase;
  /** `Date.now()` when the teacher asked. */
  startedAt: number;
  /** The existing line that names the work, e.g. t('gen.working'). */
  label: string;
  onCancel?: () => void;
  /** The screen offers "Run in background" next to this (the slow caption then mentions it). */
  canBackground?: boolean;
  /** False while the device cannot reach Tala. */
  reachable?: boolean;
}) {
  const { t } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  const elapsedMs = Math.max(0, now - startedAt);
  const caption = aiCaption({ phase, elapsedMs, reachable });
  const wordsFor = (c: AiCaption) =>
    c === 'slow' && canBackground ? t('ai.status.slowBackground') : t(`ai.status.${c}`);
  return (
    <div
      data-ai-status={caption}
      data-ai-phase={phase}
      className="tala-ai flex flex-col gap-3 rounded border border-talaTeal/40 bg-white px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="tala-ai-mark mt-0.5 shrink-0 text-talaTeal">
          <Sparkle />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{label}</p>
          <div className="grid">
            {/* Every line this request can show, unseen, in the same place: the box is as tall as the longest one
                from the start, so Cancel and the buttons below never move when the words change. */}
            {CAPTIONS.map((c) => (
              <p
                key={c}
                aria-hidden="true"
                className="invisible col-start-1 row-start-1 text-forestMuted break-words"
              >
                {wordsFor(c)}
              </p>
            ))}
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="col-start-1 row-start-1 text-forestMuted break-words"
            >
              <span key={caption} className="tala-ai-caption">
                {wordsFor(caption)}
              </span>
            </p>
          </div>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="tala-ai-bar h-1.5 w-full overflow-hidden rounded-full bg-talaTeal/15"
      >
        <span className="block h-full w-2/5 rounded-full bg-talaTeal" />
      </div>
      <div className="flex min-h-touch items-center justify-between gap-3">
        <span
          aria-hidden="true"
          data-ai-elapsed
          className="text-small text-forestMuted [font-variant-numeric:tabular-nums]"
        >
          {t('ai.status.elapsed', { time: formatElapsed(elapsedMs) })}
        </span>
        {onCancel && (
          <Button variant="quiet" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
