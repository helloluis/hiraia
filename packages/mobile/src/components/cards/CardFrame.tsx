/**
 * The printed furniture every page of the question-cards deck shares, in ONE place.
 *
 * Four page components (CardPage, QuestionPage, RewardCard, ResponseCard) are printed on
 * the same physical card, so the parts that make it that card — the punched binder holes,
 * the inner keyline, the index band, the printed rule, the gold ticket and its ledge —
 * must be identical on all four. They were four copies before this file existed and had
 * already drifted (10px vs 10.5px topic labels, 24px vs 26px cat stamps, a 13px vs an
 * 11px row ledge, three different arrow implementations). One definition, four callers.
 *
 * Geometry is straight off design/mockups/midcentury.html (`.card`, `.keyline`, `.hole`,
 * `.band`, `.no`, `.topic`, `.stamp`, `.divider`, `.ledge`, `.tab`, `.arrow`) and colours
 * come only from `card` in theme.ts.
 *
 * DIVISION OF LABOUR: CardFeedScreen owns the card SURFACE (stock, the 3px ink edge, the
 * rounded corners, the ledge under it, the board) because the surface has to survive the
 * page peel and the outgoing snapshot needs it too. The page components print ON that
 * surface, inside `cardFrame.content`.
 *
 * Every "shadow" here is a ledge — a darker parent View with a few px of bottom padding —
 * because RN on Android ignores shadowOffset/shadowRadius and honours only `elevation`,
 * which cannot be offset downward.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import { card, fonts } from '../../theme';

/** The card surface, owned by CardFeedScreen — exported so the shell and the pages agree. */
export const CARD_RADIUS = 18;
export const CARD_EDGE = 3;

/** Which colour the inner keyline is printed in. */
export type KeylineTone = 'sage' | 'graphite' | 'gold';

/**
 * Which colour the index band is printed in, and with it the chip and label that ride on
 * it. Not free-form: the band tells the kid what KIND of page they are on, so the four
 * tones are the four kinds — ordinary card, fork, interject (quiz/reward), search answer.
 */
export type BandTone = 'ink' | 'graphite' | 'gold' | 'olive';

interface BandInk {
  band: string;
  chip: string;
  chipText: string;
  label: string;
}

/**
 * Contrast measured against the fill each colour actually sits on: gold chip on ink
 * 5.25:1, cream label on ink 11.6:1 / on graphite 6.9:1 / on olive 4.79:1, and on the gold
 * band both the chip and the label invert to ink (5.25:1), exactly as the mockup's
 * `.band.b-quiz .no` / `.band.b-quiz .topic` do.
 */
const BAND_INK: Record<BandTone, BandInk> = {
  ink: { band: card.ink, chip: card.gold, chipText: card.ink, label: card.stock },
  graphite: { band: card.graphite, chip: card.gold, chipText: card.ink, label: card.stock },
  gold: { band: card.gold, chip: card.ink, chipText: card.gold, label: card.ink },
  olive: { band: card.olive, chip: card.stock, chipText: card.ink, label: card.stock },
};

const KEYLINE_INK: Record<KeylineTone, string> = {
  sage: card.sage,
  graphite: card.graphite,
  gold: card.gold,
};

/**
 * The card's die-cut marks: the inner keyline and the two punched binder holes. Absolutely
 * positioned and non-interactive, so a page drops it in as its first child and then lays
 * its content out normally.
 */
export function CardPrint({ keyline = 'sage' }: { keyline?: KeylineTone }) {
  return (
    <>
      <View
        style={[cardFrame.keyline, { borderColor: KEYLINE_INK[keyline] }]}
        pointerEvents="none"
      />
      <View style={[cardFrame.hole, cardFrame.holeLeft]} pointerEvents="none" />
      <View style={[cardFrame.hole, cardFrame.holeRight]} pointerEvents="none" />
    </>
  );
}

/**
 * The index band across the top of every card: a chip (the catalogue number, or the mark
 * that says what kind of page this is), the label in tracked gothic caps, and the cat
 * stamp. `stamp` is passed in rather than required here so this module never reaches for
 * an asset — the pages already hold the one mascot PNG.
 */
export function IndexBand({
  tone = 'ink',
  chip,
  chipSymbol = false,
  chipStyle,
  label,
  stamp,
}: {
  tone?: BandTone;
  /**
   * OPTIONAL now. The factoid pages used to print a catalogue NUMBER here ("9258"), which
   * carried no meaning for a reader and cost the band a chunk of its width. It is gone.
   * The quiz keeps a chip because its chip is a LABEL ("PAGSUSULIT") — it is what tells a
   * kid this page is a different kind of page — so the prop survives for that use.
   */
  chip?: string;
  /**
   * Draw the chip in the SYSTEM font rather than the slab.
   *
   * Alfa Slab One is a display face with 672 glyphs and none of the marks a verdict needs —
   * checked directly: it has no U+2713, U+2717 or U+2605, so a tick set in it renders as a
   * tofu box. The option rows already dodge this by leaving fontFamily unset and letting
   * Android's fallback chain find the symbol; this lets the chip do the same.
   */
  chipSymbol?: boolean;
  /**
   * An animated style for the chip, so the page that owns a celebration can pop the
   * verdict mark IN the band without painting a second band over this one (the quiz's
   * correct-answer tick). Native-driver-safe styles only (transform/opacity) — the chip is
   * plain layout otherwise and the band itself never animates.
   */
  chipStyle?: Animated.WithAnimatedValue<StyleProp<ViewStyle>>;
  label: string;
  stamp: ReactNode;
}) {
  const ink = BAND_INK[tone];
  return (
    <View style={[cardFrame.band, { backgroundColor: ink.band }]}>
      {chip ? (
        <Animated.View style={[cardFrame.chip, { backgroundColor: ink.chip }, chipStyle]}>
          <Text
            style={[
              cardFrame.chipText,
              chipSymbol && cardFrame.chipSymbol,
              { color: ink.chipText },
            ]}
            numberOfLines={1}
          >
            {chip}
          </Text>
        </Animated.View>
      ) : null}
      <Text
        style={[cardFrame.bandLabel, { color: ink.label }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
      <View style={cardFrame.stamp}>{stamp}</View>
    </View>
  );
}

/** The printed rule + gold diamond that introduces an answer everywhere in the deck. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[cardFrame.divider, style]}>
      <View style={cardFrame.dividerRule} />
      <View style={cardFrame.dividerDiamond} />
      <View style={cardFrame.dividerRule} />
    </View>
  );
}

/**
 * The deck's arrow, drawn from borders rather than typed. Every arrow glyph in
 * this range is a coin-flip on Android's font fallback — U+25B6 lives in the colour-emoji
 * set and renders as a blue play button, which breaks the ten-colour palette on sight, and
 * U+25BA can fall back to tofu. Borders can neither fall back nor recolour themselves.
 */
export function Arrow({
  color = card.gold,
  direction = 'right',
}: {
  color?: string;
  /**
   * Which way it points. A left arrow is NOT this one rotated 180deg by the caller:
   * `arrowGlyph` carries a `marginLeft: 2` optical nudge (a triangle's mass sits left of its
   * bounding box), and rotating the wrapper carries that nudge round with it, so the
   * correction ends up pointing the wrong way and the glyph lands 4dp off-centre. The mirror
   * is printed here instead — still one arrow implementation, now with two directions.
   */
  direction?: 'left' | 'right';
}) {
  return direction === 'left' ? (
    <View style={[cardFrame.arrowGlyph, cardFrame.arrowGlyphLeft, { borderRightColor: color }]} />
  ) : (
    <View style={[cardFrame.arrowGlyph, { borderLeftColor: color }]} />
  );
}

/**
 * The single-path continuation: one fat mustard ticket on an ink ledge. Gold is reserved
 * for exactly this across the whole deck — it is what "just keep going" looks like, which
 * is why a fork's two picks are never gold.
 */
/**
 * Travel that turns a tap into a drag — the same slop the feed's pan activates on, so there
 * is no band where the tap has already failed but the pan has not yet started.
 */
const DRAG_SLOP = 10;

/**
 * A tap target that yields to the feed's swipe.
 *
 * Every button on a card sits inside the pan that turns the page, and the tickets sit along
 * the bottom edge — exactly where an upward swipe naturally begins. An RN Pressable there
 * puts the responder system in contention with the RNGH pan on an ancestor: whichever claims
 * the touch first keeps it, so a swipe started on a ticket could be swallowed. As an RNGH
 * Tap both live in one gesture tree, and a Tap fails the instant the finger travels past
 * DRAG_SLOP, so a drag always reaches the pan while a real tap still fires.
 *
 * `pressed` is tracked here because Pressable's render-prop is what we gave up to get this.
 */
export function TapTarget({
  onPress,
  hitSlop,
  style,
  children,
  accessibilityLabel,
}: {
  onPress: () => void;
  hitSlop?: number;
  /** Receives the pressed state, mirroring Pressable's render prop. */
  style: (pressed: boolean) => StyleProp<ViewStyle>;
  children: ReactNode;
  accessibilityLabel?: string;
}) {
  const [pressed, setPressed] = useState(false);
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(DRAG_SLOP)
        .hitSlop(
          hitSlop ? { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop } : undefined
        )
        .onBegin(() => runOnJS(setPressed)(true))
        .onEnd((_e, ok) => {
          if (ok) runOnJS(onPress)();
        })
        .onFinalize(() => runOnJS(setPressed)(false)),
    [onPress, hitSlop]
  );
  return (
    <GestureDetector gesture={tap}>
      <View
        style={style(pressed)}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </View>
    </GestureDetector>
  );
}

export function Ticket({
  label,
  eyebrow,
  onPress,
  hitSlop,
  style,
}: {
  label: string;
  eyebrow?: string;
  onPress: () => void;
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[cardFrame.ticketLedge, style]}>
      <TapTarget
        onPress={onPress}
        hitSlop={hitSlop}
        accessibilityLabel={label}
        style={(pressed) => [cardFrame.ticket, pressed && cardFrame.pressed]}
      >
        <View style={cardFrame.ticketLabel}>
          {eyebrow ? (
            <Text style={cardFrame.eyebrow} numberOfLines={1}>
              {eyebrow}
            </Text>
          ) : null}
          <Text style={cardFrame.ticketWord} numberOfLines={1} ellipsizeMode="tail">
            {label}
          </Text>
        </View>
        <View style={cardFrame.arrow}>
          <Arrow />
        </View>
      </TapTarget>
    </View>
  );
}

export const cardFrame = StyleSheet.create({
  /**
   * The card's content box, and the ONLY root style a page component should use: no
   * background, no border, no radius, no safe-area padding. The shell's `cardLayer` is the
   * stock and the printed ink edge and clips the page to its corners; a page that painted
   * its own would nest a second card inside the first.
   */
  content: {
    flex: 1,
    paddingTop: 24, // room above the index band for the punched holes
    paddingHorizontal: 13,
    paddingBottom: 14,
  },
  /**
   * Verified against the bundled Yoga (RN 0.81, ReactCommon/yoga AbsoluteLayout.cpp): when
   * an absolute child HAS insets, its position is `inset + parent border` — the parent's
   * padding is NOT added (padding is only folded in for the inset-less static position).
   * So `left/top: 6` here sits 6px inside the shell's 3px card edge, i.e. 9px from the
   * card's outer edge, exactly like the mockup's `.keyline` inside `.card`. Percentages
   * likewise resolve against the padding box, so the punches land where `.hole` does.
   */
  keyline: {
    position: 'absolute',
    left: 6,
    top: 6,
    right: 6,
    bottom: 6,
    borderWidth: 2,
    borderRadius: 12,
  },
  hole: {
    position: 'absolute',
    top: 5,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: card.board, // punched clean through to the board behind the deck
  },
  // Centred as a PAIR: each dot is inset 35% from its OWN edge, so the pair is symmetric at any
  // width. (The old 33%/63% pair put both left edges 2% left of where symmetry wants them, which
  // reads as a tilted card.) The margin is +13 - 6.5: half a dot BACK, plus the parent's 13dp
  // padding FORWARD. That second term is a Yoga quirk, not a fudge — RN defaults to YGErrataAll,
  // so AbsolutePercentAgainstInnerSize is on and the 35% resolves against the parent's INNER
  // width (W - 26) while the inset origin is the parent's border edge (here W). Without the
  // +13 the pair stays centred but the GAP opens to 0.30W + 18.2 instead of 0.30(W - 26) —
  // ~26dp wider, which on a ~330dp card is a 28% wider spread than the mockup draws. In CSS the
  // percentage and the origin share the padding box, so `.hole` in midcentury.html needs only
  // the -6.5 half-dot.
  holeLeft: { left: '35%', marginLeft: 6.5 },
  holeRight: { right: '35%', marginRight: 6.5 },

  // ---- index band ----
  band: {
    height: 34,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 5,
  },
  chip: {
    minWidth: 26,
    height: 24,
    borderRadius: 5,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Symbol chips drop the slab and take the system font, which has the marks it lacks. */
  chipSymbol: { fontFamily: undefined, fontSize: 15, fontWeight: '700' },
  chipText: {
    fontFamily: fonts.slab,
    fontSize: 13,
    includeFontPadding: false, // Alfa Slab's ascent would otherwise push the digits low
  },
  bandLabel: {
    flex: 1,
    // Patua One, not the gothic: chosen on measured width. At this size + tracking the pool's
    // median 33-char topic needs 264-268dp in the previous faces against a ~250dp band, and
    // 217dp in this one — the difference between truncating mid-word and fitting. See theme.ts.
    fontFamily: fonts.bandTitle,
    fontSize: 11.5, // a touch larger than the gothic's 10.5: the narrower face buys the room
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  stamp: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: card.stock,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  /** The mascot inside the band stamp — same 26px on every page. */
  stampImage: { width: 26, height: 26 },

  // ---- printed rule ----
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dividerRule: { flex: 1, height: 2, borderRadius: 2, backgroundColor: card.sage },
  dividerDiamond: {
    width: 8,
    height: 8,
    borderRadius: 1,
    backgroundColor: card.gold,
    transform: [{ rotate: '45deg' }],
  },

  // ---- the gold ticket ----
  ticketLedge: {
    backgroundColor: card.ink,
    borderRadius: 13,
    paddingBottom: 5, // the ledge itself — a darker parent, never a shadow
  },
  ticket: {
    minHeight: 56,
    backgroundColor: card.gold,
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 7,
    paddingLeft: 12,
    paddingRight: 7,
  },
  pressed: { transform: [{ translateY: 2 }] }, // the ticket presses into its ledge
  ticketLabel: { flex: 1 },
  eyebrow: {
    fontFamily: fonts.gothic,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    // The mockup prints this eyebrow in olive, which measures 2.43:1 on gold — under AA,
    // and not a bet worth taking on a 720p panel in Philippine daylight. Forest ink is
    // 5.24:1 on the same fill; the label stays quiet through size and tracking instead.
    color: card.ink,
    marginBottom: 1,
  },
  ticketWord: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 18.5,
    lineHeight: 21,
    color: card.ink,
  },
  arrow: {
    width: 38,
    height: 38,
    borderRadius: 9,
    backgroundColor: card.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowGlyph: {
    // a right-pointing triangle from borders: a zero-size box with transparent top and
    // bottom borders and one coloured left border
    width: 0,
    height: 0,
    borderStyle: 'solid',
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    marginLeft: 2, // optical centring: a triangle's mass sits left of its bounding box
  },
  /** The same triangle mirrored: the coloured border moves to the right edge, and the
      optical nudge moves with it (a left-pointing triangle's mass sits RIGHT of its box). */
  arrowGlyphLeft: {
    borderLeftWidth: 0,
    borderRightWidth: 10,
    marginLeft: 0,
    marginRight: 2,
  },

  // ---- the answer/choice row ledge (mockup `.ledge-a` / `.ledge-o`) ----
  rowLedge: {
    backgroundColor: card.ink,
    borderRadius: 11,
    paddingBottom: 4,
  },
});
