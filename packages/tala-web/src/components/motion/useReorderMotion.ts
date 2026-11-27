'use client';
/**
 * Movement for a list whose items a teacher reorders with arrow buttons (time blocks, procedure steps).
 *
 *   const motion = useReorderMotion(blocks.map((b) => b.id));
 *   <div ref={motion.listRef}>
 *     <div key={b.id} {...motion.item(b.id)}>
 *       <span {...motion.control('up')}><ArrowButton onClick={() => { motion.before({ id: b.id, direction: 'up' }); reorder(); }} /></span>
 *
 * `before` is called in the same handler, right before the change of order. Nothing here changes the order, the
 * content or how it is saved: it only reads where the items are drawn before and after React has moved them, and plays
 * the difference. So a movement is only ever shown for a change that really reached the screen, and an order that
 * changes for any other reason (another device, a rewrite) simply appears, as before.
 *
 * The item the teacher pressed stays where it was on screen: the page scrolls by the distance it travelled, in step
 * with the items (one clock, one curve, both set in the same frame). Focus stays on the item's arrow; when that arrow
 * is switched off at the top or the bottom, the other arrow takes it.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ease, focusAfterMove, planReorder, type Box, type ReorderPlan } from './reorder';
import { prefersReducedMotion } from './reduced-motion';

const ITEM = 'data-reorder-id';
const CONTROL = 'data-reorder-control';
/** A reading that no change of order follows within this time is dropped (the change did not happen). */
const CAPTURE_TTL_MS = 400;
/** How long the item that moved stays marked: a ring that fades; a still ring when motion is reduced. */
export const SETTLE_MS = 1300;
/** How long the words for a screen reader stay in the live region (the same words can then be said again). */
const ANNOUNCE_MS = 2500;
const ENTER_MS = 400;
/**
 * The most one frame may advance the movement. A slow frame (the first one sets the layers up; a busy phone drops
 * some) holds the movement up for a moment instead of skipping part of it, so it is always seen from its start.
 */
const MAX_STEP_MS = 34;

export interface MoveIntent {
  /** The item the teacher is moving. */
  id: string;
  direction: 'up' | 'down';
  /** Said once, politely, after the move has happened (existing interface words, e.g. "Time block 2"). */
  announce?: string;
}

interface Capture {
  first: Map<string, Box>;
  move: MoveIntent | null;
  scrollY: number;
  hadFocus: boolean;
}

interface Running {
  stop: () => void;
}

function measure(list: HTMLElement): Map<string, Box> {
  const out = new Map<string, Box>();
  const sx = window.scrollX;
  const sy = window.scrollY;
  for (const el of Array.from(list.children)) {
    const id = el.getAttribute(ITEM);
    if (id === null) continue;
    const r = el.getBoundingClientRect();
    out.set(id, { top: r.top + sy, left: r.left + sx, width: r.width, height: r.height });
  }
  return out;
}

function itemOf(list: HTMLElement, id: string): HTMLElement | null {
  for (const el of Array.from(list.children))
    if (el.getAttribute(ITEM) === id) return el as HTMLElement;
  return null;
}

function controlOf(item: HTMLElement | null, direction: 'up' | 'down'): HTMLButtonElement | null {
  return item?.querySelector<HTMLButtonElement>(`[${CONTROL}="${direction}"] button`) ?? null;
}

function play(list: HTMLElement, plan: ReorderPlan, cap: Capture, onEnd: () => void): Running {
  const items = plan.moves
    .map((m) => ({ ...m, el: itemOf(list, m.id) }))
    .filter((m): m is typeof m & { el: HTMLElement } => m.el !== null);
  const lifted = cap.move ? itemOf(list, cap.move.id) : null;
  const held = cap.move ? items.find((it) => it.id === cap.move!.id) : undefined;
  const scroll0 = cap.scrollY;
  let following = plan.scrollBy !== 0;
  let raf = 0;
  let ended = false;
  // Drawn where they were before anything is painted, so the first frame equals the last frame of the old order.
  for (const it of items) {
    it.el.style.willChange = 'transform';
    it.el.style.transform = `translate3d(${it.dx}px, ${it.dy}px, 0)`;
  }
  lifted?.setAttribute('data-reorder-lifted', '');
  if (window.scrollY !== scroll0) window.scrollTo(window.scrollX, scroll0);
  // The teacher scrolls herself: the page is hers, the items finish their way.
  const letGo = () => {
    following = false;
  };
  window.addEventListener('wheel', letGo, { passive: true });
  window.addEventListener('touchmove', letGo, { passive: true });
  const end = () => {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('wheel', letGo);
    window.removeEventListener('touchmove', letGo);
    for (const it of items) {
      it.el.style.transform = '';
      it.el.style.willChange = '';
    }
    lifted?.removeAttribute('data-reorder-lifted');
    onEnd();
  };
  // The clock starts with the first frame that is actually drawn, and never runs faster than the frames do.
  let previous = 0;
  let first = 0;
  let elapsed = 0;
  const frame = (now: number) => {
    if (previous === 0) first = previous = now;
    elapsed += Math.min(Math.max(0, now - previous), MAX_STEP_MS);
    previous = now;
    // A device too slow to draw it at all is not kept waiting: after three times its length the movement is over.
    const t = now - first > plan.duration * 3 ? 1 : Math.min(1, elapsed / plan.duration);
    const e = ease(t);
    // The page first, then the items: the held item is placed against where the page REALLY scrolled to (a browser
    // may round it), so it stays on the very same pixels instead of shimmering by half a pixel.
    let scrolled: number | null = null;
    if (following) {
      window.scrollTo(window.scrollX, scroll0 + plan.scrollBy * e);
      scrolled = window.scrollY - scroll0;
    }
    for (const it of items) {
      const dy =
        scrolled !== null && it === held
          ? it.dy - (it.dy + plan.scrollBy) * e + scrolled
          : it.dy * (1 - e);
      it.el.style.transform = `translate3d(${it.dx * (1 - e)}px, ${dy}px, 0)`;
    }
    if (t < 1) raf = requestAnimationFrame(frame);
    else end();
  };
  raf = requestAnimationFrame(frame);
  return { stop: end };
}

export function useReorderMotion(ids: readonly string[]) {
  const list = useRef<HTMLElement | null>(null);
  const pending = useRef<Capture | null>(null);
  const running = useRef<Running | null>(null);
  const timers = useRef<{ stale?: number; settle?: number; say?: number; enter?: number }>({});
  const [movedId, setMovedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const order = ids.join('\u0001');

  const listRef = useCallback((el: HTMLElement | null) => {
    list.current = el;
  }, []);

  const before = useCallback((move?: MoveIntent) => {
    const el = list.current;
    if (!el || typeof window === 'undefined') return;
    // Where everything is drawn right now, a movement still under way included: a second press continues from there.
    const first = measure(el);
    running.current?.stop();
    const control = move ? controlOf(itemOf(el, move.id), move.direction) : null;
    const cap: Capture = {
      first,
      move: move ?? null,
      scrollY: window.scrollY,
      hadFocus: control !== null && document.activeElement === control,
    };
    pending.current = cap;
    window.clearTimeout(timers.current.stale);
    timers.current.stale = window.setTimeout(() => {
      if (pending.current === cap) pending.current = null;
    }, CAPTURE_TTL_MS);
  }, []);

  // Runs after React has put the items in their new order and before the browser paints it.
  useLayoutEffect(() => {
    const cap = pending.current;
    pending.current = null;
    window.clearTimeout(timers.current.stale);
    const el = list.current;
    if (!cap || !el) return;
    const last = measure(el);
    const plan = planReorder(cap.first, last, {
      anchorId: cap.move?.id ?? null,
      scrollY: cap.scrollY,
      maxScrollY: document.documentElement.scrollHeight - window.innerHeight,
    });
    const moved = plan.moves.length > 0;
    if (cap.move && moved) {
      const t = timers.current;
      if (cap.hadFocus) {
        const item = itemOf(el, cap.move.id);
        const up = controlOf(item, 'up');
        const down = controlOf(item, 'down');
        const to = focusAfterMove(cap.move.direction, {
          up: !up || up.disabled,
          down: !down || down.disabled,
        });
        const target = to === 'up' ? up : to === 'down' ? down : null;
        if (target && document.activeElement !== target) target.focus({ preventScroll: true });
      }
      setMovedId(cap.move.id);
      window.clearTimeout(t.settle);
      t.settle = window.setTimeout(() => setMovedId(null), SETTLE_MS);
      if (cap.move.announce) {
        setAnnouncement(cap.move.announce);
        window.clearTimeout(t.say);
        t.say = window.setTimeout(() => setAnnouncement(''), ANNOUNCE_MS);
      }
    }
    if (plan.entered.length) {
      const fresh = plan.entered
        .map((id) => itemOf(el, id))
        .filter((x): x is HTMLElement => x !== null);
      for (const f of fresh) f.setAttribute('data-reorder-enter', '');
      timers.current.enter = window.setTimeout(() => {
        for (const f of fresh) f.removeAttribute('data-reorder-enter');
      }, ENTER_MS);
    }
    if (!moved && !plan.scrollBy) return;
    if (prefersReducedMotion()) {
      // No movement: the new order is simply there, with the pressed item still under the finger.
      if (plan.scrollBy) window.scrollTo(window.scrollX, cap.scrollY + plan.scrollBy);
      return;
    }
    running.current = play(el, plan, cap, () => {
      running.current = null;
    });
  }, [order]);

  useEffect(() => {
    const t = timers.current;
    return () => {
      running.current?.stop();
      window.clearTimeout(t.stale);
      window.clearTimeout(t.settle);
      window.clearTimeout(t.say);
      window.clearTimeout(t.enter);
    };
  }, []);

  return useMemo(
    () => ({
      listRef,
      before,
      /** The item that just moved, for about a second (its ring, and its segment in the timeline bar). */
      movedId,
      /** Words for a screen reader after a move; render them once in a polite live region. */
      announcement,
      item: (id: string) => ({
        [ITEM]: id,
        'data-reorder-settled': movedId === id ? '' : undefined,
      }),
      control: (direction: 'up' | 'down') => ({ [CONTROL]: direction }),
    }),
    [listRef, before, movedId, announcement]
  );
}

export type ReorderMotion = ReturnType<typeof useReorderMotion>;
