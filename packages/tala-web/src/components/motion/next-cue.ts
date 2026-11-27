/**
 * The next-step cue (NextStepCue.tsx): where the little arrow may sit and how often it may be shown. Pure, tested.
 *
 * The arrow is a hint, never a control: it takes no clicks, no focus and no screen-reader attention, and it is only
 * placed where it covers no words and no other control. If there is no such place it is simply not shown; the control
 * it would have pointed at is on the screen all the same.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Which way the arrow points. */
export type Pointing = 'right' | 'left' | 'up' | 'down';

/**
 * Where the arrow may sit, in order of preference:
 *  - beside the control (right, left, above, below), pointing at it;
 *  - on the control's own empty space at its start or end (a wide button has room beside its label), pointing at the
 *    label;
 *  - at the edge of the screen, pointing the way, when the control is further down or up the page.
 */
export type Place = 'right' | 'left' | 'above' | 'below' | 'inside-start' | 'inside-end' | 'edge';

export interface Candidate extends Rect {
  place: Place;
  pointing: Pointing;
  /** `edge` candidates stay where they are when the page scrolls; the others travel with the control. */
  fixed: boolean;
}

export const CUE_SIZE = 28;
const GAP = 6;
/** The arrow nudges this far towards the control; a candidate must have that much room too. */
export const CUE_TRAVEL = 6;
const EDGE_MARGIN = 10;

export const DEFAULT_ORDER: readonly Place[] = [
  'right',
  'left',
  'inside-start',
  'inside-end',
  'above',
  'below',
];

/** How much of the control is on screen (0..1), between a top and bottom that may be covered by fixed bars. */
export function visibleShare(target: Rect, view: { top: number; bottom: number }): number {
  if (target.height <= 0) return 0;
  const top = Math.max(target.top, view.top);
  const bottom = Math.min(target.top + target.height, view.bottom);
  return Math.max(0, bottom - top) / target.height;
}

const centredY = (t: Rect) => t.top + t.height / 2 - CUE_SIZE / 2;
const centredX = (t: Rect) => t.left + t.width / 2 - CUE_SIZE / 2;

/** Every place the arrow could sit for a control that is on screen, in the given order of preference. */
export function besideCandidates(
  target: Rect,
  order: readonly Place[] = DEFAULT_ORDER
): Candidate[] {
  const out: Candidate[] = [];
  for (const place of order) {
    const base = { width: CUE_SIZE, height: CUE_SIZE, place, fixed: false };
    if (place === 'right')
      out.push({
        ...base,
        left: target.left + target.width + GAP + CUE_TRAVEL,
        top: centredY(target),
        pointing: 'left',
      });
    else if (place === 'left')
      out.push({
        ...base,
        left: target.left - GAP - CUE_TRAVEL - CUE_SIZE,
        top: centredY(target),
        pointing: 'right',
      });
    else if (place === 'above')
      out.push({
        ...base,
        left: centredX(target),
        top: target.top - GAP - CUE_TRAVEL - CUE_SIZE,
        pointing: 'down',
      });
    else if (place === 'below')
      out.push({
        ...base,
        left: centredX(target),
        top: target.top + target.height + GAP + CUE_TRAVEL,
        pointing: 'up',
      });
    else if (place === 'inside-start' && target.width >= CUE_SIZE * 4)
      out.push({ ...base, left: target.left + 12, top: centredY(target), pointing: 'right' });
    else if (place === 'inside-end' && target.width >= CUE_SIZE * 4)
      out.push({
        ...base,
        left: target.left + target.width - 12 - CUE_SIZE,
        top: centredY(target),
        pointing: 'left',
      });
  }
  return out;
}

/**
 * Places at the bottom (or top) of the screen for a control that is further down (or up) the page: in line with the
 * control first, then towards its right and left end, then just outside it (a desktop page has an empty margin
 * beside a narrow column); then the same a little further in, row by row (a phone's bottom bar covers the first
 * rows, and long words can fill the next), up to about a third of a phone's height from the edge.
 */
export function edgeCandidates(
  target: Rect,
  view: { width: number; height: number },
  rowStep = 44
): Candidate[] {
  const below = target.top >= view.height / 2;
  const out: Candidate[] = [];
  const clamp = (x: number) =>
    Math.max(EDGE_MARGIN, Math.min(view.width - EDGE_MARGIN - CUE_SIZE, x));
  const columns = [
    centredX(target),
    target.left + target.width - CUE_SIZE - 12,
    target.left + 12,
    target.left + target.width + 16,
    target.left - 16 - CUE_SIZE,
  ].map(clamp);
  for (const row of [0, 1, 2, 3, 4, 5]) {
    const top = below
      ? view.height - EDGE_MARGIN - CUE_TRAVEL - CUE_SIZE - row * rowStep
      : EDGE_MARGIN + CUE_TRAVEL + row * rowStep;
    for (const x of columns)
      if (!out.some((c) => c.top === top && Math.abs(c.left - x) < CUE_SIZE))
        out.push({
          left: x,
          top,
          width: CUE_SIZE,
          height: CUE_SIZE,
          place: 'edge',
          pointing: below ? 'down' : 'up',
          fixed: true,
        });
  }
  return out;
}

/** The box the arrow sweeps while it nudges towards the control: nothing in it may be covered. */
export function sweep(c: Candidate): Rect {
  const dx = c.pointing === 'right' ? CUE_TRAVEL : c.pointing === 'left' ? -CUE_TRAVEL : 0;
  const dy = c.pointing === 'down' ? CUE_TRAVEL : c.pointing === 'up' ? -CUE_TRAVEL : 0;
  return {
    left: Math.min(c.left, c.left + dx),
    top: Math.min(c.top, c.top + dy),
    width: c.width + Math.abs(dx),
    height: c.height + Math.abs(dy),
  };
}

export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

/** The first candidate that is wholly on screen and free (as judged by the caller, who can see the page). */
export function choose(
  candidates: readonly Candidate[],
  view: { width: number; height: number },
  isFree: (box: Rect, c: Candidate) => boolean
): Candidate | null {
  for (const c of candidates) {
    const box = sweep(c);
    if (
      box.left < 2 ||
      box.top < 2 ||
      box.left + box.width > view.width - 2 ||
      box.top + box.height > view.height - 2
    )
      continue;
    if (isFree(box, c)) return c;
  }
  return null;
}

/* ---------- how often: once per visit to the app, and a few times in all ---------- */

/** After this many showings on a device a cue has done its teaching and stays away. */
export const MAX_SHOWINGS = 3;

export interface CueMemory {
  /** Cleared when the browser tab closes. */
  session: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Kept on the device. */
  device: Pick<Storage, 'getItem' | 'setItem'> | null;
}

const sessionKey = (key: string) => `tala.cue.seen.${key}`;
const deviceKey = (key: string) => `tala.cue.count.${key}`;

function read(store: CueMemory['session'], key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(store: CueMemory['session'], key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    /* private mode: the cue may simply show again */
  }
}

/** May this cue be shown now? Not twice in one visit, and not after it has been shown a few times on this device. */
export function mayShow(memory: CueMemory, key: string, max = MAX_SHOWINGS): boolean {
  if (read(memory.session, sessionKey(key)) === '1') return false;
  const count = Number(read(memory.device, deviceKey(key)) ?? '0');
  return !(Number.isFinite(count) && count >= max);
}

export function remember(memory: CueMemory, key: string): void {
  write(memory.session, sessionKey(key), '1');
  const count = Number(read(memory.device, deviceKey(key)) ?? '0');
  write(memory.device, deviceKey(key), String((Number.isFinite(count) ? count : 0) + 1));
}
