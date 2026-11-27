/**
 * Moving a block in a list (the lesson's time blocks and steps): the arithmetic, kept pure so it is tested without a
 * browser. The screen part is useReorderMotion.ts.
 *
 * What a teacher sees when she presses a block's arrow: the block she pressed stays under her finger, and the rest of
 * the timetable flows around it. That is what Chrome already did by scrolling the page the instant the order changed
 * (measured 27 Nov 2026: the page jumped 678 px and nothing appeared to move); here the same result is reached as one
 * continuous movement, in every browser.
 */

/** A box in DOCUMENT coordinates (viewport position + page scroll), in CSS pixels. */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ReorderMove {
  id: string;
  /** Offset that draws the item where it was before the change; the movement plays this down to zero. */
  dx: number;
  dy: number;
}

export interface ReorderPlan {
  moves: ReorderMove[];
  /** Items that were not there before (a block that was just added). */
  entered: string[];
  /** Page scroll that keeps the moved block where it was on screen (0 when nothing has to scroll). */
  scrollBy: number;
  /** Milliseconds: longer for a longer way, never slow. */
  duration: number;
}

/** Shorter than this is not a movement worth drawing. */
const MIN_DISTANCE = 1;
export const MIN_DURATION = 240;
export const MAX_DURATION = 440;

/** Longer ways take a little longer, within limits a tap never has to wait for. */
export function durationFor(distance: number): number {
  const d = Math.abs(distance);
  if (!Number.isFinite(d)) return MIN_DURATION;
  return Math.round(Math.max(MIN_DURATION, Math.min(MAX_DURATION, 200 + d * 0.25)));
}

export function planReorder(
  first: ReadonlyMap<string, Box>,
  last: ReadonlyMap<string, Box>,
  opts: { anchorId: string | null; scrollY: number; maxScrollY: number }
): ReorderPlan {
  const moves: ReorderMove[] = [];
  const entered: string[] = [];
  let longest = 0;
  for (const [id, to] of last) {
    const from = first.get(id);
    if (!from) {
      entered.push(id);
      continue;
    }
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < MIN_DISTANCE && Math.abs(dy) < MIN_DISTANCE) continue;
    moves.push({ id, dx, dy });
    longest = Math.max(longest, Math.hypot(dx, dy));
  }
  let scrollBy = 0;
  const from = opts.anchorId ? first.get(opts.anchorId) : undefined;
  const to = opts.anchorId ? last.get(opts.anchorId) : undefined;
  if (from && to) {
    const wanted = to.top - from.top;
    const max = Math.max(0, opts.maxScrollY);
    const target = Math.max(0, Math.min(max, opts.scrollY + wanted));
    scrollBy = Math.round(target - opts.scrollY);
    if (Math.abs(scrollBy) < MIN_DISTANCE) scrollBy = 0;
  }
  return { moves, entered, scrollBy, duration: durationFor(Math.max(longest, Math.abs(scrollBy))) };
}

/**
 * After a move, which of the block's two arrows holds the keyboard focus. The arrow that was pressed keeps it; when
 * that arrow is now switched off (the block reached the top or the bottom) the other one takes it, so a keyboard user
 * is never dropped back to the start of the page. Null: neither can take it.
 */
export function focusAfterMove(
  pressed: 'up' | 'down',
  disabled: { up: boolean; down: boolean }
): 'up' | 'down' | null {
  if (!disabled[pressed]) return pressed;
  const other = pressed === 'up' ? 'down' : 'up';
  return disabled[other] ? null : other;
}

/* ---------- easing: one curve for the whole app (the CSS side is --tala-ease in globals.css) ---------- */

export const EASE: readonly [number, number, number, number] = [0.2, 0, 0, 1];

/** cubic-bezier(x1, y1, x2, y2) at time t (0..1), as CSS computes it. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = -6 * x1 + 3 * x2;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = -6 * y1 + 3 * y2;
  const cy = 3 * y1;
  const x = (u: number) => ((ax * u + bx) * u + cx) * u;
  const y = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton's method, then bisection where the slope is too flat to trust.
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = x(u) - t;
      if (Math.abs(err) < 1e-5) return y(u);
      const slope = dx(u);
      if (Math.abs(slope) < 1e-6) break;
      u -= err / slope;
    }
    let lo = 0;
    let hi = 1;
    u = t;
    for (let i = 0; i < 30; i++) {
      const err = x(u) - t;
      if (Math.abs(err) < 1e-5) break;
      if (err > 0) hi = u;
      else lo = u;
      u = (lo + hi) / 2;
    }
    return y(u);
  };
}

export const ease = cubicBezier(...EASE);
