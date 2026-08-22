/**
 * The question-cards feed — the app's home screen on this branch. The visual direction is
 * "mid-century classroom card" (design/mockups/midcentury.html): every fact is a laminated
 * 1950s schoolroom flash card. The card no longer fills the screen edge to edge — it SITS
 * ON a dark board (card.board) with the board visible all round, one or two fanned cards
 * peeking out behind it, and it PEELS UP FROM THE SWIPED CORNER (left choice/corner →
 * peels from the bottom-left; right → bottom-right), revealing the next card beneath.
 *
 * This file owns the SHELL only: the board, the chrome (wordmark + tick meter), the
 * search/reroll strip, the deck geometry (fan, ledge, card edge, rounded corners) and the
 * caption under the card. Everything PRINTED ON the card — index band, punched holes,
 * keyline, illustration plate, type, tickets — belongs to the page components.
 *
 * Navigation: tap a choice ticket, or SWIPE the card away. The card tracks the finger on
 * the UI thread, springs back if it is let go under the commit threshold ("let me read
 * that again") and carries on off the deck past it; a swipe UP from a bottom corner, the
 * gesture that shipped first, still works and is the nav-bar-safe way past an interject.
 * Every 4-5 pages the flip is intercepted by a single MCQ about a recently-read fact.
 *
 * ROBUSTNESS: the incoming page carries the live drag and nothing else — and the drag
 * always ends at rest, whether the swipe committed or sprang back — the outgoing (peeling)
 * page always animates fully off-screen, and a safety timer clears it even if the
 * animation callback is dropped, so a transition can never strand a layer over the screen
 * (the earlier hang).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { uiStrings } from '../../config/strings';
import type { CardChoice, CardFact, CardQuestion } from '../../data/cards';
import type { RewardContent } from '../../data/reward';
import { useCardStore, type FeedResponse } from '../../store/cardStore';
import { useEngineStore } from '../../store/engineStore';
import { card, cardAlpha, fonts } from '../../theme';
import { CARD_EDGE, CARD_RADIUS } from './CardFrame';
import { CardPage } from './CardPage';
import { QuestionPage } from './QuestionPage';
import { ResponseCard } from './ResponseCard';
import { RewardCard } from './RewardCard';

const FLIP_MS = 380;

/**
 * Chrome meter: how many cards are left until the next interject question. Five ticks,
 * lighting up as the question approaches (the store's gap is 4-5 cards, so on a 5-gap the
 * first tick stays dark for one extra card — deliberate, it never over-promises).
 */
const METER_TICKS = 5;

/*
 * ---- swipe-to-advance ----
 * The tickets stay: a swipe is an ADDITIONAL way to press them, never the only one. The
 * numbers below are the whole feel of the gesture, so each one carries its reasoning.
 */

/**
 * How far the finger travels before the drag takes the touch away from the tickets and
 * from the typewriter's tap-to-complete underneath it. Gesture Handler's own default, and
 * just above Android's 8dp view-configuration touch slop: the wobble that comes free with
 * a child's tap can never read as a swipe, while a deliberate sweep is captured within a
 * frame or two of leaving the point the finger went down at.
 */
const DRAG_SLOP = 10;

/**
 * Commit distance for a sideways swipe, as a fraction of the screen's width. ~115dp on
 * the ~360dp panel this ships to: one comfortable thumb sweep, and far enough that the
 * kid can push the card, realise they had not finished reading it, and walk it back to
 * rest. Below about a quarter of the width it starts committing on the sideways drift
 * that comes free with a tap, and the feed would feel like it was running away from them.
 */
const COMMIT_FRACTION = 0.32;

/**
 * Velocity escape hatch, in dp/s: a flick still travelling this fast when the finger
 * leaves commits even though it never reached COMMIT_FRACTION. Reading the gesture as
 * intent rather than as distance is what "responsive" means here. 800dp/s is ~13dp per
 * frame at 60Hz — a deliberate flick clears it easily, while the slow, considered drag of
 * someone re-reading the card (well under 400dp/s) never does.
 */
const COMMIT_VELOCITY = 800;

/**
 * ...but a flick has to have gone somewhere. Without this floor the high instantaneous
 * velocity of a 5dp twitch — which is exactly what lifting a finger looks like on a cheap
 * digitiser — would turn the page.
 */
const FLICK_MIN_FRACTION = 0.12;

/**
 * Commit distance for the swipe UP that shipped first (it doubles as the nav-bar-safe way
 * past an interject page). Unchanged from the pan responder this replaces: it is the
 * secondary gesture, with no "walk it back" story to serve, so it stays short.
 */
const COMMIT_UP_PX = 55;
const FLICK_MIN_UP_PX = 24;

/** Corner bands for a swipe UP on a FORK: the outer 40% each side is that side's pick. */
const FORK_EDGE = 0.4;

/** How much of the finger a page that cannot be dismissed yet gives back (see `locked`). */
const LOCKED_GRIP = 0.12;
/** Nothing lives below the card, so a downward drag is rubber-banded, not tracked 1:1. */
const DOWN_GRIP = 0.25;

/**
 * Under the threshold the card SPRINGS back to rest — the "walk it back so I can read it
 * again" behaviour. Deliberately a spring and not a tween: a tween lands dead and reads as
 * the app refusing the gesture, where an all-but-critically-damped spring (0.88) lands
 * like a card dropping back onto a deck — one small settle, no wobble.
 */
const SETTLE_SPRING = { duration: 340, dampingRatio: 0.88 } as const;

/** Values for the gesture's `axis` shared value: undecided, then locked to one axis. */
const AXIS_NONE = 0;
const AXIS_X = 1;
const AXIS_Y = 2;

/** How far a TAPPED page swings sideways as it hinges off its corner (fraction of card). */
const TAP_DRIFT = 0.12;
/**
 * How far a SWIPED page carries on past the point the finger let it go (a multiple of
 * that offset). The tap peel swings the card the OTHER way, which is right for a hinge and
 * wrong for a throw: a card the kid just pushed left has to keep going left.
 */
const TOSS_CARRY = 2.2;

/** How long after a drag an on-card tap is ignored (see `dragging`). */
const TAP_GUARD_MS = 180;

type Side = 'left' | 'right';

/** Which way a committed swipe went. 'up' is the corner swipe; the rest are sideways. */
type SwipeDir = Side | 'up';

/** What was on the pad for the page being peeled away. */
interface PageSnap {
  pageKey: number;
  fact: CardFact | null;
  choices: CardChoice[];
  question: CardQuestion | null;
  reward: RewardContent | null;
  response: FeedResponse | null;
}

/** A page on its way off the deck: what was printed on it, and how it left. */
interface Peel extends PageSnap {
  side: Side;
  /** Where the card was when the finger let go — 0,0 for a tap. See the peel transform. */
  fromX: number;
  fromY: number;
  via: 'tap' | 'swipe';
}

/**
 * The stock a page is printed on. Quiz pages are dusty teal (the mockup's `.card.quiz`);
 * every other page is on cream card stock. Lives in the shell because the card SURFACE is
 * the shell's (it has to survive the flip, and the outgoing snapshot needs it too).
 */
const stockFor = (question: CardQuestion | null) => (question ? card.teal : card.stock);

/**
 * The 5-face of a die, drawn as Views. The reroll used to be the 🎲 emoji; Android renders
 * emoji in full colour, which breaks the ten-colour palette on sight. Pips cost nothing,
 * carry the same meaning, and can never fall back to a tofu box like a symbol glyph would.
 */
const DIE_ROWS: boolean[][] = [
  [true, false, true],
  [false, true, false],
  [true, false, true],
];

function DieFace() {
  return (
    <View style={styles.die}>
      {DIE_ROWS.map((row, r) => (
        <View key={r} style={styles.dieRow}>
          {row.map((pip, c) => (
            <View key={c} style={[styles.diePipCell, pip && styles.diePip]} />
          ))}
        </View>
      ))}
    </View>
  );
}

export function CardFeedScreen() {
  const language = useEngineStore((s) => s.language) ?? 'tagalog';
  const t = uiStrings(language);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const hydrated = useCardStore((s) => s.hydrated);
  const hydrate = useCardStore((s) => s.hydrate);
  const current = useCardStore((s) => s.current);
  const choices = useCardStore((s) => s.choices);
  const question = useCardStore((s) => s.question);
  const reward = useCardStore((s) => s.reward);
  const response = useCardStore((s) => s.response);
  const asking = useCardStore((s) => s.asking);
  const queryBanner = useCardStore((s) => s.queryBanner);
  const pageKey = useCardStore((s) => s.pageKey);
  const pagesRead = useCardStore((s) => s.pagesRead);
  const correctCount = useCardStore((s) => s.correctCount);
  const untilQuestion = useCardStore((s) => s.untilQuestion);
  const questionAnswered = useCardStore((s) => s.questionAnswered);
  const answerQuestion = useCardStore((s) => s.answerQuestion);
  const continueAfterQuestion = useCardStore((s) => s.continueAfterQuestion);
  const continueAfterReward = useCardStore((s) => s.continueAfterReward);
  const continueAfterResponse = useCardStore((s) => s.continueAfterResponse);
  const ask = useCardStore((s) => s.ask);
  const warmModel = useCardStore((s) => s.warmModel);
  const jumpToRandom = useCardStore((s) => s.jumpToRandom);

  const [queryText, setQueryText] = useState('');
  const submitQuery = () => {
    const q = queryText.trim();
    if (!q) return;
    Keyboard.dismiss();
    setQueryText('');
    void ask(q);
  };

  useEffect(() => {
    void hydrate();
    // Background, non-blocking: warm the model while the kid reads, so reward text can be
    // generated ahead of time. The feed itself never waits on it.
    warmModel();
  }, [hydrate, warmModel]);

  // Which way the last navigation went (drives the peel origin). Taking the left choice /
  // swiping the card leftwards → 'left'; right → 'right'.
  const sideRef = useRef<Side>('right');
  // Where the finger let go, when the navigation came from a swipe (null = it came from a
  // tap). Read once by the peel below, so the outgoing page can carry on from where the
  // card actually is instead of restarting from the middle of the deck.
  const release = useRef<{ x: number; y: number } | null>(null);
  // Reads `choose` off the store rather than closing over it, so this stays referentially
  // stable: the gesture's worklet captures it through runOnJS and must not be rebuilt on
  // every keystroke in the search box.
  const chooseFrom = useCallback((choice: CardChoice, side: Side) => {
    sideRef.current = side;
    useCardStore.getState().choose(choice);
  }, []);

  // ---- page-peel transition ----
  const [outgoing, setOutgoing] = useState<Peel | null>(null);
  const flip = useRef(new Animated.Value(0)).current;
  // The card rect, measured off the deck. The peel pivots on the CARD's bottom corner, not
  // the screen's, now that the card is inset from the board.
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const lastSnap = useRef<PageSnap | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- the live card's drag offset ----
  // Shared values, so the card is moved by the UI thread on every frame with no JS round
  // trip. The target device is an SM6225: a transform that has to wait on the JS thread
  // visibly stutters there, and a card that lags the finger is the entire complaint this
  // gesture exists to answer.
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  // AXIS_NONE until the drag has committed to an axis, then held for the rest of the
  // gesture — otherwise a sloppy diagonal wanders between two different meanings.
  const axis = useSharedValue(AXIS_NONE);
  // Screen x the finger went down at; the corner mapping for a swipe UP needs it.
  const originX = useSharedValue(0);
  // 1 while the page must not be swiped away — an interject question that has not been
  // answered. The card still moves, but barely (LOCKED_GRIP), so the gate is FELT as
  // "this one is holding on" rather than read as a dead screen.
  const locked = useSharedValue(0);
  useEffect(() => {
    locked.value = question && !questionAnswered ? 1 : 0;
  }, [question, questionAnswered, locked]);

  // Same body twice on purpose: Reanimated wants one animated style per view, and the
  // printed ledge is the card's own drop shadow — it has to travel with the card.
  const cardDrag = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
  }));
  const ledgeDrag = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
  }));

  // ---- tap vs drag ----
  /**
   * True from the moment the drag actually takes over until a few frames after the finger
   * lifts. Gesture Handler cancels the React Native touch responder when a handler
   * activates, so the Pressables under the card should never also fire — but that is two
   * touch systems having to agree, and the failure mode is the worst one in the feed: the
   * page turns TWICE and the kid loses a card they never saw. A real tap never sets this,
   * because the pan cannot activate inside DRAG_SLOP.
   */
  const dragging = useRef(false);
  const dragRelease = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markDragStart = useCallback(() => {
    if (dragRelease.current) clearTimeout(dragRelease.current);
    dragging.current = true;
  }, []);
  const markDragEnd = useCallback(() => {
    if (!dragging.current) return;
    if (dragRelease.current) clearTimeout(dragRelease.current);
    dragRelease.current = setTimeout(() => {
      dragging.current = false;
    }, TAP_GUARD_MS);
  }, []);
  /** Run an on-card navigation that came from a TAP (see `dragging`). */
  const tapNav = useCallback((run: () => void) => {
    if (!dragging.current) run();
  }, []);

  useLayoutEffect(() => {
    const prev = lastSnap.current;
    if (prev && prev.pageKey !== pageKey) {
      const from = release.current;
      release.current = null;
      setOutgoing({
        ...prev,
        side: sideRef.current,
        fromX: from?.x ?? 0,
        fromY: from?.y ?? 0,
        via: from ? 'swipe' : 'tap',
      });
      // The outgoing snapshot has just taken the swipe's offset over, so the live layer —
      // which is already showing the NEXT card — drops back to rest in the same commit.
      // That is why this is a LAYOUT effect: as a passive effect it would let the incoming
      // card paint one frame at the old finger offset first, which reads as a jump.
      dragX.value = 0;
      dragY.value = 0;
      flip.setValue(0);
      Animated.timing(flip, {
        toValue: 1,
        duration: FLIP_MS,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setOutgoing(null);
      });
      // Safety net: always clear the peeling layer even if the animation callback is
      // dropped (interrupted/backgrounded) — so it can never strand over the screen.
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setOutgoing(null), FLIP_MS + 400);
    }
    lastSnap.current = { pageKey, fact: current, choices, question, reward, response };
  }, [pageKey, current, choices, question, reward, response, flip, dragX, dragY]);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      if (dragRelease.current) clearTimeout(dragRelease.current);
    },
    []
  );

  // ---- swipe → the same navigation the tickets do ----
  /** Put the card back on the deck. Spring, never a tween — see SETTLE_SPRING. */
  const settle = useCallback(() => {
    dragX.value = withSpring(0, SETTLE_SPRING);
    dragY.value = withSpring(0, SETTLE_SPRING);
  }, [dragX, dragY]);

  /**
   * A swipe cleared the threshold. Runs on the JS thread and reads the store fresh, the
   * way the pan responder this replaces did, then performs exactly the navigation the
   * on-card button would have: the store contract is untouched, a swipe is just another
   * way to press.
   *
   * A FORK has two destinations, so there the direction IS the choice — left takes pick A
   * and right takes pick B, matching the two colour-coded cards fanned behind the deck
   * (blue A leaning left, ochre B leaning right) and the corner each pick already peels
   * from. On a single-path card either direction simply means "next". A swipe up keeps its
   * original meaning: on a fork it is the corner it started from, and the ambiguous middle
   * band does nothing.
   */
  const commitSwipe = useCallback(
    (dir: SwipeDir, releaseX: number, releaseY: number, downX: number) => {
      const s = useCardStore.getState();
      const before = s.pageKey;
      // Hand the peel the exact offset the finger let go at, before anything navigates.
      release.current = { x: releaseX, y: releaseY };
      // A sideways swipe names its own side. A swipe UP doesn't, so the peel hinges on the
      // half of the card the finger came from — the corner peel this gesture always had.
      const side: Side = dir === 'up' ? (downX < width / 2 ? 'left' : 'right') : dir;

      if (s.response) {
        sideRef.current = side;
        s.continueAfterResponse();
      } else if (s.reward) {
        sideRef.current = side;
        s.continueAfterReward();
      } else if (s.question) {
        // Gated: the quiz has to be answered first. `locked` already stops the card
        // getting this far, and this is the belt to that pair of braces.
        if (s.questionAnswered) {
          sideRef.current = side;
          s.continueAfterQuestion();
        }
      } else if (s.choices.length > 1) {
        if (dir === 'up') {
          if (downX < width * FORK_EDGE && s.choices[0]) chooseFrom(s.choices[0], 'left');
          else if (downX > width * (1 - FORK_EDGE) && s.choices[1])
            chooseFrom(s.choices[1], 'right');
        } else if (dir === 'left' && s.choices[0]) {
          chooseFrom(s.choices[0], 'left');
        } else if (dir === 'right' && s.choices[1]) {
          chooseFrom(s.choices[1], 'right');
        }
      } else if (s.choices[0]) {
        // Single path: every direction is "next", a swipe up from anywhere included. The
        // old rule only honoured the left corner, which left the right-hand half of a
        // single-path card silently dead.
        chooseFrom(s.choices[0], side);
      }

      // Nothing navigated — the ambiguous middle of a fork, an unanswered question, an
      // empty choice list. The card is sitting where the finger left it, so put it back.
      // Checking the page number rather than each branch's preconditions means a store
      // action that declines for its own reasons can never strand the card off-centre.
      if (useCardStore.getState().pageKey === before) {
        release.current = null;
        settle();
      }
    },
    [width, chooseFrom, settle]
  );

  /**
   * One pan for the whole pad. It tracks the card on the UI thread and only crosses to JS
   * once, on a commit; everything the worklet needs to decide (the axis, whether the page
   * is locked, where the finger went down) lives in shared values.
   */
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-DRAG_SLOP, DRAG_SLOP])
        .activeOffsetY([-DRAG_SLOP, DRAG_SLOP])
        .onBegin((e) => {
          originX.value = e.absoluteX;
          axis.value = AXIS_NONE;
        })
        .onStart(() => {
          runOnJS(markDragStart)();
        })
        .onUpdate((e) => {
          if (axis.value === AXIS_NONE) {
            axis.value = Math.abs(e.translationX) >= Math.abs(e.translationY) ? AXIS_X : AXIS_Y;
          }
          const grip = locked.value === 1 ? LOCKED_GRIP : 1;
          if (axis.value === AXIS_X) {
            dragX.value = e.translationX * grip;
            dragY.value = 0;
          } else {
            const ty = e.translationY < 0 ? e.translationY : e.translationY * DOWN_GRIP;
            dragY.value = ty * grip;
            dragX.value = 0;
          }
        })
        .onEnd((e, success) => {
          // Carrying the finger's velocity into the spring is what makes walking the card
          // back feel like one continuous motion rather than a hand-off.
          const settleBack = () => {
            dragX.value = withSpring(0, { ...SETTLE_SPRING, velocity: e.velocityX });
            dragY.value = withSpring(0, { ...SETTLE_SPRING, velocity: e.velocityY });
          };
          if (!success || locked.value === 1) {
            settleBack();
            return;
          }
          if (axis.value === AXIS_X) {
            const tx = e.translationX;
            // The velocity escape hatch only counts when it AGREES with where the card
            // actually is: someone dragging the card back to centre is moving fast in the
            // opposite direction, and that gesture means "keep this card", not "away".
            const flicked =
              Math.abs(e.velocityX) > COMMIT_VELOCITY &&
              e.velocityX * tx > 0 &&
              Math.abs(tx) > width * FLICK_MIN_FRACTION;
            if (Math.abs(tx) > width * COMMIT_FRACTION || flicked) {
              runOnJS(commitSwipe)(
                tx < 0 ? 'left' : 'right',
                dragX.value,
                dragY.value,
                originX.value
              );
            } else {
              settleBack();
            }
          } else {
            const flicked = e.velocityY < -COMMIT_VELOCITY && e.translationY < -FLICK_MIN_UP_PX;
            if (e.translationY < -COMMIT_UP_PX || flicked) {
              runOnJS(commitSwipe)('up', dragX.value, dragY.value, originX.value);
            } else {
              settleBack();
            }
          }
        })
        .onFinalize(() => {
          runOnJS(markDragEnd)();
        }),
    [width, commitSwipe, markDragStart, markDragEnd, axis, dragX, dragY, locked, originX]
  );

  // Peel transform: card hinges up from the swiped corner, slides off the top.
  // 2D (no 3D perspective → no foreshorten/recede), corner-anchored via a translate
  // sandwich, with a small tilt so it reads as peeling from that corner.
  const side = outgoing?.side ?? 'right';
  const cardW = pageSize.w || width; // fall back to the screen until the deck has measured
  const cx = side === 'left' ? -cardW / 2 : cardW / 2; // pivot = bottom-left / bottom-right corner
  const cy = pageSize.h / 2;
  // Where the peel STARTS: the middle of the deck for a tap, or exactly where the finger
  // let the card go for a swipe. That hand-off is what makes a swiped page turn read as
  // one motion instead of a snap back to centre followed by an animation.
  const fromX = outgoing?.fromX ?? 0;
  const fromY = outgoing?.fromY ?? 0;
  // ...and where it ENDS. A tapped page swings the way its hinge takes it; a swiped page
  // carries on the way it was thrown, because reversing a card the kid has just pushed
  // left would read as the app arguing with them.
  const exitX =
    outgoing?.via === 'swipe'
      ? fromX * TOSS_CARRY
      : side === 'left'
        ? cardW * TAP_DRIFT
        : -cardW * TAP_DRIFT;
  const lift = flip.interpolate({ inputRange: [0, 1], outputRange: [fromY, -(pageSize.h * 1.12)] });
  const tilt = flip.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', side === 'left' ? '10deg' : '-10deg'],
  });
  const drift = flip.interpolate({ inputRange: [0, 1], outputRange: [fromX, exitX] });
  const shadeOpacity = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.22, 0] });

  const wordmark = (
    <Text style={styles.wordmark}>
      HIRAIA<Text style={styles.wordmarkDot}>.</Text>
    </Text>
  );

  if (!hydrated || !current) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.loading}>
          <Text style={styles.loadingMark}>
            HIRAIA<Text style={styles.wordmarkDot}>.</Text>
          </Text>
          <Text style={styles.loadingDots}>…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Two choices == this card forks, and the deck visibly splits: the fanned cards behind
  // become the two colour-coded branches instead of one plain card. Same `choices.length`
  // rule the page components use for their tickets — the fan just echoes it.
  const forking = choices.length > 1 && !question && !reward && !response;
  const ticksOn = Math.max(0, Math.min(METER_TICKS, METER_TICKS - untilQuestion));
  const canSend = queryText.trim().length > 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* app chrome — lives on the BOARD, never on the card (mockup `.chrome`) */}
      <View style={styles.chrome}>
        {wordmark}
        <View style={styles.meter}>
          {Array.from({ length: METER_TICKS }, (_, i) => (
            <View key={i} style={[styles.tick, i < ticksOn && styles.tickOn]} />
          ))}
          <Text style={styles.meterCount}>{pagesRead}</Text>
        </View>
      </View>

      {/* persistent "ask anything" box — the kid's agency: type a topic or a question and
          RAG decides (found card → response card → honest abstention). Printed as a cream
          index-card field on the board; the gold diamond is the mockup's divider mark. */}
      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <View style={styles.searchDiamond} />
          <TextInput
            style={styles.searchInput}
            value={queryText}
            onChangeText={setQueryText}
            onSubmitEditing={submitQuery}
            placeholder={t.cards.searchPlaceholder}
            placeholderTextColor={card.olive}
            returnKeyType="search"
            editable={!asking}
            selectionColor={card.sage}
          />
          {/* While an answer is being generated the submit button becomes a progress
              circle, so the kid knows the app is working and they should wait. */}
          {asking ? (
            <ActivityIndicator size="small" color={card.ink} style={styles.searchSpinner} />
          ) : (
            <Pressable onPress={submitQuery} disabled={!canSend} hitSlop={8}>
              <View style={[styles.sendChip, !canSend && styles.sendChipOff]}>
                {/* the mockup's ▶ as a border triangle: the glyph itself risks Android's
                    emoji presentation (a blue play button), which is off-palette. */}
                <View style={styles.sendArrow} />
              </View>
            </Pressable>
          )}
        </View>
        {/* "Reroll" — jump to an unrelated fresh topic. Placeholder trigger; a
            shake gesture (expo-sensors) is the intended trigger, TBD. */}
        <Pressable
          onPress={() => {
            sideRef.current = Math.random() < 0.5 ? 'left' : 'right';
            jumpToRandom();
          }}
          hitSlop={8}
          style={styles.reroll}
        >
          <DieFace />
        </Pressable>
      </View>

      {/* "you asked" ribbon when a search navigated straight to a found card. It rides on
          the BOARD, directly under the box it echoes — not on the card: the top of a card
          is its punched holes and index band, and a ribbon would print straight over them. */}
      {queryBanner && !response && !reward && !question ? (
        <View style={styles.banner} pointerEvents="none">
          <Text style={styles.bannerLabel} numberOfLines={1}>
            {t.cards.yourQuestion}
          </Text>
          <Text style={styles.bannerText} numberOfLines={1}>
            “{queryBanner}”
          </Text>
        </View>
      ) : null}

      {/* The deck: board behind, card on top. `pad` clips the peel to the board area and
          is also the swipe's catchment, so a drag that starts on the margin around the
          card counts; `deck` deliberately does NOT clip, so the fanned branch cards can
          lean past the card edge the way they do in the mockup. */}
      <GestureDetector gesture={swipe}>
        <View style={styles.pad}>
          <View
            style={styles.deck}
            onLayout={(e) => {
              const { width: w, height: h } = e.nativeEvent.layout;
              setPageSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
            }}
          >
            {/* fanned cards behind — on a fork these are the two branches, blue on the left
                and ochre on the right, matching the A/B order of the tickets. */}
            {forking ? (
              <>
                <View style={[styles.fan, styles.fanBranch, styles.fanA]} pointerEvents="none" />
                <View style={[styles.fan, styles.fanBranch, styles.fanB]} pointerEvents="none" />
              </>
            ) : (
              <View style={[styles.fan, styles.fanSingle]} pointerEvents="none" />
            )}

            {/* the card's ledge: a darker slab peeking 4px below the card. NOT a shadow —
                Android honours only `elevation`, which can't be offset downward. It is the
                card's own printed drop shadow, so it rides along with the drag. */}
            <Reanimated.View style={[styles.cardLedge, ledgeDrag]} pointerEvents="none" />

            {/* Incoming card. It carries the DRAG and nothing else — never the peel — so it
                is always visible + tappable (hang-proof). The layer itself is deliberately
                NOT keyed: it has to survive a page change so that the reset to rest and the
                new page land in the same commit (see the layout effect). The PAGE inside it
                is what's keyed. The layer IS the card surface: stock, ink edge, rounded. */}
            <Reanimated.View
              style={[styles.cardLayer, { backgroundColor: stockFor(question) }, cardDrag]}
            >
              {response ? (
                <ResponseCard
                  key={pageKey}
                  response={response}
                  language={language}
                  onContinue={() => tapNav(continueAfterResponse)}
                />
              ) : reward ? (
                <RewardCard
                  key={pageKey}
                  reward={reward}
                  language={language}
                  onContinue={() => tapNav(continueAfterReward)}
                />
              ) : question ? (
                <QuestionPage
                  key={pageKey}
                  question={question}
                  language={language}
                  onAnswer={answerQuestion}
                  onContinue={() => tapNav(continueAfterQuestion)}
                />
              ) : (
                <CardPage
                  key={pageKey}
                  fact={current}
                  choices={choices}
                  language={language}
                  onChoose={(c) => tapNav(() => chooseFrom(c, choices[0] === c ? 'left' : 'right'))}
                />
              )}
              {/* thinking veil while the fallback generation is in flight */}
              {asking ? (
                <View style={styles.thinking} pointerEvents="none">
                  <Text style={styles.thinkingText}>{t.cards.thinking}…</Text>
                </View>
              ) : null}
            </Reanimated.View>

            {/* outgoing card peeling up from the swiped corner */}
            {outgoing && pageSize.h > 0 && (
              <Animated.View
                style={[
                  styles.cardLayer,
                  styles.outgoing,
                  {
                    backgroundColor: stockFor(outgoing.question),
                    transform: [
                      { translateX: drift },
                      { translateY: lift },
                      { translateX: -cx },
                      { translateY: -cy },
                      { rotate: tilt },
                      { translateX: cx },
                      { translateY: cy },
                    ],
                  },
                ]}
                pointerEvents="none"
              >
                {outgoing.fact && !outgoing.question && !outgoing.reward && !outgoing.response ? (
                  <CardPage
                    fact={outgoing.fact}
                    choices={outgoing.choices}
                    language={language}
                    onChoose={() => undefined}
                    instant
                  />
                ) : null}
                <Animated.View
                  style={[StyleSheet.absoluteFill, styles.shade, { opacity: shadeOpacity }]}
                />
              </Animated.View>
            )}
          </View>
        </View>
      </GestureDetector>

      {/* deck counter under the card (mockup `.counter`), with the quiz score at the right */}
      <View style={[styles.caption, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.captionSide} />
        <Text style={styles.captionText} numberOfLines={1}>
          {t.cards.readLabel} {pagesRead}
        </Text>
        <Text style={[styles.captionScore, styles.captionSide]} numberOfLines={1}>
          ✓ {correctCount}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    // the desk the deck sits on — the single biggest change from the notebook look
    backgroundColor: card.board,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingMark: { fontFamily: fonts.slab, fontSize: 26, color: card.stock, letterSpacing: 0.6 },
  loadingDots: { fontFamily: fonts.slab, fontSize: 26, color: card.sage, marginTop: 10 },

  // ---- chrome ----
  chrome: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  wordmark: { fontFamily: fonts.slab, fontSize: 16, color: card.stock, letterSpacing: 0.5 },
  wordmarkDot: { color: card.gold },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tick: {
    width: 6,
    height: 15,
    borderRadius: 2,
    // sage at 34%: an unlit tick has to be legible on the dark board yet clearly OFF —
    // full-strength sage is bright enough there to read as lit.
    backgroundColor: cardAlpha(card.sage, 0.34),
  },
  tickOn: { backgroundColor: card.gold },
  meterCount: {
    fontFamily: fonts.gothic,
    fontSize: 12,
    color: card.stock,
    marginLeft: 5,
    letterSpacing: 0.3,
  },

  // ---- search + reroll ----
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingLeft: 10,
    paddingRight: 4,
    borderRadius: 11,
    borderWidth: CARD_EDGE,
    borderColor: card.ink,
    backgroundColor: card.stock,
    // No ledge under this one on purpose: board (#20342C) and ink (#1C3B2E) are two
    // shades apart, so a printed ledge is invisible off the card. Ledges stay on-card.
  },
  searchDiamond: {
    width: 8,
    height: 8,
    borderRadius: 1,
    backgroundColor: card.gold,
    transform: [{ rotate: '45deg' }],
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.cardBody,
    fontSize: 15,
    color: card.ink,
    padding: 0,
  },
  sendChip: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: card.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendChipOff: { opacity: 0.3 },
  sendArrow: {
    width: 0,
    height: 0,
    marginLeft: 2, // optical centring: a triangle's mass sits left of its bounding box
    borderStyle: 'solid',
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 10,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: card.gold,
  },
  searchSpinner: { width: 32 },
  reroll: {
    width: 44,
    height: 44,
    borderRadius: 11,
    borderWidth: CARD_EDGE,
    borderColor: card.ink,
    // sage, not gold: gold is reserved for the card's "next" ticket, and the reroll is a
    // secondary escape hatch (the intended trigger is a shake).
    backgroundColor: card.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  die: { width: 22, height: 22, justifyContent: 'space-between' },
  dieRow: { flexDirection: 'row', justifyContent: 'space-between' },
  diePipCell: { width: 6, height: 6, borderRadius: 3 },
  diePip: { backgroundColor: card.ink },

  // ---- deck ----
  pad: {
    flex: 1,
    // clips the peeling card to the board area so it never paints over the chrome
    overflow: 'hidden',
  },
  deck: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 2,
    // 14px of board below the card: enough for the ledge (4px) and for the lower corner of
    // a leaning branch card (5px drop + 3px nudge + ~6px swing at 2.3deg on a full-height
    // card) to clear `pad`'s clip. The 16px side margins likewise cover the ~12px the same
    // corner swings outward.
    marginBottom: 14,
  },
  fan: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    borderRadius: CARD_RADIUS,
    borderWidth: CARD_EDGE,
    borderColor: card.ink,
    backgroundColor: card.stock,
    // fan out from just under the top edge, so the cards splay at the BOTTOM
    transformOrigin: '50% 16px',
  },
  fanSingle: { transform: [{ translateY: 8 }, { scaleX: 0.965 }] },
  // Inset 10px a side and dropped 5px so the fan opens sideways AND downward without
  // running off the board: a 2.3deg lean swings the bottom corner ~11px, i.e. just
  // inside the 10px inset plus the board margin.
  fanBranch: { left: 10, right: 10, bottom: -5 },
  fanA: { backgroundColor: card.forkA, transform: [{ rotate: '2.3deg' }, { translateY: 3 }] },
  fanB: { backgroundColor: card.forkB, transform: [{ rotate: '-2.3deg' }, { translateY: 3 }] },
  cardLedge: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: -4,
    borderRadius: CARD_RADIUS + 1,
    backgroundColor: cardAlpha(card.ink, 0.55), // ink at 55% — the printed drop under the card
  },
  cardLayer: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: CARD_RADIUS,
    borderWidth: CARD_EDGE,
    borderColor: card.ink,
    // backgroundColor is applied inline (cream stock, or teal on a quiz page)
    overflow: 'hidden', // page content is clipped to the card's rounded corners
  },
  outgoing: {
    // A genuine lift-off shadow (the sheet is in the air), NOT the printed ledge above.
    // This is the ONE place a shadow is right: the peeling sheet has physically left the
    // card, so it is not a printed ledge. Android only honours `elevation` (which is why
    // every ledge in the deck is a darker parent View); the iOS props are harmless there.
    shadowColor: card.ink,
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  shade: {
    // the fold's own shade as the sheet lifts — forest ink, animated 0 → 0.22 → 0
    backgroundColor: card.ink,
  },

  // ---- board-level ribbon + the on-card veil ----
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    // Forest ink, not press graphite. Two reasons: graphite is the palette's FORK colour
    // (banner + keyline) and this ribbon has nothing to do with a fork, and the gold label
    // below measures only 3.93:1 on graphite — under AA at 8.5px. On ink it is 5.25:1.
    backgroundColor: card.ink,
  },
  bannerLabel: {
    fontFamily: fonts.gothic,
    fontSize: 8.5,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
    color: card.gold,
  },
  bannerText: {
    flex: 1,
    fontFamily: fonts.cardBody,
    fontSize: 13,
    color: card.stock,
  },
  thinking: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cardAlpha(card.stock, 0.88), // card stock, near-opaque
  },
  thinkingText: {
    fontFamily: fonts.slab,
    fontSize: 20,
    color: card.olive,
  },

  // ---- counter under the card ----
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    // paddingBottom applied inline (bottom safe-area inset) to clear the Android nav bar
  },
  captionSide: { width: 46 }, // equal gutters keep the counter optically centred
  captionText: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.gothic,
    fontSize: 9.5,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    // Full sage, where the mockup fades it to 85%: sage on board measures 4.55:1, which
    // clears AA for normal text; the mockup's 85% version drops to ~4.0:1, under AA at
    // 9.5px on a cheap 720p panel in daylight.
    color: card.sage,
  },
  captionScore: {
    textAlign: 'right',
    fontFamily: fonts.gothic,
    fontSize: 10,
    letterSpacing: 0.6,
    color: card.gold,
  },
});
