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
 * Navigation: tap a choice ticket, or SWIPE the card away. LEFT, RIGHT and UP are three
 * first-class directions on ONE tuning — same distance, same velocity gate, same spring —
 * and a drag locks to an axis the moment it has a direction, so it can never mean two
 * things at once. The card tracks the finger on the UI thread, springs back if it is let
 * go under the commit threshold ("let me read that again") and carries on off the deck
 * past it. DOWN is tracked but never commits: there is no previous card to go back to.
 * Every 4-5 pages the flip is intercepted by a single MCQ about a recently-read fact.
 *
 * ROBUSTNESS: the incoming page carries the live drag and nothing else — and the drag
 * always ends at rest, whether the swipe committed or sprang back — the outgoing (peeling)
 * page always animates fully off-screen, and a safety timer clears it even if the
 * animation callback is dropped, so a transition can never strand a layer over the screen
 * (the earlier hang).
 */
import { useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

import type { Language } from '@hiraia/shared';

import { GRADE_WORD } from '../../config/grades';
import { uiStrings } from '../../config/strings';
import {
  getCard,
  type CardChoice,
  type CardFact,
  type CardQuestion,
} from '../../data/cards';
import type { RewardContent } from '../../data/reward';
import { previewChoices, useCardStore, type FeedResponse } from '../../store/cardStore';
import { useEngineStore, type ReadyStage } from '../../store/engineStore';
import { card, cardAlpha, fonts } from '../../theme';
import { useTypewriter } from '../onboarding/useTypewriter';
import { barColor, fieldSurface, useReadinessMessage } from './searchReadiness';
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
 * Commit distance, as a fraction of the screen's WIDTH — and the SAME distance on both
 * axes, which is what makes up a first-class direction instead of a special case: one
 * physical sweep turns the page whichever way it is aimed, so there is one gesture to
 * learn, not three. ~115dp on the ~360dp panel this ships to: one comfortable thumb
 * sweep, and far enough that the kid can push the card, realise they had not finished
 * reading it, and walk it back to rest. Below about a quarter of the width it starts
 * committing on the drift that comes free with a tap, and the feed would feel like it was
 * running away from them.
 *
 * Deliberately NOT re-derived from the taller vertical axis: 0.32 of the deck's ~620dp of
 * height is ~200dp, which is a reach rather than a sweep, and an "equal effort" argument
 * for a longer up-swipe does not survive the fact that a thumb's vertical range on a phone
 * held in one hand is the SHORTER of the two. It does mean up costs more travel than the
 * 55dp of the corner-swipe this replaces (that was a secondary escape hatch, tuned as
 * one) — the first thing to confirm on-device, and a one-line change if 115dp reads long.
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
 * digitiser — would turn the page. Shared with the vertical axis, where it earns its keep
 * twice over: a finger leaving the glass smears the last samples UP the panel, so up is
 * precisely the direction a velocity-only rule fires by accident. ~43dp here.
 */
const FLICK_MIN_FRACTION = 0.12;

/**
 * The card is NOT locked to an axis; it follows the finger on both.
 *
 * It used to lock, and the lock was the bug: it was applied on the pan's very first update —
 * a few pixels of noise — with ties going to X, so a drag that began a hair sideways was
 * pinned horizontally for the rest of the gesture and the perpendicular offset held at 0.
 * Vertical swipes read as ignored and the card felt railed. (An AXIS_LOCK_PX of 14dp was
 * written to defer the decision past that first frame for exactly this reason, and never
 * wired up.)
 *
 * Locking was the right model when only SOME directions meant something — mis-reading the
 * axis could take a fork's left branch when the kid meant "next". Now every direction is
 * "away", so reading it wrongly costs nothing on an ordinary page, and the question of which
 * direction was MEANT belongs to the whole gesture rather than its first frame. It is
 * answered at release, from the axis the finger actually travelled furthest on.
 */

/**
 * Vertical commit distance, in dp. The horizontal axis commits on a FRACTION of the screen
 * width, but the vertical one cannot borrow that: on a phone held in one hand the thumb's
 * comfortable vertical range is the SHORTER of the two, while the screen is much taller —
 * so `height * COMMIT_FRACTION` (~265dp here) would be an arm movement, not a flick.
 * A fixed 115dp is roughly the same perceived effort as the horizontal 32%, and it is the
 * value the doc block above is written against. It does cost more travel than the 55dp
 * corner-swipe this replaces, which was tuned as a secondary escape hatch rather than a
 * primary gesture — the first thing to confirm on-device, and a one-line change if it
 * reads long.
 */
const COMMIT_UP_PX = 115;

/**
 * The vertical twin of FLICK_MIN_FRACTION: how far an upward flick must actually have
 * travelled before velocity alone is allowed to commit it. Matches the ~43dp that
 * FLICK_MIN_FRACTION works out to horizontally, so both axes demand the same minimum
 * "went somewhere" before trusting a fast sample. This matters more going up than sideways:
 * a finger leaving the glass smears its last samples UP the panel, so up is exactly the
 * direction a velocity-only rule would fire by accident.
 */
const FLICK_MIN_UP_PX = 43;

/**
 * Corner bands for a swipe UP on a FORK: the outer 40% each side is that side's pick, the
 * corner it will peel from. The middle band names neither branch and the app must not
 * guess for the kid, so a vertical drag that starts there RESISTS (LOCKED_GRIP) and
 * springs back — dead travel on a 115dp gesture would read as the app being broken, where
 * a card that holds on says "this one needs a side" in the language of the gesture. Left
 * and right are unaffected: they name their branch by direction, wherever they start.
 */
const FORK_EDGE = 0.4;

/**
 * How much of the finger a drag that cannot go anywhere gives back: an interject question
 * that has not been answered yet (see `locked`), or an up-swipe from the ambiguous middle
 * of a fork (see FORK_EDGE).
 */
const LOCKED_GRIP = 0.12;
/**
 * A card leaves in whatever direction it was thrown — up, down, left or right.
 *
 * Down used to be the one direction that did nothing: it read as "go back", and there is no
 * previous card to go back TO (no history, and synthesising one would mean restoring the
 * choices, the quiz state and the interject counter with it). So it was tracked at a quarter
 * of the finger and sprung home.
 *
 * That was the wrong reading of the gesture. Flicking a sheet off a deck is not navigation
 * backwards; it is the same "away" the other three directions mean. Making one direction
 * behave differently only taught the reader that the card sometimes refuses them. Down now
 * commits like the rest, and the peel hinges on the TOP corner so the card leaves the way it
 * was pushed.
 */

/**
 * Under the threshold the card SPRINGS back to rest — the "walk it back so I can read it
 * again" behaviour. Deliberately a spring and not a tween: a tween lands dead and reads as
 * the app refusing the gesture, where an all-but-critically-damped spring (0.88) lands
 * like a card dropping back onto a deck — one small settle, no wobble.
 */
const SETTLE_SPRING = { duration: 340, dampingRatio: 0.88 } as const;

/**
 * Is this vertical drag one the card cannot answer? On a FORK an up-swipe means "the
 * branch under the corner I started from" (FORK_EDGE), so a drag that starts in the middle
 * band names neither. Runs on the UI thread inside the pan, hence the worklet: `gate` is
 * the forking shared value, `downX` the screen x the finger went down at.
 */
function forkMiddleUp(gate: number, downX: number, screenW: number) {
  'worklet';
  return gate === 1 && downX > screenW * FORK_EDGE && downX < screenW * (1 - FORK_EDGE);
}

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

/**
 * Which way a committed swipe went. All three are first-class; 'up' is the one that does
 * not name a side by itself, so it borrows one from the half of the card it started on.
 */
type SwipeDir = Side | 'up' | 'down';

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
  /** Thrown downward: the peel hinges on the TOP corner and leaves past the bottom. */
  down: boolean;
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

/** How long the finished (full-width, sage) readiness bar lingers before unmounting —
 *  the child gets to SEE the walk complete to green, the spec's payoff moment. */
const DONE_LINGER_MS = 800;

/**
 * The warming field's status line, in its own memoized leaf ON PURPOSE: the typewriter
 * setStates ~33×/s while a line types in, and hosted at CardFeedScreen's level every one
 * of those ticks reconciled the ENTIRE deck tree — defeating the 2% readiness
 * quantisation (see the selector below) whose whole job is capping the parent at ~50
 * re-renders per load. Here a tick re-renders two Texts. The ~10 s message rotation
 * (useReadinessMessage) lives here too, so it stops re-rendering the parent as well.
 */
const SearchStatusLine = memo(function SearchStatusLine({
  stage,
  language,
  color,
}: {
  stage: ReadyStage;
  language: Language;
  color: string;
}) {
  // Only rendered while a load is in flight (the parent's warming branch), so the hook
  // is unconditionally enabled; unmounting resets its rotation state.
  const message = useReadinessMessage(true, stage, language);
  const typed = useTypewriter(message, { stepMs: 30, playKey: message });
  return (
    <>
      {/* The animated line is HIDDEN from screen readers: a live region on text that
          changes every 30 ms queues one TalkBack announcement PER CHARACTER
          ("D", "Do", "Dow", …) — stutter spam for the whole multi-minute load. */}
      <Text
        style={[styles.searchStatus, { color }]}
        numberOfLines={2}
        importantForAccessibility="no"
      >
        {typed}
      </Text>
      {/* Invisible sibling carrying the FULL message, so TalkBack gets ONE clean
          polite announcement per ~10 s rotation. */}
      <Text style={styles.srOnly} accessibilityLiveRegion="polite">
        {message}
      </Text>
    </>
  );
});

export function CardFeedScreen() {
  const router = useRouter();
  const language = useEngineStore((s) => s.language) ?? 'tagalog';
  // The student's grade, printed in the footer — which is also the way INTO Settings from
  // the feed (see the footer below).
  const grade = useEngineStore((s) => s.grade);
  const onboardingActive = useEngineStore((s) => s.onboardingActive);
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
  // The feed itself needs no model, but the SEARCH FIELD does — so the warm-up state is shown
  // here rather than as a full-screen gate (see the note in app/_layout.tsx).
  const engineReady = useEngineStore((s) => s.isReady);
  const engineError = useEngineStore((s) => s.error);
  // "warming" means a load is IN FLIGHT — not merely "not ready yet".
  //
  // It used to be `!engineReady && !engineError`, which is true from the very first frame.
  // Combined with `disabled={engineReady || warming}` that left the field permanently
  // disabled, so the tap that is supposed to WAKE the model could never fire. The bug was
  // invisible while bootstrap() eagerly loaded the engine at launch: not-ready and loading
  // were then the same state, and the load always completed on its own. Removing the boot
  // warm-up split them apart, and the idle state is the whole point of this control — it is
  // what the reader taps to start the load.
  const loadingPhase = useEngineStore((s) => s.loadingPhase);
  const warming = loadingPhase === 'downloading' || loadingPhase === 'warming';
  // The composed readiness number (see engineStore's STAGE WEIGHTS). Quantised to 2%
  // in the SELECTOR so the store's 250 ms ramp ticks re-render this (big) component at
  // most fifty times per load, not four times a second — the bar still visibly crawls
  // (2% of the row is ~7 dp a step) and the deck stays smooth on the SM6225. FLOOR,
  // not round: rounding overstated the width by up to 1% — including painting a
  // finished-looking bar at raw 0.99 while LaBSE was still landing.
  const readiness = useEngineStore((s) => Math.floor(s.readiness * 50) / 50);
  const readyStage = useEngineStore((s) => s.readyStage);
  // The four views of that one number: field surface (opacity step + measured text
  // colour), bar width, bar colour, message pool. See searchReadiness.ts.
  const surface = fieldSurface(readiness, engineReady);
  // Bar visibility is gated on the STAGE, not the number: the old `readiness < 1`
  // check unmounted the bar the instant the quantised number hit 1.0, so the sage
  // finish (barColor at readiness 1) was unreachable on every path. Instead, when
  // 'done' lands the full-width sage bar LINGERS for a beat before unmounting — the
  // walk to green visibly completes.
  const [doneLinger, setDoneLinger] = useState(false);
  const prevStageRef = useRef(readyStage);
  useEffect(() => {
    const was = prevStageRef.current;
    prevStageRef.current = readyStage;
    if (readyStage === 'done' && was !== 'done' && was !== 'idle') {
      setDoneLinger(true);
      const t = setTimeout(() => setDoneLinger(false), DONE_LINGER_MS);
      return () => clearTimeout(t);
    }
  }, [readyStage]);
  const barVisible = (readyStage !== 'idle' && readyStage !== 'done') || doneLinger;
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
    // The feed mounts UNDER the first-launch onboarding overlay. Don't draw (and mark seen)
    // the first card until the kid is through it — the grade picked there weights that draw.
    if (onboardingActive) return;
    void hydrate();
    // The model is NOT warmed here any more.
    //
    // It used to start at mount, described as "background, non-blocking" because the feed
    // never awaits it. That is true of the control flow and false of the device: loading
    // ~2 GB and running a warm-up prefill is ~98s of CPU on four budget cores, and it
    // contends for the JS thread the whole time. The drag itself stayed smooth (it is a
    // UI-thread worklet) but the COMMIT crosses to JS, so a swipe hung for seconds before
    // the card would leave — the app was least usable exactly while it claimed to be
    // getting ready.
    //
    // Nothing on the feed path needs it. Browsing, quizzes and illustrations are all
    // zero-model; the only consumers are the free-text ask and the reward line, and
    // prefetchReward already returns early when the engine is cold so the reward falls back
    // to its template. So the warm-up now starts when the reader reaches for it — see the
    // search field, which wakes the model on a tap.
  }, [hydrate, onboardingActive]);

  // Which way the last navigation went (drives the peel origin). Taking the left choice /
  // swiping the card leftwards → 'left'; right → 'right'.
  const sideRef = useRef<Side>('right');
  const downRef = useRef(false);
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
  // Screen x the finger went down at; the corner mapping for a swipe UP needs it.
  const originX = useSharedValue(0);
  // 1 while the page must not be swiped away — an interject question that has not been
  // answered. The card still moves, but barely (LOCKED_GRIP), so the gate is FELT as
  // "this one is holding on" rather than read as a dead screen.
  const locked = useSharedValue(0);
  useEffect(() => {
    locked.value = question && !questionAnswered ? 1 : 0;
  }, [question, questionAnswered, locked]);

  /**
   * Two choices == this card FORKS. The deck visibly splits (the fan behind becomes the two
   * colour-coded branches) and the gesture gains a meaning it has nowhere else: left is
   * pick A, right is pick B. Same `choices.length` rule the page components use for their
   * tickets — the fan and the swipe just echo it. Declared up here, above the loading
   * return, because the pan needs it as a shared value (see forkMiddleUp).
   */
  const forking = choices.length > 1 && !question && !reward && !response;

  /**
   * The card underneath — what a swipe is about to reveal, printed on the sheet behind.
   *
   * The layer behind the deck used to be a blank cream card, so dragging the top one aside
   * exposed an empty rectangle and the turn read as the content vanishing rather than a page
   * being lifted off a stack. Its text is already warm: the store loads a page's successors
   * while the reader is still on the page above it.
   *
   * Single-path pages only. A fork deliberately shows two BLANK coloured sheets instead —
   * they are the two branches, and printing either one's content behind the card would say
   * the choice has already been made.
   */
  const beneath = useMemo(() => {
    if (forking || question || reward || response) return null;
    const nextId = choices[0]?.factId;
    return nextId ? (getCard(nextId) ?? null) : null;
  }, [forking, question, reward, response, choices]);

  /**
   * Its choice tickets are PRINTED on that sheet, so they have to be the ones the store will
   * actually offer — the store draws them from its own state (seen set, trail, thread depth,
   * weighting context), which is why this asks the store rather than re-deriving them here.
   */
  const beneathChoices = useMemo(
    () => (beneath ? previewChoices(language) : []),
    [beneath, language]
  );
  /**
   * Did this card just arrive from the preview underneath?
   *
   * The fan renders the next card in full (`instant`), so during a swipe the reader already
   * sees its illustration and text. It then becomes the top card as a FRESH mount — different
   * parent, new key — which restarts the typewriter and drops `extrasOpacity` back to 0. The
   * card the reader was looking at visibly un-finished itself and re-revealed, illustration
   * and all, for as long as the type took to run.
   *
   * The typewriter is still right for a card arriving unseen — first launch, a search, a
   * reroll, or the page after a quiz, where the fan is empty. It is only wrong for the one
   * case it now contradicts: a card already shown in full a moment ago.
   *
   * The ref holds the PREVIOUS render's beneath id: the effect below commits after render,
   * so while rendering the new page it still describes what was underneath during the swipe.
   */
  const prevBeneathId = useRef<string | null>(null);
  const cameFromPreview = !!current && prevBeneathId.current === current.id;
  useEffect(() => {
    prevBeneathId.current = beneath?.id ?? null;
  });

  const forkGate = useSharedValue(0);
  useEffect(() => {
    forkGate.value = forking ? 1 : 0;
  }, [forking, forkGate]);

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
        down: downRef.current,
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
   * from. A swipe UP has no side of its own, so on a fork it keeps the meaning it always
   * had: the corner it started from (the ambiguous middle band never reaches this function
   * — the pan refuses it). On a single-path card every direction simply means "next".
   */
  const commitSwipe = useCallback(
    (dir: SwipeDir, releaseX: number, releaseY: number, downX: number) => {
      const s = useCardStore.getState();
      const before = s.pageKey;
      // Hand the peel the exact offset the finger let go at, before anything navigates.
      release.current = { x: releaseX, y: releaseY };
      // A sideways swipe names its own side. A VERTICAL one doesn't, so the peel hinges on
      // the half of the card the finger came from — the corner peel this gesture always had.
      const vertical = dir === 'up' || dir === 'down';
      const side: Side = vertical ? (downX < width / 2 ? 'left' : 'right') : dir;
      downRef.current = dir === 'down';

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
        if (vertical) {
          // A fork is a decision, so a vertical throw only counts from one of the edges —
          // the ambiguous middle settles back rather than guessing for the kid.
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
        })
        .onStart(() => {
          runOnJS(markDragStart)();
        })
        .onUpdate((e) => {
          // The card follows the FINGER, on both axes.
          //
          // It used to lock to an axis on the first frame of movement and zero the other for
          // the rest of the gesture. That frame is a few pixels of noise, and the tie went to
          // X — so a drag that began a hair more sideways was pinned horizontally no matter
          // where the finger went afterwards. Vertical swipes read as ignored and the card
          // felt like it was on rails. Which direction was MEANT is a question about the
          // whole gesture, so it is answered at the end (see onEnd) rather than guessed at
          // the start.
          const grip = locked.value === 1 ? LOCKED_GRIP : 1;
          dragX.value = e.translationX * grip;
          dragY.value = e.translationY * grip;
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
          // Decided now, from the whole gesture: the axis the finger actually travelled on.
          if (Math.abs(e.translationX) > Math.abs(e.translationY)) {
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
            const ty = e.translationY;
            // Same rule as the horizontal axis: velocity only rescues a throw that AGREES
            // with where the card actually is, so dragging it back fast never commits.
            const flicked =
              Math.abs(e.velocityY) > COMMIT_VELOCITY &&
              e.velocityY * ty > 0 &&
              Math.abs(ty) > FLICK_MIN_UP_PX;
            if (Math.abs(ty) > COMMIT_UP_PX || flicked) {
              runOnJS(commitSwipe)(ty < 0 ? 'up' : 'down', dragX.value, dragY.value, originX.value);
            } else {
              settleBack();
            }
          }
        })
        .onFinalize(() => {
          runOnJS(markDragEnd)();
        }),
    [width, commitSwipe, markDragStart, markDragEnd, dragX, dragY, locked, originX]
  );

  // Peel transform: card hinges up from the swiped corner, slides off the top.
  // 2D (no 3D perspective → no foreshorten/recede), corner-anchored via a translate
  // sandwich, with a small tilt so it reads as peeling from that corner.
  const side = outgoing?.side ?? 'right';
  const thrownDown = outgoing?.down ?? false;
  const cardW = pageSize.w || width; // fall back to the screen until the deck has measured
  const cx = side === 'left' ? -cardW / 2 : cardW / 2; // pivot = left / right edge
  // The hinge is the corner the card leaves AROUND: the bottom one as it lifts off the top,
  // the top one as it drops off the bottom. Peeling a downward throw from the bottom corner
  // would swing the card up into the screen before it left, which reads as a bounce.
  const cy = thrownDown ? -pageSize.h / 2 : pageSize.h / 2;
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
  const lift = flip.interpolate({
    inputRange: [0, 1],
    outputRange: [fromY, thrownDown ? pageSize.h * 1.12 : -(pageSize.h * 1.12)],
  });
  // The tilt follows the hinge, so it reverses with it — a downward peel that kept the
  // upward rotation would look like the card twisting against its own exit.
  const tiltDeg = (side === 'left' ? 10 : -10) * (thrownDown ? -1 : 1);
  const tilt = flip.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', `${tiltDeg}deg`],
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
        {/*
          Tapping the field WAKES the model.
          The reader reaches for the ask box, and that is the moment the engine is actually
          wanted — so it is the moment the load starts, rather than at launch where it stole
          the JS thread from the feed. From that tap the field becomes its own readiness
          bar: stage-truthful status lines typewrite in the placeholder slot ("Sinusuri ang
          na-download…", "Ginigising si Hiraia…"), and the one-tap retry still covers a
          failed warm-up.
        */}
        <Pressable
          // The field IS the readiness bar: its surface starts as a ~30%-opacity ghost of
          // the cream stock and steps toward fully printed as the composed readiness
          // climbs (fieldSurface — stepped on MEASURED contrast, the text colour crossing
          // white→ink with it; the 0.38–0.60 alpha band is skipped because nothing stays
          // legible on it). Fully live → the plain stock field, exactly as before.
          style={[styles.searchField, !engineReady && { backgroundColor: surface.backgroundColor }]}
          onPress={warmModel}
          disabled={engineReady || warming}
          accessibilityLabel={t.cards.searchPlaceholder}
        >
          <View style={styles.searchDiamond} />
          {warming && !engineReady ? (
            // A load is in flight: the placeholder becomes the live status line —
            // stage-truthful messages typewritten in, rotated ~10 s (useReadinessMessage).
            // A Text, not a TextInput placeholder: placeholders cannot animate. Its
            // hooks live in a memoized leaf so the 30 ms ticks never reconcile the deck.
            <SearchStatusLine stage={readyStage} language={language} color={surface.textColor} />
          ) : (
            <TextInput
              // Until the engine can answer, the input must not swallow the touch — the
              // parent Pressable is the wake target, and `editable={false}` alone is not a
              // reliable guarantee that the tap reaches it.
              pointerEvents={engineReady ? 'auto' : 'none'}
              style={[styles.searchInput, !engineReady && { color: surface.textColor }]}
              value={queryText}
              onChangeText={setQueryText}
              onSubmitEditing={submitQuery}
              placeholder={engineError ? t.cards.searchUnavailable : t.cards.searchPlaceholder}
              // On the ghost surface only plate-white measures ≥4.5:1; on the live stock
              // field the usual olive does (4.79:1). surface.textColor knows which is which.
              placeholderTextColor={engineReady ? card.olive : surface.textColor}
              returnKeyType="search"
              // Non-interactive until the engine can actually answer. A kid tapping in and
              // getting a dead keyboard is worse than the field plainly looking not-yet-ready.
              // Deliberately at ENGINE-ready, not full-green: the LaBSE download that runs
              // the bar's last band only sharpens retrieval — lexical answers already work,
              // and a child on slow Wi-Fi should not wait out 384 MB more for that.
              editable={!asking && engineReady}
              selectionColor={card.sage}
            />
          )}
          {/* While an answer is being generated the submit button becomes a progress
              circle, so the kid knows the app is working and they should wait. */}
          {warming ? (
            // Deliberately the small passive spinner, not the ink one used for `asking`:
            // this is "not ready yet" and must not compete with the card for attention the
            // way an active in-flight request should. Its colour follows the field's
            // measured text colour — olive is invisible (1.02:1) on the ghost surface.
            <ActivityIndicator size="small" color={surface.textColor} style={styles.searchSpinner} />
          ) : engineError ? (
            // Warm-up failed. Never spin forever — offer the retry that warmModel() already
            // implements, so a transient failure is one tap from recovery.
            <Pressable onPress={warmModel} hitSlop={8}>
              <View style={[styles.sendChip, styles.sendChipOff]}>
                <View style={[styles.sendArrow, styles.sendArrowOff]} />
              </View>
            </Pressable>
          ) : asking ? (
            <ActivityIndicator size="small" color={card.ink} style={styles.searchSpinner} />
          ) : (
            <Pressable onPress={submitQuery} disabled={!canSend} hitSlop={8}>
              <View style={[styles.sendChip, !canSend && styles.sendChipOff]}>
                {/* the mockup's ▶ as a border triangle: the glyph itself risks Android's
                    emoji presentation (a blue play button), which is off-palette. */}
                <View style={[styles.sendArrow, !canSend && styles.sendArrowOff]} />
              </View>
            </Pressable>
          )}
        </Pressable>
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
        {/* The 4 px readiness bar, crawling the full page width under the field. Width
            and colour are the SAME composed number the field's opacity shows — the
            colour walks the palette red→orange→yellow→green in four deliberate steps
            (barColor: measured ≥3:1 on the board; raw oxblood/olive fail and are
            blended toward peach/sage — see searchReadiness.ts). It never rewinds: the
            store's readiness is monotonic through even the GPU→CPU retry. It outlives
            engine-ready on purpose, finishing green only when the background LaBSE
            band lands (or gives up — either way the loading story ends). */}
        {barVisible ? (
          <View pointerEvents="none" style={styles.readyBarTrack}>
            <View
              style={[
                styles.readyBarFill,
                { width: `${Math.round(readiness * 100)}%`, backgroundColor: barColor(readiness) },
              ]}
            />
          </View>
        ) : null}
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
              <View style={[styles.fan, styles.fanSingle]} pointerEvents="none">
                {beneath ? (
                  <CardPage
                    fact={beneath}
                    choices={beneathChoices}
                    language={language}
                    onChoose={() => undefined}
                    instant
                  />
                ) : null}
              </View>
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
                  instant={cameFromPreview}
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

      {/* Deck counter under the card (mockup `.counter`), with the quiz score at the right.
          It now reads "GRADE 5 · PAHINA 8" and is the ONLY door to Settings on this screen:
          the sidebar used to hang off the chat header, which is shelved, so on the feed the
          language and grade were unreachable. Putting the control on the label itself keeps
          the chrome as bare as the mockup draws it — no second button next to the die — and
          it is SAFE here in a way it would not be on the card: the footer sits OUTSIDE the
          GestureDetector that wraps the deck, so a tap on it cannot be stolen by (or steal
          from) the swipe. "Grade" stays English in all three languages (GRADE_WORD); only
          the page word is localised.
          The leading ☰ is load-bearing, not decoration: without it this strip is
          byte-identical in style to the static "✓ 3" beside it and to the read counter it
          replaced, so it reads as a caption and never gets tapped — and an EXISTING install
          has a saved language, so bootstrap() leaves onboardingActive false and the grade
          slide never shows it that Settings exists. Language, grade and chat history would
          then be unreachable for exactly the users who already have the app. */}
      <View style={[styles.caption, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.captionSide} />
        <Pressable
          style={({ pressed }) => [styles.captionTap, pressed && styles.captionTapPressed]}
          onPress={() => router.push('/sidebar')}
          hitSlop={10}
          // No accessibilityLabel: the rendered "Grade 5 · pahina 8" IS the label, and it is
          // already localised — a hand-written one would only repeat it in one language.
          accessibilityRole="button"
        >
          <Text style={styles.captionText} numberOfLines={1}>
            <Text style={styles.captionMenuGlyph}>☰</Text>{'  '}
            {GRADE_WORD[language]} {grade} · {t.cards.readLabel} {pagesRead}
          </Text>
        </Pressable>
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
  /**
   * Idle/disabled send: NOT the old `opacity: 0.3` fade — dimming the whole ink chip made
   * a "transparent gray box" whose gold arrow measured near-invisible on device (Luis,
   * 2026-09-02). Instead the chip goes quiet (transparent fill) and the ARROW carries the
   * state in forest ink at full strength — visibly present, visibly not-lit.
   */
  sendChipOff: { backgroundColor: 'transparent' },
  sendArrowOff: { borderLeftColor: card.ink },
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
  // The status line that stands in for the input while a load is in flight (same
  // metrics as searchInput so the swap never reflows the row). Colour comes from
  // fieldSurface — the only one measured legible on the current surface step.
  // (Replaces the old `searchInputIdle` opacity dim: the field's readiness surface
  // IS the not-yet-available look now.)
  searchStatus: {
    flex: 1,
    fontFamily: fonts.cardBody,
    // Hints, not content: italic (Android synthesizes oblique for custom fonts) at a size
    // where the LONGEST library phrase fits two lines untruncated (Luis, 2026-09-02:
    // "let's not truncate our download phrases, and italicize them").
    fontStyle: 'italic',
    fontSize: 13.5,
    lineHeight: 17,
  },
  // Screen-reader-only: the polite live region announcing the FULL status message
  // (the visible typewriter Text is hidden from accessibility — see SearchStatusLine).
  // Absolute + 1×1 + transparent so it never affects the row's layout or paint.
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  searchSpinner: { width: 32 },
  // ---- readiness bar (under the field, full page width) ----
  readyBarTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 4,
  },
  readyBarFill: {
    height: 4,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
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
  // The tap target, not the type: it takes the row's growth so the label stays optically
  // centred between the two 46dp gutters, and gives the whole strip a comfortable target
  // (the 9.5px caps alone would be a ~14dp-tall one) rather than only the glyphs.
  captionTap: { flex: 1, paddingVertical: 4 },
  captionTapPressed: { opacity: 0.55 },
  // The affordance. Gold (the wordmark's accent) against the sage caption, and a size up from
  // the 9.5px caps, so the row announces itself as a control instead of a label.
  captionMenuGlyph: { fontSize: 12, color: card.gold },
  captionText: {
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
