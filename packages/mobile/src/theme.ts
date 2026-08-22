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
  /** Felt-tip marker — big, short card facts (question-cards feed). */
  marker: 'PermanentMarker',
  /** Fat Clarendon slab — card numbers, fork banner, key chips (mid-century card). */
  slab: 'AlfaSlabOne',
  /** Squared low-contrast slab — every Tagalog sentence on a card. */
  cardBody: 'ZillaSlab',
  cardBodyBold: 'ZillaSlabBold',
  /** Tracked-out gothic caps — micro-labels, topic band, counters. */
  gothic: 'ArchivoBlack',
} as const;

// Map files for useFonts(). Keep keys in sync with `fonts` above.
export const fontAssets = {
  Mansalva: require('../assets/fonts/Mansalva-Regular.ttf'),
  CaveatBrush: require('../assets/fonts/CaveatBrush-Regular.ttf'),
  PatrickHand: require('../assets/fonts/PatrickHand-Regular.ttf'),
  PermanentMarker: require('../assets/fonts/PermanentMarker-Regular.ttf'),
  // mid-century card feed (design/mockups/midcentury.html)
  AlfaSlabOne: require('../assets/fonts/AlfaSlabOne-Regular.ttf'),
  ZillaSlab: require('../assets/fonts/ZillaSlab-Regular.ttf'),
  ZillaSlabBold: require('../assets/fonts/ZillaSlab-Bold.ttf'),
  // Archivo Black stands in for the mockup's Chivo 900: Chivo ships only as a
  // variable font and Android RN will not instance a weight axis reliably.
  ArchivoBlack: require('../assets/fonts/ArchivoBlack-Regular.ttf'),
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
  /** Blue ballpoint ink — "teacher's notes" (question-cards choices, corrections). */
  inkBlue: '#2743a6',
  /** Light teal-gray — the Menu/Settings panel ("notebook cover"). */
  cover: '#dde7e4',
  white: '#FFFFFF',
} as const;

/** Notebook ruling geometry (matches the web .notebook-paper gradient). */
export const notebook = {
  lineSpacing: 32,
  marginX: 44,
} as const;

/**
 * Question-cards feed — "mid-century classroom card" palette.
 * Reference implementation: design/mockups/midcentury.html.
 *
 * Deliberately a SEPARATE namespace from `colors` above: the chat, settings and loader
 * screens still run on the notebook theme, and restyling the whole app in one move would
 * be a much bigger blast radius than the feed overhaul this is for. When the rest of the
 * app follows, these become the app palette and `colors` retires.
 *
 * Ten colours, nothing outside this list. Every one of them harmonises with the cat
 * mascot (green/olive tabby, golden eyes, deep forest outlines, warm peach nose).
 */
export const card = {
  /** Card stock — warm cream. Also every label that sits ON a coloured fill. */
  stock: '#F4EAD5',
  /** Forest ink — body copy, card edge, printed rules. */
  ink: '#1C3B2E',
  /** The desk/board behind the deck. */
  board: '#20342C',
  /** Mustard gold — the SINGLE-PATH "next" ticket, i.e. the ordinary continuation. */
  gold: '#D8A03A',
  /** Dusty teal — quiz-page stock ONLY. Deliberately not a fork colour. */
  teal: '#2F6360',
  /**
   * Fork choices. Blue vs ochre rather than the first pass's red vs green, which read as
   * right-vs-wrong. Verified: cream-on-blue 7.21:1, cream-on-ochre 5.09:1 (the brick red
   * they replace FAILED AA at 4.33:1), hues 216deg/41deg so neither sits in the red or
   * green band, and the pair stays separated under deuteranopia, protanopia and
   * tritanopia. Both are held clear of `gold` so neither branch reads as the default.
   *
   * Known risk: ochre is in gold's hue family, separated mainly by lightness. If it reads
   * as "the dark gold one" on a cheap panel in daylight, #6B5114 is a drop-in replacement
   * (6.25:1, further from gold).
   */
  forkA: '#2B4C7E',
  forkB: '#7A5E22',
  /** Press graphite — fork banner + keyline. Neutral so it favours neither branch. */
  graphite: '#4D4740',
  /** Sage — hairlines, off-state ticks. */
  sage: '#8C9E6E',
  /** Warm peach — the printed mat around every engraving. */
  peach: '#E7B08B',
  /** Muted olive — small labels on cream. */
  olive: '#5B6B52',
  /** Plate white — the bed an engraving sits on (the art has a white background). */
  plate: '#FFFFFF',
} as const;

/**
 * A palette colour at partial opacity, e.g. `cardAlpha(card.ink, 0.55)`.
 *
 * The mid-century direction is a TEN-colour palette and nothing else, so the few places
 * that need a translucent tint (the printed drop under the card, an unlit meter tick, the
 * "thinking" veil) must derive it from a palette entry rather than hand-writing an rgba
 * literal that then drifts when a colour is retuned. Hex in, rgba out — the palette stays
 * the single source of truth.
 */
export function cardAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
