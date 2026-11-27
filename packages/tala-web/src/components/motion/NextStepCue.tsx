'use client';
/**
 * A small arrow that floats in beside the one control that is the next step, nudges towards it, and fades out after
 * about two seconds. Wrap the control; the wrapper adds no box of its own:
 *
 *   <NextStepCue show={ready} cueKey="generate.start">
 *     <Button variant="primary" full>…</Button>
 *   </NextStepCue>
 *
 * `show` is a state of the screen (the action has become possible), never a timer or a tour. When the control is
 * further down or up the page the arrow waits at that edge of the screen and points the way.
 *
 * What it never does:
 *  - cover words or another control: it is placed only where the page is empty (the control's own blank ends count),
 *    and when there is no such place it is not shown at all;
 *  - take a click, the focus or a screen reader's attention (`pointer-events: none`, `aria-hidden`, not focusable);
 *  - nag: once per visit to the app and a few times in all per device (next-cue.ts), not while a sheet is open over
 *    the control, not while she is typing, not in a background tab.
 * Nothing depends on it: the control is there, labelled and reachable, whether or not the arrow appears.
 * Reduced motion: the arrow stands still for the same two seconds, then is gone.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_ORDER,
  besideCandidates,
  choose,
  edgeCandidates,
  intersects,
  mayShow,
  remember,
  type Candidate,
  type CueMemory,
  type Place,
  type Rect,
} from './next-cue';

/** From the start of the fade-in to the end of the fade-out (the `tala-cue` animation in globals.css is as long). */
export const CUE_LIFETIME_MS = 1800;
/** The screen gets this long to settle (records, fonts, a sheet closing) before a place is looked for. */
const SETTLE_MS = 500;
/** The keyboard must have been quiet this long: the arrow does not appear while she is typing. */
const QUIET_MS = 1500;
/** If no good moment comes in this time the cue is dropped for this visit to the screen. */
const GIVE_UP_MS = 12_000;

const CONTROLS =
  'a,button,input,select,textarea,summary,label,[role="button"],[role="switch"],[contenteditable="true"]';
const PICTURES = 'img,svg,canvas,video,picture';

interface Shown {
  cue: Candidate;
  host: HTMLElement;
  left: number;
  top: number;
}

function memory(): CueMemory {
  try {
    return { session: window.sessionStorage, device: window.localStorage };
  } catch {
    return { session: null, device: null };
  }
}

/** Nothing under the box but empty page (or the control's own blank space): no words, no other control, no picture. */
function isFree(box: Rect, target: HTMLElement): boolean {
  const seen = new Set<Element>();
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const x = box.left + 2 + ((box.width - 4) * i) / 3;
      const y = box.top + 2 + ((box.height - 4) * j) / 3;
      for (const el of document.elementsFromPoint(x, y)) {
        if (seen.has(el)) continue;
        seen.add(el);
        const own = el === target || target.contains(el);
        if (!own) {
          const control = el.closest(CONTROLS);
          if (control && !control.contains(target)) return false;
          if (el.matches(PICTURES) || el.closest('svg')) return false;
        }
        for (const node of Array.from(el.childNodes)) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of Array.from(range.getClientRects()))
            if (intersects({ left: r.left, top: r.top, width: r.width, height: r.height }, box))
              return false;
        }
      }
    }
  return true;
}

/** The element the arrow lives in: the sheet or the fixed/sticky bar the control is in, else the page. */
function hostOf(target: HTMLElement): HTMLElement {
  for (let el = target.parentElement; el && el !== document.body; el = el.parentElement) {
    if (el.tagName === 'DIALOG') return el;
    const position = getComputedStyle(el).position;
    if (position === 'fixed' || position === 'sticky') return el;
  }
  return document.body;
}

function findPlace(target: HTMLElement, order: readonly Place[], edge: boolean): Shown | null {
  const r = target.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const rect: Rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  const view = { width: window.innerWidth, height: window.innerHeight };
  // On screen means: its middle is really the control there (not off the page, not under a bar or a sheet).
  const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const onScreen = at !== null && (at === target || target.contains(at));
  const host = hostOf(target);
  if (onScreen) {
    const cue = choose(besideCandidates(rect, order), view, (box) => isFree(box, target));
    if (!cue) return null;
    if (host === document.body)
      return { cue, host, left: cue.left + window.scrollX, top: cue.top + window.scrollY };
    const h = host.getBoundingClientRect();
    return {
      cue,
      host,
      left: cue.left - h.left - host.clientLeft + host.scrollLeft,
      top: cue.top - h.top - host.clientTop + host.scrollTop,
    };
  }
  // Further down or up the page (never for a control inside a sheet or a bar: those are on screen or not in play).
  if (!edge || host !== document.body) return null;
  const cue = choose(edgeCandidates(rect, view), view, (box) => isFree(box, target));
  return cue ? { cue, host, left: cue.left, top: cue.top } : null;
}

export function NextStepCue({
  show,
  cueKey,
  prefer = DEFAULT_ORDER,
  edge = true,
  children,
}: {
  /** The state that makes this control the next step. */
  show: boolean;
  /** Names the cue for "once per visit, a few times in all", e.g. 'generate.start'. */
  cueKey: string;
  /** Places to try, in order (see next-cue.ts). */
  prefer?: readonly Place[];
  /** Point the way from the edge of the screen when the control is further down or up the page. */
  edge?: boolean;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const order = prefer.join(',');

  useEffect(() => {
    if (!show || !mayShow(memory(), cueKey)) return;
    const started = Date.now();
    let lastKey = 0;
    let timer = 0;
    let over = false;
    const onKey = () => {
      lastKey = Date.now();
    };
    const attempt = () => {
      if (over) return;
      const later = () => {
        if (Date.now() - started < GIVE_UP_MS) timer = window.setTimeout(attempt, 400);
      };
      const target = anchor.current?.firstElementChild;
      if (!(target instanceof HTMLElement) || document.visibilityState !== 'visible')
        return later();
      if (Date.now() - lastKey < QUIET_MS) return later();
      const sheet = document.querySelector('dialog[open]');
      if (sheet && !sheet.contains(target)) return later();
      const place = findPlace(target, order.split(',') as Place[], edge);
      // Nowhere free of words and controls: no cue. The control is on the screen without it.
      if (!place) return;
      remember(memory(), cueKey);
      setShown(place);
      timer = window.setTimeout(() => setShown(null), CUE_LIFETIME_MS);
    };
    window.addEventListener('keydown', onKey, true);
    timer = window.setTimeout(attempt, SETTLE_MS);
    return () => {
      over = true;
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      setShown(null);
    };
  }, [show, cueKey, order, edge]);

  return (
    <>
      <span ref={anchor} className="contents">
        {children}
      </span>
      {shown &&
        createPortal(
          <span
            aria-hidden="true"
            data-cue={cueKey}
            data-cue-place={shown.cue.place}
            data-cue-pointing={shown.cue.pointing}
            className="tala-cue"
            style={{
              position: shown.cue.fixed ? 'fixed' : 'absolute',
              left: shown.left,
              top: shown.top,
            }}
          >
            {/* Drawn twice: a white rim under the teal arrow, so it reads on cream, white and the dark cards alike. */}
            <svg
              viewBox="0 0 28 28"
              width="28"
              height="28"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path
                d="M6 14h15M14.5 7.5 21 14l-6.5 6.5"
                className="stroke-white"
                strokeWidth="6.5"
              />
              <path
                d="M6 14h15M14.5 7.5 21 14l-6.5 6.5"
                className="stroke-talaTeal"
                strokeWidth="3"
              />
            </svg>
          </span>,
          shown.host
        )}
    </>
  );
}
