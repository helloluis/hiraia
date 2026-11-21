'use client';
/**
 * Presenting to the class: the slide alone on a black screen, full screen where the browser allows it (a plain
 * full-window overlay where it does not, e.g. on an iPhone). Tap or click the right side for the next slide, the
 * left side to go back; arrow keys, Page Up/Down, Space, Home and End work too; Esc stops. Teacher notes are never
 * shown here: the class is looking at this screen.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useT } from '@/i18n';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import type { DeckView } from './deck-model';
import { SlideView } from './SlideView';
import { slideName } from './SlideThumb';

export interface PresenterHandle {
  /** Call from the click itself (browsers only allow full screen from a user action). */
  start(index: number): void;
}

type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
interface WakeLockLike {
  release(): Promise<void>;
}

const fullscreenElement = () => (typeof document === 'undefined' ? null : (document.fullscreenElement ?? (document as FsDocument).webkitFullscreenElement ?? null));

export const Presenter = forwardRef<PresenterHandle, { view: DeckView; onExit?: (index: number) => void }>(function Presenter({ view, onExit }, ref) {
  const { t } = useT();
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const total = view.layouts.length;
  const [active, setActive] = useState(false);
  /** 0 … total-1 are slides; `total` is the closing "end of the slides" screen. */
  const [index, setIndex] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [hint, setHint] = useState(false);
  const live = useRef({ active: false, index: 0, total, wentFull: false });
  live.current.active = active;
  live.current.index = index;
  live.current.total = total;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useRef<WakeLockLike | null>(null);
  const swipe = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const showChrome = useCallback(() => {
    setChrome(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), 2800);
  }, []);

  const exit = useCallback(() => {
    if (!live.current.active) return;
    live.current.active = false;
    live.current.wentFull = false;
    setActive(false);
    setHint(false);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    if (fullscreenElement()) {
      const doc = document as FsDocument;
      try {
        const p = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.();
        if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => {});
      } catch {
        /* already left */
      }
    }
    if (dialog.current?.open) dialog.current.close();
    wake.current?.release().catch(() => {});
    wake.current = null;
    onExit?.(Math.min(live.current.index, Math.max(0, live.current.total - 1)));
  }, [onExit]);

  useImperativeHandle(
    ref,
    () => ({
      start(i: number) {
        const d = dialog.current;
        const s = stage.current as FsElement | null;
        if (!d || !s) return;
        const at = Math.max(0, Math.min(i, live.current.total - 1));
        live.current.active = true;
        live.current.index = at;
        live.current.wentFull = false;
        setIndex(at);
        setActive(true);
        setHint(true);
        if (hintTimer.current) clearTimeout(hintTimer.current);
        hintTimer.current = setTimeout(() => setHint(false), 4500);
        if (!d.open) d.showModal();
        s.focus({ preventScroll: true });
        try {
          const p = s.requestFullscreen ? s.requestFullscreen() : s.webkitRequestFullscreen?.();
          if (p && typeof (p as Promise<void>).then === 'function') (p as Promise<void>).then(() => (live.current.wentFull = true)).catch(() => {});
        } catch {
          /* no full screen here: the dialog already covers the window */
        }
        const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } };
        nav.wakeLock
          ?.request('screen')
          .then((l) => {
            if (live.current.active) wake.current = l;
            else l.release().catch(() => {});
          })
          .catch(() => {});
        showChrome();
      },
    }),
    [showChrome]
  );

  // Leaving full screen with Esc (or the browser's own control) stops presenting.
  useEffect(() => {
    const onFs = () => {
      if (fullscreenElement() === stage.current) live.current.wentFull = true;
      else if (live.current.wentFull && live.current.active) exit();
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  }, [exit]);
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (hintTimer.current) clearTimeout(hintTimer.current);
      wake.current?.release().catch(() => {});
    },
    []
  );

  const go = useCallback(
    (to: number) => {
      const t0 = live.current.total;
      if (to > t0) return exit();
      setIndex(Math.max(0, Math.min(to, t0)));
    },
    [exit]
  );
  const next = useCallback(() => go(live.current.index + 1), [go]);
  const prev = useCallback(() => go(live.current.index - 1), [go]);

  const onKey = (e: ReactKeyboardEvent) => {
    if (!active) return;
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      exit();
      return;
    }
    if (index >= total) {
      e.preventDefault();
      if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') prev();
      else exit();
      return;
    }
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') {
      if ((k === ' ' || k === 'Enter') && (e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      next();
    } else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') {
      e.preventDefault();
      prev();
    } else if (k === 'Home') {
      e.preventDefault();
      go(0);
    } else if (k === 'End') {
      e.preventDefault();
      go(total - 1);
    }
  };

  const onDown = (e: ReactPointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onUp = (e: ReactPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || !active) return;
    if ((e.target as HTMLElement).closest('[data-presenter-controls]')) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    showChrome();
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      if (dx < 0) next();
      else prev();
      return;
    }
    if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return; // a drag that was not a swipe
    if (index >= total) return exit();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientX - rect.left < rect.width * 0.33) prev();
    else next();
  };

  const layout = index < total ? view.layouts[index] : undefined;
  return (
    <dialog
      ref={dialog}
      aria-label={t('sl.pr.label')}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-printInk p-0 text-white backdrop:bg-printInk"
      onCancel={(e) => {
        e.preventDefault();
        exit();
      }}
      onKeyDown={onKey}
    >
      <div
        ref={stage}
        tabIndex={-1}
        className="relative flex h-full w-full touch-none select-none items-center justify-center bg-printInk outline-none"
        style={{ cursor: chrome ? 'default' : 'none' }}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse') showChrome();
        }}
        onPointerDown={onDown}
        onPointerUp={onUp}
      >
        {active && layout && (
          <div style={{ width: 'min(100vw, calc(100dvh * 16 / 9))' }}>
            <SlideView layout={layout} number={index + 1} mediaUrl={view.mediaUrl} pictureUrl={view.slidePictureUrl?.(layout.index)} eager label={slideName(t, layout, total)} />
          </div>
        )}
        {active && !layout && (
          <div className="px-6 text-center">
            <p className="font-display text-headline">{t('sl.pr.end')}</p>
            <p className="mt-2 text-white/70">{t('sl.pr.endHint')}</p>
          </div>
        )}
        {active && hint && layout && (
          <p className="pointer-events-none absolute inset-x-4 bottom-24 mx-auto w-fit max-w-full rounded-lg bg-printInk/75 px-4 py-2 text-center text-small text-white">{t('sl.pr.hint')}</p>
        )}
        {active && (
          <>
            {/* Always within reach, also on a phone with no keyboard: the way out, top right. */}
            <div data-presenter-controls className={cx('absolute right-3 top-3 transition-opacity duration-300', chrome ? 'opacity-100' : 'pointer-events-none opacity-0')} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
              <button type="button" onClick={exit} className="inline-flex h-12 items-center gap-2 whitespace-nowrap rounded-full bg-printInk/75 px-4 font-medium text-white hover:bg-printInk">
                <Icon name="x" size={20} />
                <span>{t('sl.pr.exit')}</span>
              </button>
            </div>
            <div
              data-presenter-controls
              className={cx(
                'absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-printInk/75 p-1 text-white transition-opacity duration-300',
                chrome ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <button type="button" onClick={prev} disabled={index === 0} aria-label={t('sl.lb.prev')} className="inline-flex h-12 w-12 items-center justify-center rounded-full hover:bg-white/20 disabled:opacity-35">
                <Icon name="chevronLeft" size={24} />
              </button>
              <span className="min-w-[4.5rem] px-1 text-center tabular-nums" aria-hidden="true">
                {Math.min(index + 1, total)} / {total}
              </span>
              <button type="button" onClick={next} aria-label={t('sl.lb.next')} className="inline-flex h-12 w-12 items-center justify-center rounded-full hover:bg-white/20">
                <Icon name="chevronRight" size={24} />
              </button>
            </div>
          </>
        )}
        <p className="sr-only" aria-live="polite">
          {active && layout ? slideName(t, layout, total) : active ? t('sl.pr.end') : ''}
        </p>
      </div>
    </dialog>
  );
});
