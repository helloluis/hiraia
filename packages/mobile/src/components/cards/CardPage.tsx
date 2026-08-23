/**
 * What is PRINTED ON one factoid card of the question-cards feed, in the "mid-century
 * classroom card" direction (design/mockups/midcentury.html): two punched binder holes, a
 * printed keyline inboard of the edge, the index band (catalogue number · topic · cat
 * stamp), a peach-matted engraving, the factoid, and ONE fat mustard ticket to pull for
 * the next card. When the thread forks, the graphite SANGANDAAN banner and two
 * colour-coded picks replace that single ticket.
 *
 * The card SURFACE is not ours: CardFeedScreen owns the board, the deck, the fanned cards
 * behind, the ledge under the card and the card's own stock/ink edge/rounded corners
 * (it has to — the surface survives the page peel, and the outgoing snapshot needs it).
 * This component fills that surface's content box and prints on it.
 *
 * Behaviour is unchanged from the notebook version this replaces: the factoid types itself
 * in, a tap anywhere completes it instantly (visual-novel convention), and the
 * illustration + choices fade in once the text lands. The typewriter renders the full text
 * invisibly to reserve layout, revealing a prefix — so nothing re-wraps as it types.
 *
 * Every colour comes from `card` in theme.ts (the ten-colour mid-century palette) and
 * every "shadow" is a ledge — a darker parent View with a few px of bottom padding —
 * because RN on Android ignores shadowOffset and honours only `elevation`.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  type LayoutChangeEvent,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import type { Language } from '@hiraia/shared';

import { uiStrings } from '../../config/strings';
import { cardText, cardTitle, type CardChoice, type CardFact } from '../../data/cards';
import { resolveImage } from '../../generated/imageMap';
import {
  posterFor,
  displayScale,
  emphasisStyleFor,
  type PosterSpec,
  type EmphasisStyle,
} from './posterLayout';
import { card, fonts } from '../../theme';
import { Lightbox } from '../Lightbox';
import { Arrow, CardPrint, Divider, IndexBand, Ticket, cardFrame } from './CardFrame';

// The mascot stamp in the index band (and stepping forward at a fork) is the SAME asset
// the chat avatar uses — one cat, one file, no new art path.
const CAT = require('../../../assets/hiraia-profile.png');

const CHARS_PER_TICK = 5;
const TICK_MS = 24; // ≈ 210 chars/s — a card lands in ~1s; tap to finish instantly

// The feed text bakes a "question?\n\nanswer." pair into one string for ~44% of the pool.
const QA_SEPARATOR = '\n\n';

interface Tier {
  /** The factoid body — or the ANSWER half of a question/answer card. */
  fontSize: number;
  lineHeight: number;
  /** The QUESTION half: a step up and bold, per the mockup's .q/.a pair. */
  askSize: number;
  askLineHeight: number;
}

/**
 * The factoid type ramp: four steps off `string.length` alone, with NO onLayout
 * measurement pass — that is the runtime advantage this direction was chosen for (no extra
 * layout frame per card mount on an Adreno 610).
 *
 * Step 1 is the mockup's stated pair (question 18px over body 16.5px); the rest is its
 * ≤120 / 121-220 / >220 ramp. The mockup assumed a ~260-character ceiling, but the real
 * bank runs to 308 (measured across all 16,948 pool cards), so that last step is split in
 * two rather than letting a 300-character card push the illustration plate below its 136px
 * floor. The question half rides the same ramp so a long Q&A card shrinks as a PAIR,
 * instead of keeping an 18px head over a 13px body.
 */
function tierFor(text: string): Tier {
  const n = text.length;
  if (n <= 120) return { fontSize: 16.5, lineHeight: 23, askSize: 18, askLineHeight: 23 };
  if (n <= 220) return { fontSize: 15, lineHeight: 21.5, askSize: 16.5, askLineHeight: 21 };
  if (n <= 300) return { fontSize: 14, lineHeight: 20, askSize: 15.5, askLineHeight: 20 };
  return { fontSize: 13, lineHeight: 18.5, askSize: 14.5, askLineHeight: 19 };
}

/**
 * Type size for a card with NO ILLUSTRATION, fitted to the plate it inherits.
 *
 * An illustration is preferred, never required — most of the bank has one, but the DepEd
 * cards outrun the drawn library and a card worth reading should not be held back for want
 * of a picture. Such a card keeps the same peach mat the art would have sat in and fills it
 * with type, so it reads as a deliberate variant of the deck rather than as a failed image.
 *
 * Size is FITTED rather than stepped. The four-tier ramp above is calibrated for a caption
 * under a picture; reused here it left 60% of the card empty and, worse, gave 137, 154 and
 * 206-character cards the identical size, so how full a card looked was an accident of which
 * tier it fell in. Solving for the size that fills the plate removes that.
 *
 *   lines  = chars / (width / (K * size))     K = mean glyph advance / em, measured ~0.48
 *   height = lines * LINE_RATIO * size        so height grows with the SQUARE of size
 *   => size = sqrt(FILL * height * width / (chars * K * LINE_RATIO))
 *
 * MAX_SIZE is the real constraint and it comes from the column, not the box: past ~25px this
 * card is under 24 characters a line, and the rag gets bad enough to hurt a 10-year-old more
 * than the empty space does. So short cards stay at the cap with air around them — which is
 * why they sit in the mat, which makes that air read as composition — and only genuinely long
 * cards scale down.
 */
const FILL = 0.8;
const GLYPH = 0.48;
const LINE_RATIO = 1.36;
const MAX_SIZE = 25;
const MIN_SIZE = 16;

/**
 * What the LAYOUT costs, over and above the characters, expressed as characters so one
 * formula still does the work.
 *
 * The fit models the card as one continuous flow of text. It is not: it is up to four
 * stacked blocks — question, rule, the words before the lifted term, the term, the rest —
 * and each block rounds up to a whole line while the rule carries fixed margins. Ignoring
 * that overflowed the plate on long two-part cards; a 329-character card with both a long
 * question and a lead line ran its foot off the bottom.
 *
 * Charges, in lines:
 *   the display line is (scale - 1) taller than the body lines it replaces
 *   half a line per block boundary, for the rounding-up each one does
 *   1.2 lines for a two-part card: the rule, its margins, and the ask block's own rounding
 *
 * Converted to characters at the capped size — `size` is what we are solving for, so the cap
 * stands in. It only has to be close.
 */
function layoutAllowance(spec: PosterSpec, isQA: boolean, width: number): number {
  const perLine = width / (GLYPH * MAX_SIZE);
  let lines = 0;
  if (spec.kind === 'lead' || spec.kind === 'numeral') {
    const termLines = Math.max(1, Math.ceil(spec.term.length / Math.max(perLine, 1)));
    lines += (displayScale(spec.kind) - 1) * termLines;
    if (spec.before.trim()) lines += 0.5;
    if (spec.after.trim()) lines += 0.5;
  }
  if (isQA) lines += 1.2;
  return lines * perLine;
}

function fitType(text: string, width: number, height: number, allowance = 0): Tier {
  const n = Math.max(text.length + allowance, 1);
  const raw = Math.sqrt((FILL * height * width) / (n * GLYPH * LINE_RATIO));
  const fontSize = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, raw)) * 10) / 10;
  return {
    fontSize,
    lineHeight: Math.round(fontSize * LINE_RATIO * 10) / 10,
    askSize: Math.round(fontSize * 1.06 * 10) / 10,
    askLineHeight: Math.round(fontSize * 1.38 * 10) / 10,
  };
}

/** Split the baked "question?\n\nanswer." pair; `ask` is null on a plain factoid. */
function splitQA(text: string): { ask: string | null; body: string } {
  const i = text.indexOf(QA_SEPARATOR);
  if (i <= 0) return { ask: null, body: text };
  return { ask: text.slice(0, i), body: text.slice(i + QA_SEPARATOR.length) };
}

/**
 * One run of text mid-reveal, as a nested <Text> so it can sit INSIDE another Text and keep
 * the line flowing. Splitting a sentence into differently-styled runs would otherwise break
 * it into separate paragraphs, which is right for a lifted display line and wrong for an
 * emphasised word in the middle of a clause.
 */
function Seg({
  text,
  shown,
  style,
}: {
  text: string;
  shown: number;
  style?: StyleProp<TextStyle>;
}) {
  const cut = Math.max(0, Math.min(shown, text.length));
  return (
    <Text style={style}>
      {text.slice(0, cut)}
      <Text style={styles.unrevealed}>{text.slice(cut)}</Text>
    </Text>
  );
}

/**
 * A block of the factoid mid-reveal: the revealed prefix, followed by the rest at opacity 0
 * so the block keeps its final height and never re-wraps while typing.
 */
function Typed({
  text,
  shown,
  style,
}: {
  text: string;
  shown: number;
  style: StyleProp<TextStyle>;
}) {
  const cut = Math.max(0, Math.min(shown, text.length));
  return (
    <Text style={style}>
      {text.slice(0, cut)}
      <Text style={styles.unrevealed}>{text.slice(cut)}</Text>
    </Text>
  );
}

interface CardPageProps {
  fact: CardFact;
  choices: CardChoice[];
  language: Language;
  onChoose: (choice: CardChoice) => void;
  /** Render fully typed with no animation (the outgoing page during the flip). */
  instant?: boolean;
}

/**
 * Last measured inner size of the type plate, shared across cards. Seeded from the window:
 * the deck insets 16px a side, the card adds a 3px edge and 13px of padding, and the mat
 * another 3px border plus 6px + 8px of padding — 49px a side in total. The height seed is
 * deliberately rough; it is corrected by the first onLayout and only ever affects cards long
 * enough to fall below the size cap.
 */
let lastPlateBox = {
  w: Math.max(180, Dimensions.get('window').width - 98),
  h: Math.max(240, Dimensions.get('window').height * 0.55),
};

/** The nested-Text style for an inline treatment. */
function inlineEmphasis(style: EmphasisStyle): StyleProp<TextStyle> {
  switch (style) {
    case 'highlight':
      return styles.emHighlight;
    case 'underline':
      return styles.emUnderline;
    case 'caps':
      return styles.emCaps;
    default:
      return styles.em;
  }
}

/**
 * A lifted term, drawn in one of the display treatments.
 *
 * `knockout` and `outline` need a box around the word rather than a style on it, and `rule`
 * needs a bar beneath it — none of which a Text style can express — so those wrap. The wrapper
 * is `alignSelf: flex-start` so the block hugs the word instead of stretching the column,
 * which is what makes it read as a printed chip rather than a banner.
 */
function DisplayTerm({
  text,
  shown,
  styleName,
  size,
}: {
  text: string;
  shown: number;
  styleName: EmphasisStyle;
  size: { fontSize: number; lineHeight: number };
}) {
  if (styleName === 'knockout' || styleName === 'outline') {
    const box = styleName === 'knockout' ? styles.dKnockBox : styles.dOutlineBox;
    const type = styleName === 'knockout' ? styles.dKnockText : styles.dOutlineText;
    return (
      <View style={box}>
        <Typed text={text} shown={shown} style={[type, size]} />
      </View>
    );
  }
  if (styleName === 'rule') {
    return (
      <View style={styles.dRuleWrap}>
        <Typed text={text} shown={shown} style={[styles.dRuleText, size]} />
        <View style={styles.dRuleBar} />
      </View>
    );
  }
  return (
    <Typed
      text={text}
      shown={shown}
      style={[styleName === 'figure' ? styles.numeral : styles.lead, size]}
    />
  );
}

/**
 * Emphasis for a card that HAS an illustration: the accent, never a lifted display line.
 * Under a picture the type is a caption, and a word at 1.5x would compete with the art for
 * the eye — which is the one thing the illustration is there to win.
 */
function inlineOnly(text: string, spans: readonly string[] | undefined, id: string): PosterSpec {
  const term = spans?.[0];
  const i = term ? text.indexOf(term) : -1;
  if (!term || i < 0) return { kind: 'plain', style: 'accent', before: '', term: '', after: text };
  return {
    kind: 'inline',
    style: emphasisStyleFor(id, 'inline'),
    before: text.slice(0, i),
    term,
    after: text.slice(i + term.length),
  };
}

export function CardPage({ fact, choices, language, onChoose, instant = false }: CardPageProps) {
  const t = uiStrings(language);
  const text = cardText(fact, language);
  const { ask, body } = splitQA(text);
  const art = resolveImage(fact.slug);
  /**
   * The type plate's own box, measured. Seeded from the window so the very first card is
   * already close (a wrong seed would resize the type one frame in, mid-typewriter); every
   * card after the first reuses the real measurement, which is why it is cached at module
   * level rather than per instance.
   */
  const [plateBox, setPlateBox] = useState(lastPlateBox);
  /**
   * Whether the type actually outran its plate. The fit is tuned so this should not happen —
   * it is charged for the display line, the block rounding and the Q&A rule — but it is an
   * ESTIMATE built on a mean glyph width, and RN's own text measurement is what decides. A
   * card that overflows anyway would otherwise have its last line clipped by the plate's
   * `overflow: hidden`, and unreadable is worse than scrollable.
   */
  const [overflowing, setOverflowing] = useState(false);
  const emphasis =
    fact.emphasis?.[language === 'english' ? 'en' : language === 'cebuano' ? 'bis' : 'tl'];
  // The body's layout is settled BEFORE the type is sized: a lifted display line changes how
  // much room the rest of the sentence has.
  const bodySpec =
    art == null ? posterFor(body, emphasis, fact.id) : inlineOnly(body, emphasis, fact.id);
  const tier =
    art != null
      ? tierFor(text)
      : fitType(text, plateBox.w, plateBox.h, layoutAllowance(bodySpec, ask != null, plateBox.w));
  // Two choices == this page forks. nextChoices returns a single choice on a normal page.
  const branching = choices.length > 1;
  const [shown, setShown] = useState(instant ? text.length : 0);
  const done = shown >= text.length;
  const [zoom, setZoom] = useState(false);
  const extrasOpacity = useRef(new Animated.Value(instant ? 1 : 0)).current;

  // typewriter (starts shortly after mount, i.e. as the page flip settles)
  useEffect(() => {
    if (instant) return;
    let i = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      i += CHARS_PER_TICK;
      setShown((prev) => (prev >= text.length ? prev : i));
      if (i < text.length) setTimeout(tick, TICK_MS);
    };
    const start = setTimeout(tick, 260);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fact.id, instant]);

  // illustration + choices fade in once the text lands
  useEffect(() => {
    if (done) {
      Animated.timing(extrasOpacity, { toValue: 1, duration: 240, useNativeDriver: true }).start();
    }
  }, [done, extrasOpacity]);

  const skip = () => {
    if (!done) setShown(text.length);
  };

  // The answer half starts revealing where the question (plus its separator) ended.
  const bodyShown = ask == null ? shown : shown - ask.length - QA_SEPARATOR.length;

  /**
   * The factoid, set according to its poster layout.
   *
   * `shown` is a single running count over the whole string, so each run is handed the count
   * MINUS everything before it and clamps itself. That keeps one typewriter across three
   * differently-styled runs rather than three that start together.
   */
  const renderFact = (text: string, spec: PosterSpec, from: number) => {
    const bodyType = { fontSize: tier.fontSize, lineHeight: tier.lineHeight };
    if (spec.kind === 'plain') {
      return <Typed text={text} shown={from} style={[styles.fact, bodyType]} />;
    }
    if (spec.kind === 'inline') {
      // one paragraph — the runs nest so the line keeps flowing through the accent
      return (
        <Text style={[styles.fact, bodyType]}>
          <Seg text={spec.before} shown={from} />
          <Seg
            text={spec.term}
            shown={from - spec.before.length}
            style={inlineEmphasis(spec.style)}
          />
          <Seg text={spec.after} shown={from - spec.before.length - spec.term.length} />
        </Text>
      );
    }
    const size = Math.round(tier.fontSize * displayScale(spec.kind) * 10) / 10;
    const display = {
      fontSize: size,
      lineHeight: Math.round(size * 1.08 * 10) / 10,
    };
    return (
      <>
        {spec.before.trim() ? (
          <Typed
            text={spec.before.trim()}
            shown={from}
            style={[styles.fact, styles.preLead, bodyType]}
          />
        ) : null}
        <DisplayTerm
          text={spec.term}
          shown={from - spec.before.length}
          styleName={spec.style}
          size={display}
        />
        {spec.after.trim() ? (
          <Typed
            text={spec.after.replace(/^\s+/, '')}
            shown={from - spec.before.length - spec.term.length}
            style={[styles.fact, bodyType]}
          />
        ) : null}
      </>
    );
  };

  // The same type in both layouts; only its container and its size differ.
  const factBlock = (
    <>
      {ask != null ? (
        <>
          {/* The question always takes the INLINE treatment, never a lifted line: it is the
              hook, and a display word here would upstage the answer it exists to set up. */}
          {(() => {
            const q = inlineOnly(ask, emphasis, fact.id);
            const qs = [styles.ask, { fontSize: tier.askSize, lineHeight: tier.askLineHeight }];
            return q.kind === 'plain' ? (
              <Typed text={ask} shown={shown} style={qs} />
            ) : (
              <Text style={qs}>
                <Seg text={q.before} shown={shown} />
                <Seg text={q.term} shown={shown - q.before.length} style={styles.em} />
                <Seg text={q.after} shown={shown - q.before.length - q.term.length} />
              </Text>
            );
          })()}
          {/* hairline + gold lozenge, the printed rule between a question and its answer */}
          <Divider style={styles.divider} />
        </>
      ) : null}
      {renderFact(body, bodySpec, bodyShown)}
    </>
  );

  const onPlateLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (Math.abs(w - plateBox.w) > 4 || Math.abs(h - plateBox.h) > 4) {
      lastPlateBox = { w, h };
      setPlateBox(lastPlateBox);
    }
  };

  /**
   * A few px of slack before declaring an overflow: content and frame are measured on
   * different passes and rounding alone can put them a fraction apart, which would flip a
   * scroll bar onto a card that fits.
   */
  const onContentSize = (_w: number, h: number) => {
    const over = h > plateBox.h + 2;
    if (over !== overflowing) setOverflowing(over);
  };

  return (
    <Pressable style={cardFrame.content} onPress={skip} disabled={done}>
      {/* keyline + punched binder holes — the shared die-cut, graphite on a fork so the
          card's own furniture favours neither branch */}
      <CardPrint keyline={branching ? 'graphite' : 'sage'} />

      {/* index band: catalogue number, topic in tracked gothic caps, cat stamp */}
      <IndexBand
        tone={branching ? 'graphite' : 'ink'}
        label={cardTitle(fact, language) || fact.topic}
        stamp={<Image source={CAT} style={cardFrame.stampImage} resizeMode="contain" />}
      />

      {/*
        The engraving, matted. The art is greyscale line work on an opaque WHITE bed, so it
        sits on a white plate inside a peach mat — the mat is what makes it read as a
        mounted print rather than a pasted-in label. (Printing it straight onto the cream
        stock needs mix-blend-mode:multiply per card, or a white-knockout pass over the
        whole 18.8k-image bank; that is the funded pipeline job, not this restyle.)
        Tap → the same pinch-zoom Lightbox the illustration always had.
      */}
      {art != null ? (
        <Animated.View style={[styles.plate, { opacity: extrasOpacity }]}>
          <Pressable
            style={styles.window}
            onPress={() => setZoom(true)}
            disabled={!done}
            accessibilityLabel={`Larawan: ${fact.topic}. I-tap para palakihin.`}
          >
            <Image source={art} style={styles.art} resizeMode="contain" />
          </Pressable>
        </Animated.View>
      ) : null}

      {/* The factoid itself: a printed question/answer pair, or one plain block.
          With an illustration above it this is a caption under the art. WITHOUT one it takes
          over the mat entirely and is centred in it, so the card is filled by type rather
          than topped by an empty frame — a different printing of the same card, not a card
          missing its picture. */}
      {art == null ? (
        <View style={styles.typePlate}>
          {/*
            Scrollable ONLY when the type overran the plate. The feed's pan gesture reads
            vertical drags as a page turn, so a permanently scrollable view here would eat
            the swipe (QuestionPage avoids a ScrollView outright for that reason). Gating it
            on the measurement keeps the gesture intact on every card that fits — which,
            given the fit, is essentially all of them — and surrenders the vertical drag only
            on a card that would otherwise be clipped. Even then the reader is not stuck: the
            feed also advances on a left or right swipe, and those are unaffected.
          */}
          <ScrollView
            style={styles.typeInner}
            contentContainerStyle={styles.typeInnerContent}
            scrollEnabled={overflowing}
            showsVerticalScrollIndicator={overflowing}
            onLayout={onPlateLayout}
            onContentSizeChange={onContentSize}
          >
            {factBlock}
          </ScrollView>
        </View>
      ) : (
        <View style={styles.body}>{factBlock}</View>
      )}

      {/*
        SINGLE-PATH is the normal state: one fat mustard ticket, full width, so turning the
        card stays a rhythm rather than a decision. The second choice only ever appears when
        the thread genuinely forks (the BRANCH_EVERY cadence or a dead end, see
        nextChoices), and then the whole foot changes character — graphite banner, the cat
        stepping forward, two colour-coded picks. Keeping that distinct is the point: a fork
        should read as a real moment, not as the default state.
      */}
      <Animated.View
        style={[styles.foot, { opacity: extrasOpacity }]}
        pointerEvents={done ? 'auto' : 'none'}
      >
        {branching && choices[0] && choices[1] ? (
          <>
            <View style={styles.forkHead}>
              <View style={styles.forkCat}>
                <Image source={CAT} style={styles.forkCatImage} resizeMode="contain" />
              </View>
              <Text style={styles.forkWord} numberOfLines={1}>
                {t.cards.fork}
              </Text>
              <View style={styles.forkRule} />
            </View>
            <View style={styles.picks}>
              <View style={cardFrame.rowLedge}>
                <Pressable
                  style={({ pressed }) => [styles.pick, styles.pickA, pressed && cardFrame.pressed]}
                  onPress={() => onChoose(choices[0]!)}
                >
                  <View style={styles.key}>
                    <Text style={styles.keyText}>A</Text>
                  </View>
                  <Text style={styles.pickWord} numberOfLines={1} ellipsizeMode="tail">
                    {choices[0].label}
                  </Text>
                  <Arrow color={card.stock} />
                </Pressable>
              </View>
              <View style={cardFrame.rowLedge}>
                <Pressable
                  style={({ pressed }) => [styles.pick, styles.pickB, pressed && cardFrame.pressed]}
                  onPress={() => onChoose(choices[1]!)}
                >
                  <View style={styles.key}>
                    <Text style={styles.keyText}>B</Text>
                  </View>
                  <Text style={styles.pickWord} numberOfLines={1} ellipsizeMode="tail">
                    {choices[1].label}
                  </Text>
                  <Arrow color={card.stock} />
                </Pressable>
              </View>
            </View>
          </>
        ) : choices[0] ? (
          <Ticket
            eyebrow={t.cards.nextCard}
            label={choices[0].label}
            onPress={() => onChoose(choices[0]!)}
          />
        ) : null}
      </Animated.View>

      {art != null ? (
        <Lightbox visible={zoom} desc={fact.topic} source={art} onClose={() => setZoom(false)} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // ---- the printed illustration: peach mat over a white plate ----
  plate: {
    flex: 1,
    minHeight: 136, // the floor the type ramp is tuned never to breach
    marginTop: 10,
    backgroundColor: card.peach,
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 7,
    padding: 6,
  },
  window: {
    flex: 1,
    // The mockup fills this window with card stock and knocks the art's white bed out with
    // mix-blend-mode:multiply. RN has no blend modes, so the window is plate white instead
    // and the art's own white bed continues it seamlessly. (The alternative — a
    // white-knockout pass over all 18.8k images — is the funded pipeline job, not a
    // restyle.)
    backgroundColor: card.plate,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  art: { width: '100%', height: '100%' },

  // ---- factoid type (sizes come from the tier, inline; family + colour live here) ----
  body: { marginTop: 12 },

  // ---- the type plate: what a card with no illustration prints instead ----
  // Deliberately the SAME mat as the art plate above, at the same size and in the same
  // place. That is the whole idea: the reader sees a card of the deck, printed differently,
  // not a card whose picture failed to arrive.
  typePlate: {
    flex: 1,
    minHeight: 136,
    marginTop: 10,
    backgroundColor: card.peach,
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 7,
    padding: 6,
  },
  typeInner: {
    flex: 1,
    // Card STOCK, not the plate white the art sits on: type belongs on the card's own paper,
    // and white here would read as an empty photo window with words in it.
    backgroundColor: card.stock,
    borderRadius: 2,
  },
  typeInnerContent: {
    // flexGrow rather than flex so the block still centres when it fits, and simply grows
    // past the frame when it does not.
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8, // kept tight — every px here comes straight off the line length
  },
  ask: {
    fontFamily: fonts.cardBodyBold,
    color: card.ink,
    letterSpacing: -0.1,
  },
  // ---- emphasis: the term the card is teaching ----
  em: { fontFamily: fonts.cardBodyBold, color: card.accent },
  /** The lifted term. Bold slab in the accent — size does the work, colour confirms it. */
  lead: {
    fontFamily: fonts.cardBodyBold,
    color: card.accent,
    letterSpacing: -0.6,
    marginVertical: 3,
  },
  /** A quantity, set as a figure. The display slab is used ONLY here, where the card's whole
   *  point is a number and it should read as an image rather than as a word. */
  numeral: { fontFamily: fonts.slab, color: card.accent, letterSpacing: -1, marginVertical: 4 },
  /** Ink on a peach swatch — the mat's own colour, so the span reads as MARKED rather than
   *  pasted in from somewhere else. 6.40:1. A span that wraps draws one swatch per line,
   *  which is what a highlighter does too. */
  emHighlight: {
    fontFamily: fonts.cardBodyBold,
    color: card.ink,
    backgroundColor: card.peach,
  },
  /** Accent, underlined. RN has no decoration thickness or offset, so this is a hairline on
   *  device where the mockup shows a bar — the `rule` display treatment is where a real bar
   *  lives. */
  emUnderline: {
    fontFamily: fonts.cardBodyBold,
    color: card.accent,
    textDecorationLine: 'underline',
  },
  /** Tracked-out gothic caps in graphite, 7.67:1. The most restrained of the set: it marks a
   *  span as a CATEGORY rather than shouting a name. */
  emCaps: {
    fontFamily: fonts.gothic,
    color: card.graphite,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },

  // ---- display treatments that need a box or a bar, not just a text style ----
  /** Stock reversed out of ink, 10.25:1 — the loudest of the set. */
  dKnockBox: {
    alignSelf: 'flex-start',
    backgroundColor: card.ink,
    borderRadius: 5,
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginVertical: 5,
  },
  dKnockText: { fontFamily: fonts.cardBodyBold, color: card.stock, letterSpacing: -0.4 },
  /** The term boxed, as a worksheet boxes a word it wants you to keep. */
  dOutlineBox: {
    alignSelf: 'flex-start',
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 7,
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginVertical: 5,
  },
  dOutlineText: { fontFamily: fonts.cardBodyBold, color: card.ink, letterSpacing: -0.4 },
  /** A printed underscore: a real bar under the word, which a text decoration cannot give
   *  us at this weight. Hugs the word rather than the column. */
  dRuleWrap: { alignSelf: 'flex-start', marginVertical: 3 },
  dRuleText: { fontFamily: fonts.cardBodyBold, color: card.ink, letterSpacing: -0.6 },
  dRuleBar: { height: 5, borderRadius: 3, backgroundColor: card.accent, marginTop: 2 },

  /** The words before a lifted term — "Ang", "Sa halimbawa ng acacia, ang". Dropped back so
   *  the term is what the eye lands on, but not so far that the sentence loses its start. */
  preLead: { opacity: 0.66 },
  fact: {
    fontFamily: fonts.cardBody,
    color: card.ink,
  },
  divider: { marginVertical: 9 },
  unrevealed: {
    opacity: 0, // reserves layout so the block doesn't re-wrap while typing
  },

  // ---- the foot: one gold ticket (single path), or the fork ----
  foot: { marginTop: 12 },

  forkHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 8,
  },
  // The cat steps forward at a fork — bigger than its band stamp, on the peach mat, because
  // it is the thing announcing the split.
  forkCat: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: card.peach,
    borderWidth: 3,
    borderColor: card.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  forkCatImage: { width: 35, height: 35 },
  forkWord: {
    fontFamily: fonts.slab,
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: card.forkA, // 7.21:1 on cream stock (see theme.ts); the mockup's `.forkhead b`
  },
  forkRule: { flex: 1, height: 3, borderRadius: 2, backgroundColor: card.graphite },
  picks: { gap: 7 },
  pick: {
    minHeight: 48,
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  pickA: { backgroundColor: card.forkA },
  pickB: { backgroundColor: card.forkB },
  key: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: card.stock,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    fontFamily: fonts.slab,
    fontSize: 13,
    color: card.ink,
    includeFontPadding: false,
  },
  pickWord: {
    flex: 1,
    fontFamily: fonts.cardBodyBold,
    fontSize: 17,
    lineHeight: 20,
    color: card.stock,
  },
});
