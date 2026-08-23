/**
 * How a card with no illustration sets its type.
 *
 * A poster card has to earn its place next to an illustrated one, so it does what a picture
 * does: give the eye somewhere to land before it starts reading. The landing point is the
 * card's own subject — the term the editorial pass marked — and the layout is chosen by where
 * that term sits and what kind of thing it is.
 *
 *   numeral  a short quantity ("12 metro", "200 beses") set very large. A number IS the point
 *            of those cards and reads as an image in a way a word does not.
 *   lead     the term near the opening, lifted onto its own line at 1.5x. The words before it
 *            ("Ang", "Sa halimbawa ng acacia, ang") drop back in weight so the term is what
 *            the eye hits first. This is the common case: 60% of the deck.
 *   inline   the term set in the accent mid-sentence. Used when the term arrives too late for
 *            a lead — pulling it out would break the reading order to decorate it.
 *   plain    no usable span. 2.6% of cards, and a perfectly good outcome.
 */
export type PosterKind = 'numeral' | 'lead' | 'inline' | 'plain';

/**
 * HOW the emphasis is drawn, as distinct from WHERE the layout puts it.
 *
 * One treatment used 29,000 times stops being emphasis and becomes wallpaper — a reader who
 * has seen forty oxblood words in a row is no longer looking at the forty-first. So the deck
 * carries several, and a card picks one from those valid for its layout.
 *
 * Display treatments (the term on its own line):
 *   accent    bold slab in the accent. The quiet default.
 *   knockout  card stock reversed out of an ink block. The loudest; reads as a printed chip.
 *   rule      ink bold over a thick accent rule — a printed underscore, not a text decoration.
 *   outline   ink bold inside a ruled box, like a term boxed on a worksheet.
 *   figure    the display slab at 1.9x, RESERVED for quantities. It is too heavy for a word.
 *
 * Inline treatments (the term inside the sentence):
 *   accent    bold in the accent.
 *   highlight ink on a peach swatch — the mat's own colour, so it reads as marked, not
 *             pasted in.
 *   underline bold accent, underlined.
 *   caps      tracked-out gothic caps in graphite. The most restrained; works where the term
 *             is a category rather than a name.
 */
export type EmphasisStyle =
  | 'accent'
  | 'knockout'
  | 'rule'
  | 'outline'
  | 'figure'
  | 'highlight'
  | 'underline'
  | 'caps';

const DISPLAY_WORD: EmphasisStyle[] = ['accent', 'knockout', 'rule', 'outline'];
const DISPLAY_FIGURE: EmphasisStyle[] = ['figure', 'knockout', 'outline'];
const INLINE: EmphasisStyle[] = ['accent', 'highlight', 'underline', 'caps'];

/**
 * Stable per card, so a card looks the same every time it is seen — variety across the deck,
 * not flicker within it. Hashing the id rather than counting position also means the choice
 * does not shift when the feed reorders.
 */
function hash(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function emphasisStyleFor(id: string, kind: PosterKind): EmphasisStyle {
  const set = kind === 'numeral' ? DISPLAY_FIGURE : kind === 'lead' ? DISPLAY_WORD : INLINE;
  return set[hash(id) % set.length] ?? 'accent';
}

export interface PosterSpec {
  kind: PosterKind;
  /** Which treatment draws the span. Meaningless for `plain`. */
  style: EmphasisStyle;
  /** Text before the emphasised span (empty for `plain`). */
  before: string;
  /** The emphasised span itself (empty for `plain`). */
  term: string;
  /** Text after the span. */
  after: string;
}

/** A span this short and this numeric reads as a figure rather than a phrase. */
const NUMERAL_MAX_CHARS = 14;
const NUMERAL_MAX_WORDS = 3;
/** Past this, a lifted term wraps to two display lines and stops being a landing point. */
const LEAD_MAX_CHARS = 28;
/** A term after this point in the sentence is too late to lift without breaking the read. */
const LEAD_MAX_POSITION = 0.35;

export function posterFor(
  text: string,
  spans: readonly string[] | undefined,
  id: string
): PosterSpec {
  const plain: PosterSpec = { kind: 'plain', style: 'accent', before: '', term: '', after: text };
  const term = spans?.[0];
  if (!term) return plain;

  const i = text.indexOf(term);
  // The span was chosen against this language's text, but a card can be rewritten after the
  // fact and a Q&A card is split before it gets here — so the span genuinely may not be in
  // the string being laid out. Falling through to `plain` is correct; slicing on -1 would
  // silently garble the sentence.
  if (i < 0) return plain;

  const before = text.slice(0, i);
  let after = text.slice(i + term.length);

  const isNumeral =
    /\d/.test(term) &&
    term.length <= NUMERAL_MAX_CHARS &&
    term.trim().split(/\s+/).length <= NUMERAL_MAX_WORDS;
  const isLead = term.length <= LEAD_MAX_CHARS && i / Math.max(text.length, 1) < LEAD_MAX_POSITION;

  if (!isNumeral && !isLead) {
    return { kind: 'inline', style: emphasisStyleFor(id, 'inline'), before, term, after };
  }

  // A display line followed by nothing but "." or "!" strands that punctuation on its own
  // line; hang it off the term instead.
  const tail = after.trim();
  let display = term;
  if (tail.length > 0 && tail.length <= 2 && !/\w/.test(tail)) {
    display = term + tail;
    after = '';
  }
  const kind: PosterKind = isNumeral ? 'numeral' : 'lead';
  return { kind, style: emphasisStyleFor(id, kind), before, term: display, after };
}

/** Multiplier on the body size for the display line. */
export function displayScale(kind: PosterKind): number {
  return kind === 'numeral' ? 1.9 : 1.5;
}
