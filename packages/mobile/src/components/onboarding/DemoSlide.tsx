/**
 * Card 3 of the onboarding deck — the TUTORIAL, and now the last card: a self-contained,
 * looping mock of the DECK being turned, plus the gold Ticket that dismisses the carousel.
 *
 * It used to mock the chat (a kid types a question, a reply streams in). Chat is being
 * narrowed out of the product and the deck IS the product, so the tutorial teaches the
 * deck. Pure animation — no engine, no feed state, no store.
 *
 * WHAT IT TEACHES, in loop order: TAP the ticket, TAP pick A, swipe RIGHT for B, swipe UP.
 *
 *   - TAP is first on purpose. A swipe is an ADDITIONAL way to press the ticket that is
 *     already printed on the card, never the only way; a child who only ever taps must not
 *     come out of onboarding believing they have to swipe.
 *   - On a FORK, left and right ARE the two choices (blue A, ochre B), which is why those
 *     two beats show the fork foot and the two colour-coded branch cards fanned behind —
 *     exactly what CardFeedScreen draws. The A beat PRESSES its pick and the B beat swipes,
 *     so the fork teaches both of its affordances rather than only the swipe: the picks are
 *     TapTargets in the feed (CardPage), and a vertical throw from the ambiguous MIDDLE of a
 *     fork is deliberately refused (CardFeedScreen.commitSwipe), so a tutorial that only
 *     ever swiped a fork would leave a tapping child with the one gesture that does nothing.
 *   - UP is first-class and simply means "next", so it rides on the single-path card.
 *   - A downward throw is honoured by the feed too (it hinges on the TOP corner and leaves
 *     past the bottom). It is left out of the loop because on a single-path card it means
 *     precisely what UP means, and a fifth beat is a longer loop for no new information.
 *
 * THE PEEL IS THE REAL ONE, not a lookalike. The transform is lifted from CardFeedScreen's
 * outgoing layer verbatim — a 2D corner-anchored translate sandwich around a small tilt,
 * pivoting on the bottom-LEFT corner for a left-side page turn and the bottom-RIGHT for a
 * right-side one, carrying on past where the finger let go (TOSS_CARRY) for a swipe and
 * swinging the other way (TAP_DRIFT) for a tap — at the same FLIP_MS and easing, under the
 * same ink shade, revealing the next card already peeking out beneath. The constants are
 * copied with their names so the two can be diffed by eye.
 *
 * PRINTED ON the card surface OnboardingCarousel owns: this fills `cardFrame.content` and
 * adds the deck's shared die-cut (punched holes, keyline, index band). The mock sits in the
 * deck's own mounted-print furniture — a peach mat over an inner window — except that the
 * window is painted BOARD dark rather than card stock, because what it is a window onto is
 * the feed's board, and a cream card peeling off a cream ground is invisible.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

import type { Language } from '@hiraia/shared';

import {
  DEMO_CAPTION,
  DEMO_HINT,
  DEMO_IMAGE_SLUG,
  DEMO_MINI,
  DEMO_START,
  SLIDE_BAND,
} from '../../config/onboarding';
import { useArtSource, type ArtSource } from '../../data/artSource';
import { card, cardAlpha, fonts } from '../../theme';
import { Arrow, CardPrint, IndexBand, Ticket, cardFrame } from '../cards/CardFrame';

const CAT = require('../../../assets/hiraia-profile.png');

/** The four things a kid can do to a card, in the order the loop teaches them. */
const BEATS = ['tap', 'left', 'right', 'up'] as const;
type Beat = (typeof BEATS)[number];

/** Which beats are printed on a FORK card (two picks) rather than a single gold ticket. */
const isFork = (b: Beat) => b === 'left' || b === 'right';

// ---- copied from CardFeedScreen so the mock and the feed peel identically ----
/** How long the peel takes. */
const FLIP_MS = 380;
/** How far a TAPPED page swings sideways as it hinges off its corner (fraction of card). */
const TAP_DRIFT = 0.12;
/** How far a SWIPED page carries on past the point the finger let it go. */
const TOSS_CARRY = 2.2;

// ---- the loop's own timings ----
/** How long a card sits at rest before it is acted on. */
const HOLD_MS = 640;
/** The finger's travel before the release — the drag the peel then hands off from. */
const DRAG_MS = 260;
/** How long a pressed control stays down in its ledge — the gold ticket, or a fork's pick. */
const PRESS_MS = 200;
/** One frame, spent off-screen swapping the card's face before the reset to rest. */
const SWAP_MS = 32;
/** The breath between one card landing and the next being acted on. */
const BETWEEN_MS = 220;

/**
 * Where the finger goes down for each beat, and — for the two THROWN beats — how far it
 * travels as a fraction of the mini deck. The card follows the finger 1:1, so the travel
 * doubles as the peel's hand-off point (`fromX`/`fromY` in the feed).
 *
 * `press: true` is a TOUCH rather than a throw: the finger goes down on a control printed on
 * the card and the page turns off that press, so there is no travel and the peel drifts the
 * way its hinge takes it (TAP_DRIFT) instead of carrying on the way it was thrown.
 *
 * `side` is the corner the peel hinges on, decided the way commitSwipe decides it: a
 * sideways swipe names its own side; a vertical one borrows the half of the card it started
 * on (hence UP going down in the right half and hinging right); and a pressed control is the
 * choice it prints — the single ticket and pick A are both choices[0], which CardPage hands
 * to chooseFrom as 'left'.
 *
 * A press is placed by `up` — dp measured UP from the card's BOTTOM edge — and not by a
 * fraction of the card's height, because both pressed controls live in MiniPage's foot,
 * which is a fixed-height block pinned to that edge (see FOOT_* below). The slide decides
 * the card's height, so a fraction would slide off the control on a taller phone. A throw
 * has no such anchor and stays a fraction.
 */
type Gesture = { side: 'left' | 'right'; x: number } & (
  | { press: true; up: number }
  | { press: false; y: number; dx: number; dy: number }
);

/**
 * Where each pressed control sits, in dp up from the mini card's bottom edge — read off
 * MiniPage's own boxes: 2dp card border + 8dp content padding puts the foot's floor 10dp up,
 * the ticket is 30dp tall over a 3dp ledge (13→43, middle 28), and on a fork the B row
 * (12→36) and a 5dp gap put the A pick at 43→67, middle 55.
 */
const FOOT_TICKET_Y = 28;
const FOOT_PICK_A_Y = 55;

const GESTURE: Record<Beat, Gesture> = {
  tap: { press: true, side: 'left', x: 0.5, up: FOOT_TICKET_Y },
  left: { press: true, side: 'left', x: 0.3, up: FOOT_PICK_A_Y },
  right: { press: false, side: 'right', x: 0.7, y: 0.62, dx: 0.22, dy: -0.05 },
  up: { press: false, side: 'right', x: 0.68, y: 0.74, dx: 0.02, dy: -0.26 },
};

export function DemoSlide({
  language,
  active,
  onStart,
}: {
  language: Language;
  /** True while this slide is the one on screen — the loop only runs then (see the effect). */
  active: boolean;
  onStart: () => void;
}) {
  /**
   * The illustration printed on the mini cards, IF this device has it — resolved INSIDE the
   * component, and through the same hook the feed's cards use. It used to be a module-scope
   * `resolveImage(DEMO_IMAGE_SLUG)`, which is evaluated once at import: if the bundled art
   * subset ever stopped shipping this slug the slide would be permanently blank, and a
   * backfill shard landing later could not bring it back, because nothing would re-read it.
   * `useArtSource` reads the bundle AND the backfilled files, and re-renders when one lands.
   */
  const demoArt = useArtSource(DEMO_IMAGE_SLUG);
  const mini = DEMO_MINI[language];
  const hint = DEMO_HINT[language];

  // Which beat is on the deck. The loop below owns it and advances it while the card it
  // belongs to is off-screen, so the face swap is never seen.
  const [beat, setBeat] = useState(0);
  // The mini control pressed into its ledge — a press beat's own feedback on the card.
  const [pressed, setPressed] = useState(false);
  // The mini deck's measured box. The peel pivots on the CARD's corner, so there is nothing
  // to animate until there is a card to pivot on; the loop waits for this.
  const [deck, setDeck] = useState({ w: 0, h: 0 });

  // 0 → 1 across the finger's travel, then 0 → 1 across the peel. Two values rather than
  // one because the peel picks up exactly where the drag left off and carries on, which is
  // an addition (see the transform), not a longer single ramp.
  const drag = useRef(new Animated.Value(0)).current;
  const flip = useRef(new Animated.Value(0)).current;

  const ready = deck.h > 0;

  useEffect(() => {
    // The loop is native-driver animation plus a JS timer chain that sets state twice a beat,
    // so it does not run while the child is on another slide — on first launch that would be
    // competing with the model download `onPickLanguage` kicks off. GradeSlide is gated the
    // same way, from the same `index`.
    if (!ready || !active) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number) => new Promise<void>((r) => timers.push(setTimeout(r, ms)));
    const run = (v: Animated.Value, duration: number, easing: (n: number) => number) =>
      new Promise<void>((r) => {
        Animated.timing(v, { toValue: 1, duration, easing, useNativeDriver: true }).start(() =>
          r()
        );
      });

    const loop = async () => {
      // Coming BACK to the slide restarts the tutorial at TAP: `beat` is state that outlives
      // the effect, and a loop starting at beat 0 while the card on screen is still beat 2
      // would press a ticket that card does not print.
      let i = 0;
      setBeat(0);
      while (!cancelled) {
        const b = BEATS[i]!;
        await wait(HOLD_MS);
        if (cancelled) return;

        if (GESTURE[b].press) {
          // The control sinks into its ledge AND the finger comes down on it: `drag` is what
          // fades the cue in and pushes it down (see fingerIn/fingerScale), so a press beat
          // has to ramp it too or the cue would sit at its 35% ghost for the whole beat —
          // the one beat with no visible touch would be the one teaching the tap. The card
          // itself does not move: a press has no travel, so fromX/fromY are 0.
          setPressed(true);
          await run(drag, PRESS_MS, Easing.out(Easing.quad));
          setPressed(false);
        } else {
          await run(drag, DRAG_MS, Easing.out(Easing.quad));
        }
        if (cancelled) return;

        await run(flip, FLIP_MS, Easing.in(Easing.cubic));
        if (cancelled) return;

        // Advance while the peeled card is still off-screen: its face becomes the next
        // beat's and the fan behind becomes the one after that, and only then does
        // everything snap back to rest — so the swap itself is never on screen.
        i = (i + 1) % BEATS.length;
        setBeat(i);
        await wait(SWAP_MS);
        if (cancelled) return;
        drag.setValue(0);
        flip.setValue(0);
        await wait(BETWEEN_MS);
      }
    };
    void loop();

    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      drag.stopAnimation();
      flip.stopAnimation();
      drag.setValue(0);
      flip.setValue(0);
      setPressed(false);
    };
  }, [ready, active, drag, flip]);

  const current = BEATS[beat]!;
  const next = BEATS[(beat + 1) % BEATS.length]!;
  const g = GESTURE[current];

  // ---- the peel, transcribed from CardFeedScreen ----
  const w = deck.w;
  const h = deck.h;
  // where the finger let go, i.e. where the peel takes over — a press lets go where it went
  // down, so the card is still at rest when the peel takes it
  const fromX = g.press ? 0 : g.dx * w;
  const fromY = g.press ? 0 : g.dy * h;
  // ...and where the card ends up. A swiped page carries on the way it was thrown; a tapped
  // one swings the way its hinge takes it.
  const exitX = g.press ? (g.side === 'left' ? w * TAP_DRIFT : -w * TAP_DRIFT) : fromX * TOSS_CARRY;
  const exitY = -(h * 1.12);
  // the hinge: the bottom corner on the side the page left by
  const cx = g.side === 'left' ? -w / 2 : w / 2;
  const cy = h / 2;
  const tiltDeg = g.side === 'left' ? 10 : -10;

  const dragX = drag.interpolate({ inputRange: [0, 1], outputRange: [0, fromX] });
  const dragY = drag.interpolate({ inputRange: [0, 1], outputRange: [0, fromY] });
  const peelX = flip.interpolate({ inputRange: [0, 1], outputRange: [0, exitX - fromX] });
  const peelY = flip.interpolate({ inputRange: [0, 1], outputRange: [0, exitY - fromY] });
  const tilt = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${tiltDeg}deg`] });
  const shadeOpacity = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.22, 0] });

  // The finger: fades in where it goes down, rides the drag, and is gone before the card is.
  const fingerIn = drag.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0.35, 1, 1] });
  // ...and on a press beat it also sinks, because a touch that never presses reads as a
  // pointer parked on the card. Interpolated on every beat rather than swapped for a plain 1,
  // so the transform keeps one shape and the native node is not rebuilt between beats.
  const fingerScale = drag.interpolate({
    inputRange: [0, 1],
    outputRange: [1, g.press ? 0.82 : 1],
  });
  const fingerOut = flip.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [1, 0, 0],
    extrapolate: 'clamp',
  });

  const face = (b: Beat) => (
    <MiniPage art={demoArt} mini={mini} fork={isFork(b)} pressed={b === current && pressed} />
  );

  return (
    <View style={cardFrame.content}>
      {/* keyline + punched binder holes — the deck's shared die-cut */}
      <CardPrint keyline="sage" />

      <IndexBand
        tone="ink"
        label={SLIDE_BAND[language].demo}
        stamp={<Image source={CAT} style={cardFrame.stampImage} resizeMode="contain" />}
      />

      <Text style={styles.caption}>{DEMO_CAPTION[language]}</Text>

      {/* the deck's mounted print: peach mat, ink edge, an inner window — here the window
          is the feed's own dark board, with a miniature deck being dealt on it */}
      <View style={styles.plate}>
        <View style={styles.window} pointerEvents="none">
          <View
            style={styles.deck}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setDeck((p) => (p.w === width && p.h === height ? p : { w: width, h: height }));
            }}
          >
            {/* Fanned behind: on a fork these are the two branches, blue leaning left and
                ochre leaning right, in the A/B order of the picks; otherwise it is the one
                cream card already peeking out, which is the card the peel reveals. */}
            {isFork(current) ? (
              <>
                <View style={[styles.fan, styles.fanBranch, styles.fanA]} />
                <View style={[styles.fan, styles.fanBranch, styles.fanB]} />
              </>
            ) : (
              <View style={[styles.fan, styles.fanSingle]}>{face(next)}</View>
            )}

            {/* the card's ledge — a darker slab peeking below it, not a shadow */}
            <View style={styles.cardLedge} />

            {/* the card being turned */}
            <Animated.View
              style={[
                styles.cardLayer,
                styles.lifted,
                {
                  transform: [
                    { translateX: Animated.add(dragX, peelX) },
                    { translateY: Animated.add(dragY, peelY) },
                    { translateX: -cx },
                    { translateY: -cy },
                    { rotate: tilt },
                    { translateX: cx },
                    { translateY: cy },
                  ],
                },
              ]}
            >
              {face(current)}
              {/* the fold's own shade as the sheet lifts */}
              <Animated.View
                style={[StyleSheet.absoluteFill, styles.shade, { opacity: shadeOpacity }]}
              />
            </Animated.View>

            {/* The finger. Not a hand glyph: every hand in this range is colour emoji on
                Android, which breaks the ten-colour palette on sight. A cream disc on an
                ink ring is furniture the deck already prints. */}
            {ready ? (
              <Animated.View
                style={[
                  styles.finger,
                  {
                    left: g.x * w - FINGER / 2,
                    top: (g.press ? h - g.up : g.y * h) - FINGER / 2,
                    opacity: Animated.multiply(fingerIn, fingerOut),
                    transform: [
                      { translateX: dragX },
                      { translateY: dragY },
                      { scale: fingerScale },
                    ],
                  },
                ]}
              />
            ) : null}
          </View>
        </View>
      </View>

      {/* the line that names the beat on screen. Fixed height: it changes four times a
          loop, and a reflow under the deck would make the whole card twitch. */}
      <Text style={styles.hint} numberOfLines={2}>
        {hint[current]}
      </Text>

      {/* The last action of onboarding. GOLD, because the deck reserves gold for the
          ordinary continuation and "start" is exactly that. It used to live on a fourth
          card that warned about the model download; the download now runs in the background
          from the moment a language is picked on card 1, so that notice is gone. */}
      <Ticket label={DEMO_START[language]} onPress={onStart} hitSlop={16} style={styles.ticket} />
    </View>
  );
}

/**
 * One face of the mini deck: the same card, printed small. Band, engraving, and a foot that
 * is either the single gold ticket or a fork's two colour-coded picks — the two states
 * CardPage itself has.
 *
 * `pressed` sinks whichever control THIS face's press beat is about: the gold ticket on a
 * single-path card, pick A on a fork (B's beat is the swipe, and never presses).
 */
function MiniPage({
  art,
  mini,
  fork,
  pressed,
}: {
  art: ArtSource;
  mini: { band: string; next: string; fork: string; pickA: string; pickB: string };
  fork: boolean;
  pressed: boolean;
}) {
  return (
    <View style={styles.miniContent}>
      {/* the die-cut, at mini scale — the holes punch through to the board behind, which
          here is the window's own board fill */}
      <View style={styles.miniKeyline} />
      <View style={[styles.miniHole, styles.miniHoleLeft]} />
      <View style={[styles.miniHole, styles.miniHoleRight]} />

      <View style={styles.miniBand}>
        <View style={styles.miniStamp}>
          <Image source={CAT} style={styles.miniStampImage} resizeMode="contain" />
        </View>
        <Text style={styles.miniBandLabel} numberOfLines={1}>
          {mini.band}
        </Text>
      </View>

      <View style={styles.miniPlate}>
        <View style={styles.miniWindow}>
          {art != null ? (
            <Image source={art} style={styles.miniArt} resizeMode="cover" />
          ) : (
            // no art on this device: the mat keeps the card's proportions rather than the
            // layout collapsing around a missing picture
            <View style={styles.miniArt} />
          )}
        </View>
      </View>

      {/* Fixed height, bottom-aligned: the fork foot is taller than the single ticket, and
          without this the engraving above would resize on every beat. */}
      <View style={styles.miniFoot}>
        {fork ? (
          <>
            <View style={styles.miniForkHead}>
              <Text style={styles.miniForkWord} numberOfLines={1}>
                {mini.fork}
              </Text>
              <View style={styles.miniForkRule} />
            </View>
            <View style={styles.miniPicks}>
              <View style={styles.miniRowLedge}>
                <View style={[styles.miniPick, styles.miniPickA, pressed && styles.miniPressed]}>
                  <View style={styles.miniKey}>
                    <Text style={styles.miniKeyText}>A</Text>
                  </View>
                  <Text style={styles.miniPickWord} numberOfLines={1}>
                    {mini.pickA}
                  </Text>
                  <Arrow color={card.stock} />
                </View>
              </View>
              <View style={styles.miniRowLedge}>
                <View style={[styles.miniPick, styles.miniPickB]}>
                  <View style={styles.miniKey}>
                    <Text style={styles.miniKeyText}>B</Text>
                  </View>
                  <Text style={styles.miniPickWord} numberOfLines={1}>
                    {mini.pickB}
                  </Text>
                  <Arrow color={card.stock} />
                </View>
              </View>
            </View>
          </>
        ) : (
          <View style={styles.miniTicketLedge}>
            <View style={[styles.miniTicket, pressed && styles.miniPressed]}>
              <Text style={styles.miniTicketWord} numberOfLines={1}>
                {mini.next}
              </Text>
              <View style={styles.miniArrow}>
                <Arrow />
              </View>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

/** The finger disc's diameter — its own constant because the cue is centred on the touch. */
const FINGER = 26;
/** The mini card's surface: the deck's own geometry, scaled down with it. */
const MINI_RADIUS = 12;
const MINI_EDGE = 2;

const styles = StyleSheet.create({
  caption: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 17.5,
    lineHeight: 23,
    color: card.ink, // 10.25:1 on cream stock
    textAlign: 'center',
    // Tight on purpose: every dp above the plate is a dp the mini deck does not get.
    marginTop: 8,
    marginBottom: 6,
  },

  // ---- the mounted print (CardPage's `plate` + `window`) ----
  plate: {
    flex: 1,
    minHeight: 150,
    backgroundColor: card.peach, // the warm mat every print in this deck sits on
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 7,
    padding: 6,
  },
  window: {
    flex: 1,
    // The feed's BOARD, not the plate white an engraving sits on and not card stock: what
    // is framed here is the deck on its desk, and a cream card peeling off a cream ground
    // would be invisible.
    backgroundColor: card.board,
    borderRadius: 2,
    overflow: 'hidden', // clips the peel to the window, as `pad` clips it to the board
  },

  // ---- the mini deck (CardFeedScreen's `deck` / `fan` / `cardLedge` / `cardLayer`) ----
  deck: { flex: 1, marginHorizontal: 12, marginTop: 6, marginBottom: 12 },
  fan: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    borderRadius: MINI_RADIUS,
    borderWidth: MINI_EDGE,
    borderColor: card.ink,
    backgroundColor: card.stock,
    overflow: 'hidden',
    // fan out from just under the top edge, so the cards splay at the BOTTOM
    transformOrigin: '50% 12px',
  },
  fanSingle: { transform: [{ translateY: 7 }, { scaleX: 0.965 }] },
  fanBranch: { left: 7, right: 7, bottom: -4 },
  fanA: { backgroundColor: card.forkA, transform: [{ rotate: '2.3deg' }, { translateY: 3 }] },
  fanB: { backgroundColor: card.forkB, transform: [{ rotate: '-2.3deg' }, { translateY: 3 }] },
  cardLedge: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: -3,
    borderRadius: MINI_RADIUS + 1,
    backgroundColor: cardAlpha(card.ink, 0.55), // ink at 55% — the printed drop under a card
  },
  cardLayer: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: MINI_RADIUS,
    borderWidth: MINI_EDGE,
    borderColor: card.ink,
    backgroundColor: card.stock,
    overflow: 'hidden',
  },
  lifted: {
    // the sheet is in the air, so this one really is a shadow rather than a printed ledge
    shadowColor: card.ink,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  shade: { backgroundColor: card.ink }, // the fold's own shade
  finger: {
    position: 'absolute',
    width: FINGER,
    height: FINGER,
    borderRadius: FINGER / 2,
    borderWidth: 2,
    borderColor: card.ink,
    backgroundColor: cardAlpha(card.stock, 0.72),
  },

  // ---- one mini card's face ----
  miniContent: { flex: 1, paddingTop: 11, paddingHorizontal: 8, paddingBottom: 8 },
  miniKeyline: {
    position: 'absolute',
    left: 4,
    top: 4,
    right: 4,
    bottom: 4,
    borderWidth: 1,
    borderRadius: 8,
    borderColor: card.sage,
  },
  miniHole: {
    position: 'absolute',
    top: 3,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: card.board, // punched clean through to the board behind the deck
  },
  miniHoleLeft: { left: '35%', marginLeft: 4.5 },
  miniHoleRight: { right: '35%', marginRight: 4.5 },
  miniBand: {
    height: 20,
    borderRadius: 5,
    backgroundColor: card.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
  },
  miniStamp: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: card.stock,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  miniStampImage: { width: 16, height: 16 },
  miniBandLabel: {
    flex: 1,
    fontFamily: fonts.bandTitle,
    fontSize: 8.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: card.stock, // 11.6:1 on ink
  },
  miniPlate: {
    flex: 1,
    marginTop: 5,
    marginBottom: 5,
    backgroundColor: card.peach,
    borderWidth: 2,
    borderColor: card.ink,
    borderRadius: 5,
    padding: 3,
  },
  miniWindow: { flex: 1, backgroundColor: card.plate, borderRadius: 2, overflow: 'hidden' },
  miniArt: { flex: 1, width: '100%' },

  // ---- the foot, at a fixed height so the engraving does not resize between beats ----
  miniFoot: { height: 74, justifyContent: 'flex-end' },
  miniForkHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  miniForkWord: {
    fontFamily: fonts.slab,
    fontSize: 8,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: card.forkA, // 7.21:1 on cream stock
  },
  miniForkRule: { flex: 1, height: 2, borderRadius: 1, backgroundColor: card.graphite },
  miniPicks: { gap: 5 },
  miniRowLedge: { backgroundColor: card.ink, borderRadius: 7, paddingBottom: 2 },
  miniPick: {
    height: 24,
    borderWidth: 2,
    borderColor: card.ink,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 5,
  },
  miniPickA: { backgroundColor: card.forkA },
  miniPickB: { backgroundColor: card.forkB },
  miniKey: {
    width: 15,
    height: 15,
    borderRadius: 4,
    backgroundColor: card.stock,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniKeyText: {
    fontFamily: fonts.slab,
    fontSize: 8.5,
    color: card.ink,
    includeFontPadding: false,
  },
  miniPickWord: {
    flex: 1,
    fontFamily: fonts.cardBodyBold,
    fontSize: 10.5,
    color: card.stock, // 7.21:1 on forkA, 5.09:1 on forkB
  },
  miniTicketLedge: { backgroundColor: card.ink, borderRadius: 8, paddingBottom: 3 },
  miniTicket: {
    height: 30,
    backgroundColor: card.gold,
    borderWidth: 2,
    borderColor: card.ink,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 4,
  },
  miniPressed: { transform: [{ translateY: 2 }] }, // the control presses into its ledge
  miniTicketWord: {
    flex: 1,
    fontFamily: fonts.cardBodyBold,
    fontSize: 11.5,
    color: card.ink, // 5.25:1 on gold
  },
  miniArrow: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: card.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ---- the line naming the beat ----
  hint: {
    fontFamily: fonts.cardBody,
    fontSize: 14,
    lineHeight: 19,
    // Press graphite, the deck's quiet ink for a secondary line: 7.67:1 on cream stock.
    color: card.graphite,
    textAlign: 'center',
    height: 38, // two lines' worth, always — see the note at the call site
    marginTop: 8,
  },
  ticket: { marginTop: 2 },
});
