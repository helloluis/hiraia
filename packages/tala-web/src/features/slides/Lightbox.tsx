'use client';
/**
 * The carousel: one slide large and crisp, with big previous / next controls, swipe on touch, arrow keys, a
 * filmstrip of every slide, and the teacher notes for the slide on show. It is a modal dialog (focus stays inside,
 * Esc closes, focus returns to where it was) and works the same for the shared original and for a teacher's copy.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import type { DeckView } from './deck-model';
import { Presenter, type PresenterHandle } from './Presenter';
import { SlideView } from './SlideView';
import { SlideThumb, kindCaption, slideName } from './SlideThumb';

function BarButton({ icon, label, shortLabel, onClick, pressed }: { icon: IconName; label: string; shortLabel?: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex min-h-touch min-w-touch shrink-0 items-center justify-center gap-2 rounded px-3 text-body leading-tight',
        pressed ? 'bg-cream text-forest' : 'text-cream hover:bg-cream/15'
      )}
    >
      <Icon name={icon} size={20} />
      <span className="whitespace-nowrap">{shortLabel ?? label}</span>
    </button>
  );
}

export function Lightbox({
  view,
  index,
  onIndex,
  onClose,
  action,
}: {
  view: DeckView;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** One more control in the bar, e.g. "Edit my copy". */
  action?: ReactNode;
}) {
  const { t } = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const presenter = useRef<PresenterHandle>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const [notes, setNotes] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  // The slide is as large as the space allows in both directions (measured: works without container-query units).
  const [fit, setFit] = useState<number | null>(null);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const apply = () => setFit(Math.max(120, Math.floor(Math.min(el.clientWidth, (el.clientHeight * 16) / 9))));
    apply();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', apply);
      return () => window.removeEventListener('resize', apply);
    }
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const total = view.layouts.length;
  const at = Math.max(0, Math.min(index, total - 1));
  const layout = view.layouts[at]!;
  const go = useCallback((to: number) => onIndex(Math.max(0, Math.min(to, total - 1))), [onIndex, total]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!d.open) d.showModal();
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
      if (d.open) d.close();
    };
  }, []);

  // The filmstrip follows the slide on show.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-slide-thumb="${layout.id}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [layout.id]);

  // The drawings of the slides either side are fetched ahead, so moving on never shows an empty plate.
  useEffect(() => {
    for (const l of [view.layouts[at + 1], view.layouts[at - 1]]) {
      const src = l ? (view.slidePictureUrl ? view.slidePictureUrl(l.index) : l.picture ? view.mediaUrl(l.picture) : null) : null;
      if (!src) continue;
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
    }
  }, [at, view]);

  const onKey = (e: ReactKeyboardEvent) => {
    const k = e.key;
    const target = e.target as HTMLElement;
    if (target.closest('[data-notes]') && (k === 'ArrowUp' || k === 'ArrowDown' || k === 'PageUp' || k === 'PageDown' || k === ' ')) return;
    if (k === 'ArrowRight' || k === 'PageDown') {
      e.preventDefault();
      go(at + 1);
    } else if (k === 'ArrowLeft' || k === 'PageUp') {
      e.preventDefault();
      go(at - 1);
    } else if (k === 'Home') {
      e.preventDefault();
      go(0);
    } else if (k === 'End') {
      e.preventDefault();
      go(total - 1);
    } else if (k === ' ' && !target.closest('button, a, input, textarea')) {
      e.preventDefault();
      go(at + 1);
    }
  };
  const onDown = (e: ReactPointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: ReactPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.3) go(dx < 0 ? at + 1 : at - 1);
  };

  const arrow = 'inline-flex items-center justify-center rounded-full bg-cream/15 text-cream hover:bg-cream/30 disabled:opacity-30 disabled:hover:bg-cream/15';
  const caption = kindCaption(t, layout);
  return (
    <dialog
      ref={dialog}
      aria-label={`${t('sl.lb.title')}: ${view.title}`}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-forest p-0 text-cream backdrop:bg-forest"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={onKey}
    >
      <style>{'@keyframes sl-in{from{opacity:.35}to{opacity:1}}'}</style>
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-center gap-x-1 gap-y-0.5 px-2 py-1.5 wide:flex-nowrap wide:gap-2 wide:px-4 wide:py-2">
          <div className="min-w-0 flex-1 basis-[55%] px-1 wide:basis-auto">
            <p className="kicker flex items-center gap-1.5 text-yellow">
              <Icon name={view.kind === 'copy' ? 'pencil' : 'slides'} size={15} strokeWidth={2.1} />
              <span className="truncate">{t(view.kind === 'copy' ? 'sl.view.mine' : 'sl.view.original')}</span>
            </p>
            <p className="truncate font-display text-body wide:text-title">{view.title}</p>
          </div>
          {/* Phones: Close stays beside the title; the other controls sit on a row of their own below. */}
          <div className="wide:order-last">
            <BarButton icon="x" label={t('sl.lb.close')} onClick={onClose} />
          </div>
          <div className="flex w-full flex-wrap items-stretch gap-1 wide:w-auto wide:flex-nowrap wide:gap-2">
            <BarButton icon="notes" label={t('sl.lb.notes')} shortLabel={t('sl.lb.notesShort')} pressed={notes} onClick={() => setNotes((v) => !v)} />
            <BarButton icon="expand" label={t('sl.present')} onClick={() => presenter.current?.start(at)} />
            {action}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col wide:flex-row">
          <div className="relative min-h-[9rem] flex-1" onPointerDown={onDown} onPointerUp={onUp} style={{ touchAction: 'pan-y pinch-zoom' }}>
            <div ref={stage} className="absolute inset-0 mx-2 my-1 flex items-center justify-center wide:mx-20 wide:my-3">
              <div key={layout.id} className="shadow-lift" style={{ width: fit ?? '100%', visibility: fit ? 'visible' : 'hidden', animation: 'sl-in 160ms ease-out' }}>
                <SlideView layout={layout} number={at + 1} mediaUrl={view.mediaUrl} pictureUrl={view.slidePictureUrl?.(layout.index)} eager label={slideName(t, layout, total)} />
              </div>
            </div>
            <button type="button" onClick={() => go(at - 1)} disabled={at === 0} aria-label={t('sl.lb.prev')} className={cx(arrow, 'absolute left-3 top-1/2 hidden h-14 w-14 -translate-y-1/2 wide:inline-flex')}>
              <Icon name="chevronLeft" size={30} />
            </button>
            <button type="button" onClick={() => go(at + 1)} disabled={at === total - 1} aria-label={t('sl.lb.next')} className={cx(arrow, 'absolute right-3 top-1/2 hidden h-14 w-14 -translate-y-1/2 wide:inline-flex')}>
              <Icon name="chevronRight" size={30} />
            </button>
          </div>

          {notes && (
            <aside data-notes aria-label={t('sl.lb.notes')} tabIndex={0} className="max-h-[38dvh] shrink-0 overflow-y-auto bg-cream px-4 py-3 text-forest wide:max-h-none wide:w-[23rem] wide:rounded-tl-lg wide:px-5 wide:py-5">
              <p className="kicker flex items-center gap-1.5 text-talaTeal">
                <Icon name="notes" size={15} strokeWidth={2.1} />
                {t('sl.lb.notes')}
              </p>
              {layout.notes.trim() ? <p className="reading mt-2 whitespace-pre-wrap break-words">{layout.notes}</p> : <p className="mt-2 text-forestMuted">{t('sl.lb.noNotes')}</p>}
              <p className="mt-4 flex items-start gap-2 border-t border-hairline pt-3 text-small text-forestMuted">
                <Icon name="lock" size={16} className="mt-0.5" />
                <span>{t('sl.lb.notesOnlyYou')}</span>
              </p>
            </aside>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-2 wide:justify-center wide:py-1.5">
          <button type="button" onClick={() => go(at - 1)} disabled={at === 0} className={cx(arrow, 'min-h-[3.25rem] gap-1 px-4 font-medium wide:hidden')}>
            <Icon name="chevronLeft" size={22} />
            <span>{t('sl.lb.prevShort')}</span>
          </button>
          <p className="min-w-0 text-center leading-tight">
            <span className="block font-semibold tabular-nums">
              {at + 1} / {total}
            </span>
            {caption && <span className="block truncate text-small text-cream/75">{caption}</span>}
          </p>
          <button type="button" onClick={() => go(at + 1)} disabled={at === total - 1} className={cx(arrow, 'min-h-[3.25rem] gap-1 px-4 font-medium wide:hidden')}>
            <span>{t('sl.lb.nextShort')}</span>
            <Icon name="chevronRight" size={22} />
          </button>
        </div>

        <div ref={strip} role="group" aria-label={t('sl.lb.filmstrip')} className="strip flex shrink-0 gap-2 px-3 pb-3 pt-1 wide:gap-3 wide:px-5 wide:pb-4 [@media(max-height:520px)]:hidden" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          {view.layouts.map((l) => (
            <SlideThumb key={l.id} view={view} layout={l} onOpen={go} current={l.index === at} caption={false} tone="dark" className="w-[5.25rem] shrink-0 wide:w-[7.5rem]" />
          ))}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {slideName(t, layout, total)}
      </p>
      <p className="sr-only">{t('sl.lb.help')}</p>
      <Presenter ref={presenter} view={view} onExit={go} />
    </dialog>
  );
}
