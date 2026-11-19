/**
 * Text fitting for classroom slides: the same rough line-wrapping estimate the pack renderer uses
 * (packages/tala-packs/src/render/pptx.ts), so the browser view, the editor and the PowerPoint file a teacher
 * downloads all choose the same font size for the same words.
 */
export interface FitOptions {
  serif?: boolean;
  bold?: boolean;
  /** Space between paragraphs, in points. */
  paraGap?: number;
}

/** Estimated height in inches of `lines` set at `pt` points in a box `widthIn` inches wide. */
export function estimateHeight(lines: string[], widthIn: number, pt: number, opts: FitOptions = {}): number {
  const k = (opts.serif ? 0.5 : 0.47) * (opts.bold ? 1.06 : 1);
  const perRow = Math.max(4, Math.floor((widthIn * 72) / (pt * k)));
  let rows = 0;
  for (const l of lines) {
    const words = l.split(/\s+/);
    let row = 0;
    let used = 0;
    for (const w of words) {
      const need = used ? w.length + 1 : w.length;
      if (used + need > perRow) {
        row += 1;
        used = w.length;
      } else used += need;
    }
    rows += row + 1;
  }
  return (rows * pt * 1.2) / 72 + (lines.length - 1) * ((opts.paraGap ?? 10) / 72);
}

/** The first size (largest first) at which the text fits; the smallest size and `fits: false` when none does. */
export function pickSize(lines: string[], widthIn: number, heightIn: number, sizes: number[], opts: FitOptions = {}): { size: number; fits: boolean } {
  for (const s of sizes) if (estimateHeight(lines, widthIn, s, opts) <= heightIn) return { size: s, fits: true };
  return { size: sizes[sizes.length - 1]!, fits: false };
}

/** The model (or a teacher) sometimes numbers or dashes a line; the deck adds numbers and bullets itself. */
export const cleanLine = (l: string): string => l.replace(/^\s*(?:[-–•●*]\s+|step\s*\d{1,2}\s*[:.)-]\s*|\d{1,2}[.)]\s+)/i, '').trim();

/** Same words, ignoring case, spacing and punctuation. */
export const sameText = (a: string, b: string): boolean =>
  a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === b.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** "Day 2: Poles" → "Poles" (day slides print the day number on its own line). */
export const stripDayPrefix = (title: string): string => title.replace(/^(Day|Araw)\s*\d+\s*[:—-]\s*/i, '');
