/**
 * Hiraia brand theme — mirrors packages/web (globals.css / tailwind.config.js).
 * Hand-drawn, notebook-paper aesthetic.
 */

// Font family names — these strings must match the keys passed to useFonts() in _layout.tsx.
export const fonts = {
  /** Brand title (logo wordmark). */
  title: 'Mansalva',
  /** Headers / bold / display. */
  display: 'CaveatBrush',
  /** Body + UI text. */
  body: 'PatrickHand',
} as const;

// Map files for useFonts(). Keep keys in sync with `fonts` above.
export const fontAssets = {
  Mansalva: require('../assets/fonts/Mansalva-Regular.ttf'),
  CaveatBrush: require('../assets/fonts/CaveatBrush-Regular.ttf'),
  PatrickHand: require('../assets/fonts/PatrickHand-Regular.ttf'),
};

export const colors = {
  /** Notebook paper cream (--background). */
  paper: '#fdfdf6',
  /** Dark teal ink (--foreground). */
  ink: '#0c343d',
  /** Primary teal (tailwind primary-500/600). */
  primary: '#165a6a',
  primaryDark: '#0f4a56',
  /** Dark green — the model-loading progress bar. */
  greenDark: '#0c6e47',
  /** Muted ink for secondary text. */
  inkMuted: '#5a7178',
  /** Notebook ruling — horizontal blue lines. */
  rule: 'rgba(120, 170, 210, 0.4)',
  /** Notebook margin — vertical pink line. */
  margin: 'rgba(244, 143, 160, 0.5)',
  /** Assistant bubble fill (slightly warmer than paper). */
  bubble: '#f3f1e4',
  /** Hairline borders. */
  hairline: 'rgba(12, 52, 61, 0.12)',
  /** Warm gold — 'beta'/heads-up accents (mirrors the web yellow download section). */
  accent: '#f2c14e',
  white: '#FFFFFF',
} as const;

/** Notebook ruling geometry (matches the web .notebook-paper gradient). */
export const notebook = {
  lineSpacing: 32,
  marginX: 44,
} as const;
