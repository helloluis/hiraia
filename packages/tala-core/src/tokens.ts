/**
 * Hiraia brand tokens for Tala (PRD §4.3.1, BRAND-1/1a/2). The ONE place colours and fonts are defined.
 * Web, mobile and the PDF print template all read this file; no colour or font is hard-coded in a component.
 *
 * Sources (13 Nov 2026): packages/brand/README.md (forest, cream, golds, Fraunces),
 * packages/web/src/app/globals.css (--plate, --teal, --accent, --sage), packages/tala/brand/README.md (Tala teal).
 * OWNER: orchestrator.
 */
export const colors = {
  /** Text, headers. 10.4:1 on cream, 12.3:1 on white. */
  forest: '#1C3B2E',
  /** App background. */
  cream: '#F5ECD6',
  /** Cards, editor surface, PDF page. */
  white: '#FFFFFF',
  /** THE Tala accent: primary button fill (white label, 5.2:1), active nav item, selected/today, progress, focus ring. */
  talaTeal: '#087A78',
  /** Text-safe companion for teal TEXT on cream (5.8:1): links, secondary text actions. */
  talaTealText: '#2F6360',
  /** Wordmark and decoration only. Never text (2.6:1 on cream). */
  gold: '#BD8928',
  /** Glyph, highlights, accents on forest (6.7:1 on forest). */
  yellow: '#E9B949',
  /** Errors, conflicts, destructive actions (8.0:1 on cream). Always with an icon or word. */
  brick: '#7A2E22',
  /** "Taught" / success fills. Not for text on cream. Always with an icon or word. */
  sage: '#8C9E6E',
  /** Derived neutrals (forest at reduced opacity over cream/white) for borders, placeholders, muted text. */
  hairline: 'rgba(28, 59, 46, 0.14)',
  placeholder: 'rgba(28, 59, 46, 0.08)',
  /** Muted text: forest at 72% — keeps ≥ 4.5:1 on cream and white. */
  forestMuted: 'rgba(28, 59, 46, 0.72)',
} as const;

export type ColorToken = keyof typeof colors;

export const fonts = {
  /** Display: Fraunces SemiBold, bundled (packages/brand/fonts/Fraunces-SemiBold.ttf). Titles only. */
  display: 'FrauncesSemiBold',
  displayWebStack: "'Fraunces', Georgia, 'Times New Roman', serif",
  /** Body and UI: the device's system font. Nothing is downloaded at runtime (BRAND-4). */
  bodyWebStack: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', Arial, sans-serif",
  /** In React Native leave fontFamily undefined for body text to get the system font. */
  bodyNative: undefined as string | undefined,
} as const;

/** dp / px. Body text never below 16; touch targets never below 48 (SIMPLE-7). */
export const sizes = {
  textBody: 16,
  textSmall: 14,
  textLabel: 14,
  textTitle: 22,
  textDisplay: 28,
  lineHeightBody: 24,
  touchTarget: 48,
  touchGap: 8,
  radius: 12,
  radiusSmall: 8,
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  /** Layouts are single column below this width (SCR-2). */
  wideBreakpoint: 840,
  minWidth: 320,
} as const;

/**
 * Colour pairings that are allowed for text and controls. CI checks each meets WCAG AA (BRAND-5).
 * [foreground, background, minimum ratio]
 */
export const CONTRAST_PAIRS: ReadonlyArray<readonly [ColorToken, ColorToken, number]> = [
  ['forest', 'cream', 4.5],
  ['forest', 'white', 4.5],
  ['white', 'talaTeal', 4.5],
  ['talaTeal', 'white', 4.5],
  ['talaTealText', 'cream', 4.5],
  ['talaTealText', 'white', 4.5],
  ['brick', 'cream', 4.5],
  ['brick', 'white', 4.5],
  ['white', 'brick', 4.5],
  ['yellow', 'forest', 4.5],
  ['cream', 'forest', 4.5],
];

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #RRGGBB colour. */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
