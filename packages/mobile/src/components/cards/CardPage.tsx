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
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import type { Language } from '@hiraia/shared';

import { uiStrings } from '../../config/strings';
import { cardText, type CardChoice, type CardFact } from '../../data/cards';
import { resolveImage } from '../../generated/imageMap';
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

/** Split the baked "question?\n\nanswer." pair; `ask` is null on a plain factoid. */
function splitQA(text: string): { ask: string | null; body: string } {
  const i = text.indexOf(QA_SEPARATOR);
  if (i <= 0) return { ask: null, body: text };
  return { ask: text.slice(0, i), body: text.slice(i + QA_SEPARATOR.length) };
}

/**
 * The number printed in the index band. It is the card's own catalogue number (its position
 * in the bank, parsed off the `ffct-NNNNN` id), NOT how many cards the kid has read —
 * CardPage is mounted a second time as the frozen OUTGOING page during a peel, and a live
 * read-count would re-render that snapshot carrying the NEXT card's number. Deriving it
 * from the fact keeps both copies honest, and a catalogue number is what a real card index
 * band carries anyway. 1-based, so no card is ever printed "0".
 */
function catalogueNo(id: string): string {
  const digits = /(\d+)\s*$/.exec(id);
  return digits ? String(Number(digits[1]) + 1) : id.toUpperCase();
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

export function CardPage({ fact, choices, language, onChoose, instant = false }: CardPageProps) {
  const t = uiStrings(language);
  const text = cardText(fact, language);
  const tier = tierFor(text);
  const { ask, body } = splitQA(text);
  const art = resolveImage(fact.slug);
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

  return (
    <Pressable style={cardFrame.content} onPress={skip} disabled={done}>
      {/* keyline + punched binder holes — the shared die-cut, graphite on a fork so the
          card's own furniture favours neither branch */}
      <CardPrint keyline={branching ? 'graphite' : 'sage'} />

      {/* index band: catalogue number, topic in tracked gothic caps, cat stamp */}
      <IndexBand
        tone={branching ? 'graphite' : 'ink'}
        chip={catalogueNo(fact.id)}
        label={fact.topic}
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
      <Animated.View style={[styles.plate, { opacity: extrasOpacity }]}>
        <Pressable
          style={styles.window}
          onPress={() => setZoom(true)}
          disabled={!done || art == null}
          accessibilityLabel={`Larawan: ${fact.topic}. I-tap para palakihin.`}
        >
          {art != null ? <Image source={art} style={styles.art} resizeMode="contain" /> : null}
        </Pressable>
      </Animated.View>

      {/* the factoid itself: either a printed question/answer pair, or one plain block */}
      <View style={styles.body}>
        {ask != null ? (
          <>
            <Typed
              text={ask}
              shown={shown}
              style={[styles.ask, { fontSize: tier.askSize, lineHeight: tier.askLineHeight }]}
            />
            {/* hairline + gold lozenge, the printed rule between a question and its answer */}
            <Divider style={styles.divider} />
          </>
        ) : null}
        <Typed
          text={body}
          shown={bodyShown}
          style={[styles.fact, { fontSize: tier.fontSize, lineHeight: tier.lineHeight }]}
        />
      </View>

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

      <Lightbox visible={zoom} desc={fact.topic} source={art} onClose={() => setZoom(false)} />
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
  ask: {
    fontFamily: fonts.cardBodyBold,
    color: card.ink,
    letterSpacing: -0.1,
  },
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
