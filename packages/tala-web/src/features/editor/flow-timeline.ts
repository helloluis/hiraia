/**
 * Session Flow timeline model (pure, tested): blocks + class duration → segment geometry, overflow and label state.
 * The track's class-time end mark always sits at the same place (CLASS_END, 80 % of the component); overflow is
 * drawn into the reserve beyond it, compressed if needed, so the bar never causes page scrolling or silent clipping.
 */
export interface FlowBlockInput {
  id: string;
  label: string;
  minutes: number;
  /** Index of the grade group the teacher is with (for the tint), or null for whole-class / supervision blocks. */
  tintIndex: number | null;
}

export interface FlowSegment {
  id: string;
  label: string;
  minutes: number;
  tintIndex: number | null;
  /** Left edge and width as a fraction of the component (0–1). */
  left: number;
  width: number;
  /** Portion of this segment that lies beyond class time, as a fraction of the component (0 when within). */
  overflowLeft: number;
  overflowWidth: number;
}

export type FlowState = 'empty' | 'under' | 'exact' | 'over';

export interface FlowTimeline {
  segments: FlowSegment[];
  total: number;
  duration: number;
  /** Minutes not yet assigned (under) or beyond class time (over). */
  remaining: number;
  overflow: number;
  state: FlowState;
  /** Fraction of the component where class time ends. */
  classEnd: number;
}

export const CLASS_END = 0.8;

export function buildFlowTimeline(blocks: FlowBlockInput[], duration: number): FlowTimeline {
  const safeDuration = Math.max(1, Math.floor(duration) || 1);
  const valid = blocks.map((b) => ({
    ...b,
    minutes: Number.isFinite(b.minutes) && b.minutes > 0 ? Math.floor(b.minutes) : 0,
  }));
  const total = valid.reduce((n, b) => n + b.minutes, 0);
  const overflow = Math.max(0, total - safeDuration);
  const scale = CLASS_END / safeDuration; // component fraction per minute inside class time
  // Overflow is drawn in the reserve (1 − CLASS_END); compress only when it would not fit at the same scale.
  const reserve = 1 - CLASS_END;
  const overflowScale = overflow > 0 ? Math.min(scale, reserve / overflow) : scale;
  const segments: FlowSegment[] = [];
  let cursor = 0;
  for (const b of valid) {
    if (b.minutes === 0) continue;
    const start = cursor;
    const end = cursor + b.minutes;
    const inside = Math.max(0, Math.min(end, safeDuration) - Math.min(start, safeDuration));
    const outside = b.minutes - inside;
    const left =
      start < safeDuration ? start * scale : CLASS_END + (start - safeDuration) * overflowScale;
    const width = inside * scale + outside * overflowScale;
    const overflowLeft =
      outside > 0 ? CLASS_END + Math.max(0, start - safeDuration) * overflowScale : 0;
    const overflowWidth = outside * overflowScale;
    segments.push({
      id: b.id,
      label: b.label,
      minutes: b.minutes,
      tintIndex: b.tintIndex,
      left,
      width,
      overflowLeft,
      overflowWidth,
    });
    cursor = end;
  }
  const state: FlowState =
    total === 0 ? 'empty' : overflow > 0 ? 'over' : total === safeDuration ? 'exact' : 'under';
  return {
    segments,
    total,
    duration: safeDuration,
    remaining: Math.max(0, safeDuration - total),
    overflow,
    state,
    classEnd: CLASS_END,
  };
}

/** Whether a label of `chars` characters fits in a segment `width` (fraction) of a bar `pxWidth` px wide. */
export function labelFits(chars: number, width: number, pxWidth: number, pxPerChar = 7.5): boolean {
  return chars > 0 && width * pxWidth >= chars * pxPerChar + 12;
}
