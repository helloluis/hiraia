/**
 * Hand-drawn effect engine.
 *
 * Applies subtle jitter and roughness to paths and shapes to produce an
 * XKCD-like sketchy aesthetic. All functions are deterministic given a seed,
 * so re-rendering the same scene produces identical output.
 */

import type { Point } from '../types.js';

/** Simple seeded PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random value in [-range, +range]. */
function jitter(rng: () => number, range: number): number {
  return (rng() - 0.5) * 2 * range;
}

/** Apply roughness to a straight line segment, returning an SVG path d-string. */
export function roughLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  roughness: number,
  rng: () => number
): string {
  if (roughness <= 0) {
    return `M${r(x1)},${r(y1)}L${r(x2)},${r(y2)}`;
  }

  const len = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const segments = Math.max(2, Math.floor(len / 20));
  const j = roughness * 0.8;

  const points: Point[] = [[x1, y1]];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    points.push([
      x1 + (x2 - x1) * t + jitter(rng, j),
      y1 + (y2 - y1) * t + jitter(rng, j),
    ]);
  }
  points.push([x2, y2]);

  let d = `M${r(points[0]![0])},${r(points[0]![1])}`;
  for (let i = 1; i < points.length; i++) {
    d += `L${r(points[i]![0])},${r(points[i]![1])}`;
  }
  return d;
}

/** Generate a rough circle path (two slightly-offset passes for sketchiness). */
export function roughCircle(
  cx: number,
  cy: number,
  radius: number,
  roughness: number,
  rng: () => number
): string {
  if (roughness <= 0) {
    return `M${r(cx - radius)},${r(cy)}A${r(radius)},${r(radius)},0,1,1,${r(cx + radius)},${r(cy)}A${r(radius)},${r(radius)},0,1,1,${r(cx - radius)},${r(cy)}Z`;
  }

  const passes: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const segments = 24;
    const j = roughness * 0.4;
    let d = '';
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const rx = radius + jitter(rng, j);
      const ry = radius + jitter(rng, j);
      const x = cx + rx * Math.cos(angle);
      const y = cy + ry * Math.sin(angle);
      d += i === 0 ? `M${r(x)},${r(y)}` : `L${r(x)},${r(y)}`;
    }
    d += 'Z';
    passes.push(d);
  }
  return passes.join('');
}

/** Generate a rough ellipse path. */
export function roughEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  roughness: number,
  rng: () => number
): string {
  if (roughness <= 0) {
    return `M${r(cx - rx)},${r(cy)}A${r(rx)},${r(ry)},0,1,1,${r(cx + rx)},${r(cy)}A${r(rx)},${r(ry)},0,1,1,${r(cx - rx)},${r(cy)}Z`;
  }

  const passes: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const segments = 24;
    const j = roughness * 0.4;
    let d = '';
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const rxj = rx + jitter(rng, j);
      const ryj = ry + jitter(rng, j);
      const x = cx + rxj * Math.cos(angle);
      const y = cy + ryj * Math.sin(angle);
      d += i === 0 ? `M${r(x)},${r(y)}` : `L${r(x)},${r(y)}`;
    }
    d += 'Z';
    passes.push(d);
  }
  return passes.join('');
}

/** Generate a rough rectangle path. */
export function roughRect(
  x: number,
  y: number,
  w: number,
  h: number,
  roughness: number,
  rng: () => number
): string {
  const corners: Point[] = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  const sides: string[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    sides.push(roughLine(a[0], a[1], b[0], b[1], roughness, rng));
  }
  return sides.join('');
}

/** Generate a rough arc path. */
export function roughArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  roughness: number,
  rng: () => number
): string {
  const segments = Math.max(4, Math.floor(Math.abs(endAngle - startAngle) / 0.15));
  const j = roughness * 0.4;
  let d = '';
  for (let i = 0; i <= segments; i++) {
    const angle = startAngle + ((endAngle - startAngle) * i) / segments;
    const rad = radius + jitter(rng, j);
    const x = cx + rad * Math.cos(angle);
    const y = cy + rad * Math.sin(angle);
    d += i === 0 ? `M${r(x)},${r(y)}` : `L${r(x)},${r(y)}`;
  }
  return d;
}

/** Round to 2 decimal places to keep SVG strings compact. */
function r(n: number): number {
  return Math.round(n * 100) / 100;
}
