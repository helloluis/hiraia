import { LessonRecapPage } from './LessonRecapPage';
import { type LessonRecap } from '../../data/lessonRecap';
import { TitleCardPage } from './TitleCardPage';
import type { TitleCardContent } from '../../data/titleCard';
import { Wordmark } from '../brand/Wordmark';
import { useNextCardPreview } from './useNextCardPreview';
import { AdaptiveCardPager } from './AdaptiveCardPager';
import { dismissKeyboardAfterBlur } from '../../../modules/hiraia-reader-input/src';
import { rememberPage } from './verticalFeed';
import { createReadingSession } from './readingSession';
import { ReviewSeries } from '../../reviews/ReviewSeries';
import { overallStars } from '../../reviews/logic';
import { useReviewStore, type CompletedReviewAttempt } from '../../reviews/store';
import { useProfiles, activeProfile, requestProfileChoice } from '../../profiles';
import { useAssessmentStore } from '../../assessment/store';
import { assessmentFeedGates } from '../../assessment/uiCopy';
import { useCardTextRow } from '../../data/cardTextSource';
/** Native vertical card feed. Reading history never advances the curriculum store. */
import { MemoryNotice } from './MemoryNotice';
import { useFeedTelemetry } from '../../telemetry/useFeedTelemetry';
import { useFocusEffect, useRouter } from 'expo-router';
import Svg, { Circle, Path, Polygon } from 'react-native-svg';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Language } from '@hiraia/shared';

import { GRADE_WORD } from '../../config/grades';
import { uiStrings } from '../../config/strings';
import {
  cardText,
  cursorTopic,
  topicTitle,
  type CardChoice,
  type CardFact,
  type CardQuestion,
} from '../../data/cards';
import type { RewardContent } from '../../data/reward';
import { useCardStore, type FeedResponse } from '../../store/cardStore';
import { useEngineStore } from '../../store/engineStore';
import { card, cardAlpha, fonts } from '../../theme';
import { useReduceMotion } from './useReduceMotion';
import { barColor } from './searchReadiness';
import { CARD_EDGE, CARD_RADIUS, TapTarget, cardFrame } from './CardFrame';
import { CardPage } from './CardPage';
import { CurriculumSheet } from './CurriculumSheet';
import { QuestionPage } from './QuestionPage';
import { ResponseCard } from './ResponseCard';
import { RewardCard } from './RewardCard';

const METER_TICKS = 5;
interface PageSnap {
  key: string;
  lessonRecap: LessonRecap | null;
  titleCard: TitleCardContent | null;
  fact: CardFact | null;
  choices: CardChoice[];
  question: CardQuestion | null;
  reward: RewardContent | null;
  response: FeedResponse | null;
  order?: number[];
  selected?: number | null;
  pagesRead: number;
}
const readingSessions = createReadingSession<PageSnap>();
const NOOP = () => {};
const stockFor = (question: CardQuestion | null) => (question ? card.teal : card.stock);

/** The horizontal pager already scrolls each card; narrow pages need their own quiz
 * scroller so answers, explanations and Continue cannot escape the fixed page shell. */
function FeedQuestion({ wide, ...props }: ComponentProps<typeof QuestionPage> & { wide: boolean }) {
  const content = <QuestionPage {...props} scrollable showContinue={!wide} />;
  return wide ? content : <ScrollView nestedScrollEnabled style={{ flex: 1 }}
    contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
    {content}
  </ScrollView>;
}

/** Learning evidence is local and independent of the optional telemetry service. */
function AssessmentExposure({ fact, language, visible }: {
  fact: CardFact;
  language: Language;
  visible: boolean;
}) {
  const row = useCardTextRow(fact.id);
  const text = cardText(fact, language);
  useEffect(() => {
    if (!visible || !row || !text) return;
    const timer = setTimeout(() => {
      if (AppState.currentState !== 'active') return;
      const assessment = useAssessmentStore.getState();
      if (!assessment.loaded || assessment.activeSession || assessment.results) return;
      void assessment.recordExposure({ cardId: fact.id, language, exactRenderedBody: text, timestamp: Date.now() });
    }, 500);
    return () => clearTimeout(timer);
  }, [visible, row, text, fact.id, language]);
  return null;
}

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

/**
 * A wall calendar, drawn as Views for the same reason the die is: an ink header band with
 * two hanging rings, and a page of day-cells below. Same 22dp footprint as the die so the
 * crossfade between the two faces never shifts the button's optical centre.
 */
const CAL_ROWS: boolean[][] = [
  [true, true, true, true],
  [true, true, true, false],
];

function CalendarFace() {
  return (
    <View style={styles.cal}>
      <View style={styles.calRings}>
        <View style={styles.calRing} />
        <View style={styles.calRing} />
      </View>
      <View style={styles.calPage}>
        <View style={styles.calHead} />
        <View style={styles.calGrid}>
          {CAL_ROWS.map((row, r) => (
            <View key={r} style={styles.calRow}>
              {row.map((day, c) => (
                <View key={c} style={[styles.calCell, day && styles.calDay]} />
              ))}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

/** How long each face of the cycling button shows before it swaps to the other. */
const FACE_CYCLE_MS = 2000;
/** The crossfade between the two faces (plain Animated, native driver). */
const FACE_FADE_MS = 250;

type Face = 'die' | 'calendar';

/**
 * The top-right button: a die and a calendar, alternating every FACE_CYCLE_MS on a loop with a
 * crossfade. Its action follows the face SHOWING AT TOUCH-DOWN, and the cycle FREEZES while
 * the finger is down and while the outline sheet is open (`frozen`), so a swap can never steal
 * a tap between touch-down and release.
 *
 * How the freeze works: the interval keeps ticking, but each tick reads two refs
 * synchronously and does nothing while either is set — `pressed` (onPressIn → onPressOut) and
 * `frozen` (mirrored from the prop). onPressIn also snapshots the showing face into `touched`,
 * and onPress dispatches on THAT snapshot, never on the current state: even if a tick had been
 * queued for the same frame, the action is bound to what the finger landed on. The showing
 * face flips at the crossfade's MIDPOINT — the instant the incoming face becomes the more
 * visible of the two — so a tap during the fade follows whichever face the eye actually sees
 * (flipping at the fade's start would bind its first 125 ms to a face still ~96% transparent).
 * The accessibility label and the action switch together at that same instant.
 *
 * Reduced motion: no crossfade, the faces swap instantly (the loop itself stays — it is what
 * advertises the calendar exists — at the same 2 s cadence).
 */
/**
 * "New Random Topic!" — pops over the ask box the moment the die is tapped and fades a beat
 * later, so a kid who just hit a mystery button learns what it did. `tick` is a counter, not
 * a boolean: every tap re-pops it, even mid-fade. Native-driver opacity+scale only, never
 * intercepts touches, announced politely to TalkBack. Reduced motion keeps the fade and
 * drops the scale pop.
 */
const TOAST_POP_MS = 160;
const TOAST_HOLD_MS = 900;
const TOAST_FADE_MS = 320;

const RerollToast = memo(function RerollToast({ tick, text }: { tick: number; text: string }) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;
  useEffect(() => {
    if (tick === 0) return;
    opacity.stopAnimation();
    scale.stopAnimation();
    scale.setValue(reduceMotion ? 1 : 0.85);
    const pop = reduceMotion
      ? Animated.timing(opacity, { toValue: 1, duration: TOAST_POP_MS, useNativeDriver: true })
      : Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: TOAST_POP_MS, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, tension: 220, friction: 7, useNativeDriver: true }),
        ]);
    const run = Animated.sequence([
      pop,
      Animated.delay(TOAST_HOLD_MS),
      Animated.timing(opacity, { toValue: 0, duration: TOAST_FADE_MS, useNativeDriver: true }),
    ]);
    run.start();
    return () => run.stop();
  }, [tick, reduceMotion, opacity, scale]);
  if (tick === 0) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.rerollToast, { opacity, transform: [{ scale }] }]}
    >
      <Text style={styles.rerollToastText} numberOfLines={1}>
        {text}
      </Text>
    </Animated.View>
  );
});

const CycleButton = memo(function CycleButton({
  language,
  frozen,
  onDie,
  onCalendar,
}: {
  language: Language;
  frozen: boolean;
  onDie: () => void;
  onCalendar: () => void;
}) {
  const t = uiStrings(language);
  const reduceMotion = useReduceMotion();
  const [face, setFace] = useState<Face>('die');
  const faceRef = useRef<Face>('die');
  const touched = useRef<Face>('die');
  const pressed = useRef(false);
  const frozenRef = useRef(frozen);
  useEffect(() => {
    frozenRef.current = frozen;
  }, [frozen]);
  // 0 = the die shows, 1 = the calendar shows; the die's opacity is the complement.
  const cal = useRef(new Animated.Value(0)).current;
  const dieOpacity = useRef(cal.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })).current;

  useEffect(() => {
    let flipAt: ReturnType<typeof setTimeout> | null = null;
    const id = setInterval(() => {
      if (pressed.current || frozenRef.current) return;
      const next: Face = faceRef.current === 'die' ? 'calendar' : 'die';
      const show = () => {
        flipAt = null;
        faceRef.current = next;
        setFace(next);
      };
      const to = next === 'calendar' ? 1 : 0;
      if (reduceMotion) {
        cal.setValue(to);
        show();
      } else {
        Animated.timing(cal, {
          toValue: to,
          duration: FACE_FADE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }).start();
        // the showing face flips when the incoming one becomes the more visible (see above)
        flipAt = setTimeout(show, FACE_FADE_MS / 2);
      }
    }, FACE_CYCLE_MS);
    return () => {
      clearInterval(id);
      if (flipAt) clearTimeout(flipAt);
    };
  }, [cal, reduceMotion]);

  return (
    <Pressable
      onPressIn={() => {
        pressed.current = true;
        touched.current = faceRef.current;
      }}
      onPressOut={() => {
        pressed.current = false;
      }}
      onPress={() => (touched.current === 'die' ? onDie() : onCalendar())}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={face === 'die' ? t.cards.reroll : t.cards.openCurriculum}
      // A FUNCTION style, not the plain object this used to be, and that IS the fix: Pressable
      // only tracks a pressed state when `style` (or `children`) is a function, so the button
      // had no acknowledgement of any kind. onPressIn writes two refs, which do not render.
      // A tap that starts a few hundred ms of work therefore looked, to a child, like a tap
      // that did nothing — the reported bug. Every neighbour on this screen already dims.
      style={({ pressed }) => [styles.reroll, pressed && styles.rerollPressed]}
    >
      <Animated.View style={[styles.face, { opacity: dieOpacity }]} pointerEvents="none">
        <DieFace />
      </Animated.View>
      <Animated.View style={[styles.face, { opacity: cal }]} pointerEvents="none">
        <CalendarFace />
      </Animated.View>
    </Pressable>
  );
});

/** How long the finished (full-width, sage) readiness bar lingers before unmounting —
 *  the child gets to SEE the walk complete to green, the spec's payoff moment. */
const DONE_LINGER_MS = 800;

/** Shared top bar, outside the scrolling card list. */
const ChromeBar = memo(function ChromeBar({ desktop = false, children }: { desktop?: boolean; children?: ReactNode }) {
  useProfiles();
  const student = activeProfile();
  return (
    <View style={[styles.chrome, desktop && styles.desktopChrome]}>
      {!desktop && <Wordmark size={26} color={card.stock} />}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Switch student: ${student?.name ?? 'Guest'}`}
        onPress={() => {
          useEngineStore.getState().setOnboardingActive(true);
          requestProfileChoice();
        }}
        style={({ pressed }) => [styles.profilePill, desktop && styles.desktopProfile, pressed && { opacity: 0.75 }]}
      >
        <Text numberOfLines={1} style={styles.profileName}>
          {student?.name ?? 'Guest'}
        </Text>
        <Svg width={30} height={24} viewBox="0 0 30 24" accessible={false}>
          {/* The next profile sits behind; the current student is larger and in front. */}
          <Circle cx={20} cy={5} r={3.1} fill={card.sage} />
          <Path
            d="M14.8 13.2c.7-3 2.5-4.6 5.2-4.6s4.5 1.6 5.2 4.6"
            fill="none"
            stroke={card.sage}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <Circle cx={9.3} cy={9} r={3.7} fill={card.gold} />
          <Path
            d="M3.3 20c.8-4.1 2.8-6.1 6-6.1s5.2 2 6 6.1"
            fill="none"
            stroke={card.gold}
            strokeWidth={2.6}
            strokeLinecap="round"
          />
          {/* A rising handoff arrow points from the current student to the profile behind. */}
          <Path
            d="M13.8 20.2c4.8.5 8.2-1.5 9.1-5.5m-3.2 1.5 3.5-2.7 2.1 3.8"
            fill="none"
            stroke={card.stock}
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Pressable>
      {children}
    </View>
  );
});

/** The footer caption/settings strip, memoized for the same reason as ChromeBar. */
const Caption = memo(function Caption({
  language, grade, correctCount, stars, remediationActive, bottomPad, onOpenSettings,
  desktop = false, context,
}: {
  language: Language;
  grade: number;
  correctCount: number;
  stars: number;
  remediationActive: boolean;
  bottomPad: number;
  onOpenSettings: () => void;
  desktop?: boolean;
  context?: ReactNode;
}) {
  const settings = <TapTarget
    onPress={onOpenSettings}
    accessibilityLabel={language === 'english' ? 'Settings' : 'Mga setting'}
    style={pressed => [styles.settingsButton, pressed && styles.settingsFocused]}
  >
        <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
          <Polygon
            points="23.00,12.00 22.79,14.15 19.85,15.25 19.07,16.72 19.78,19.78 18.11,21.15 15.25,19.85 13.66,20.34 12.00,23.00 9.85,22.79 8.75,19.85 7.28,19.07 4.22,19.78 2.85,18.11 4.15,15.25 3.66,13.66 1.00,12.00 1.21,9.85 4.15,8.75 4.93,7.28 4.22,4.22 5.89,2.85 8.75,4.15 10.34,3.66 12.00,1.00 14.15,1.21 15.25,4.15 16.72,4.93 19.78,4.22 21.15,5.89 19.85,8.75 20.34,10.34"
            fill={card.gold}
          />
          <Circle cx="12" cy="12" r="4" fill={card.board} />
        </Svg>
  </TapTarget>;
  return (
    <View style={desktop ? styles.desktopCaption : [styles.caption, { paddingBottom: bottomPad }]}>
      {!desktop && settings}
      <Text style={desktop ? styles.desktopGrade : styles.captionText}>
        {GRADE_WORD[language]} {grade}
        {remediationActive ? '*' : ''}
        {stars > 0 ? ` · ${'★'.repeat(stars)}` : ''}
      </Text>
      <Text style={desktop ? styles.desktopScore : [styles.captionScore, styles.captionSide]}>
        {desktop ? 'Quiz ' : ''}✓ {correctCount}
      </Text>
      {desktop && <><View style={styles.desktopContextSlot}>{context}</View>{settings}</>}
    </View>
  );
});

export function CardFeedScreen() {
  const { activeId } = useProfiles();
  const grade = useEngineStore((s) => s.grade);
  return <CardFeed key={`${activeId}:${grade}`} />;
}

function CardFeed() {
  const router = useRouter();
  const profiles = useProfiles();
  const language = useEngineStore((s) => s.language) ?? 'tagalog';
  // Wide windows put profile, grade, score and settings together above the cards.
  const grade = useEngineStore((s) => s.grade);
  const onboardingActive = useEngineStore((s) => s.onboardingActive);
  const readingSession = useMemo(() => readingSessions.open(`${profiles.activeId}:${grade}`), [profiles.activeId, grade]);
  const memoryNotice = useEngineStore((s) => s.memoryNotice);
  const t = uiStrings(language);
  const insets = useSafeAreaInsets();
  const { width: windowWidth, fontScale } = useWindowDimensions();
  const wideWindow = windowWidth >= 840;
  const actionLabels = windowWidth / Math.max(1, fontScale) >= 1100;
  // Stable handle for the memoized footer (see Caption below the styles).
  const openSettings = useCallback(() => router.push('/sidebar'), [router]);

  const [liveVisible, setLiveVisible] = useState(true);
  const assessmentLoaded = useAssessmentStore((s) => s.loaded);
  const assessmentBusy = useAssessmentStore((s) => s.busy);
  const assessmentOpen = useAssessmentStore((s) => !!s.activeSession || !!s.results || !!s.error);
  useFeedTelemetry(liveVisible && !assessmentOpen);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => setForeground(next === 'active'));
    return () => listener.remove();
  }, []);
  const hydrated = useCardStore((s) => s.hydrated);
  const hydrate = useCardStore((s) => s.hydrate);
  const current = useCardStore((s) => s.current);
  const choices = useCardStore((s) => s.choices);
  const lessonRecap = useCardStore((s) => s.lessonRecap);
  const repeatLesson = useCardStore((s) => s.repeatLesson);
  const titleCard = useCardStore((s) => s.titleCard);
  const question = useCardStore((s) => s.question);
  const reward = useCardStore((s) => s.reward);
  const response = useCardStore((s) => s.response);
  const asking = useCardStore((s) => s.asking);
  // The feed itself needs no model, but the SEARCH FIELD does — so the warm-up state is shown
  // here rather than as a full-screen gate (see the note in app/_layout.tsx).
  // Optional model progress never disables keyword search.
  const readiness = useEngineStore((s) => Math.floor(s.readiness * 50) / 50);
  const readyStage = useEngineStore((s) => s.readyStage);
  // The four views of that one number: field surface (opacity step + measured text
  // colour), bar width, bar colour, message pool. See searchReadiness.ts.
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
  // The ribbon IS the magnet: it shows exactly while an asked topic is pulling the feed, so
  // the [x] below and the store's auto-release both retire copy and pull in the same commit.
  const queryBanner = useCardStore((s) => s.magnet?.query ?? null);
  const dismissQuery = useCardStore((s) => s.dismissQuery);
  // The curriculum ribbon and topic picker follow the live lesson.
  const curriculum = useCardStore((s) => s.curriculum);
  const currentTopic = useCardStore((s) => s.currentTopic);
  const curriculumTopic = currentTopic ? cursorTopic(currentTopic) : undefined;
  const reviewActive = useReviewStore((s) => s.open || s.busy || !!s.error);
  const reviewReadCount = useReviewStore((s) => s.data?.recent.length ?? 0);
  const achievementStars = useReviewStore((s) =>
    s.data?.grade === grade ? overallStars(s.data) : 0
  );
  const remediationActive = useReviewStore((s) => s.data?.grade === grade && !!s.data.remediation);
  const enterCurriculum = useCardStore((s) => s.enterCurriculum);
  const [sheetOpen, setSheetOpen] = useState(false);
  const openSheet = useCallback(() => setSheetOpen(true), []);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const pageKey = useCardStore((s) => s.pageKey);
  const pagesRead = useCardStore((s) => s.pagesRead);
  const correctCount = useCardStore((s) => s.correctCount);
  const questionAnswered = useCardStore((s) => s.questionAnswered);
  const answerQuestion = useCardStore((s) => s.answerQuestion);
  const ask = useCardStore((s) => s.ask);
  const warmModel = useCardStore((s) => s.warmModel);
  const jumpToRandom = useCardStore((s) => s.jumpToRandom);
  const nextPreview = useNextCardPreview(language);
  const kind = lessonRecap ? 'recap' : titleCard ? 'title' : question ? 'quiz'
    : reward ? 'reward' : response ? 'response' : 'fact';
  const { unobstructed } = assessmentFeedGates({
    foreground, focused, onboarding: onboardingActive, choosingProfile: profiles.choosing,
    asking, review: reviewActive, sheet: sheetOpen, assessment: assessmentOpen,
    search: searchFocused, memoryNotice: !!memoryNotice, liveVisible, pageKind: kind,
    loaded: assessmentLoaded, busy: assessmentBusy,
  });
  const [history, setHistory] = useState<PageSnap[]>(() => readingSession.pages);
  const historyKey = useRef(readingSession.reviewKey);
  useLayoutEffect(() => { readingSession.pages = history; }, [history, readingSession]);
  const liveKey = `${pageKey}:${kind}`;
  // Keep quiz ordering and the selected display index even after a virtualized page unmounts.
  const order = useMemo(() => {
    const restored = readingSession.pages.find(page => page.key === liveKey)?.order;
    if (restored) return restored;
    const indices = question?.o.map((_, i) => i);
    if (indices)
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j]!, indices[i]!];
      }
    return indices;
  }, [liveKey, question, readingSession]);
  const [answer, setAnswer] = useState<{ key: string; selected: number } | null>(() => {
    const restored = readingSession.pages.find(page => page.key === liveKey)?.selected;
    return restored == null ? null : { key: liveKey, selected: restored };
  });
  const rememberVisible = useCallback((live: boolean, key?: string) => {
    if (key) readingSession.visibleKey = key;
    setLiveVisible(live);
  }, [readingSession]);
  const selected = answer?.key === liveKey ? answer.selected : null;
  useLayoutEffect(() => {
    if (!current || !hydrated) return;
    setHistory((old) =>
      rememberPage(old, {
        key: liveKey,
        lessonRecap,
        titleCard,
        fact: current,
        choices,
        question,
        reward,
        response,
        pagesRead,
        order,
        selected,
      })
    );
  }, [
    liveKey,
    current,
    hydrated,
    lessonRecap,
    titleCard,
    choices,
    question,
    reward,
    response,
    pagesRead,
    order,
    selected,
  ]);
  // Include a store commit immediately, before the history effect runs. The ready
  // neighbour and the newly live row have the same key, preserving their native view.
  const feedPages =
    current && hydrated
      ? rememberPage(history, {
          key: liveKey,
          lessonRecap,
          titleCard,
          fact: current,
          choices,
          question,
          reward,
          response,
          pagesRead,
          order,
          selected,
        })
      : history;
  const onReviewGraded = useCallback((result: CompletedReviewAttempt) => {
    useCardStore.getState().recordReviewGrade(result);
    const quiz: PageSnap = {
      key: `review:${historyKey.current++}`,
      lessonRecap: null,
      titleCard: null,
      fact: null,
      choices: [],
      question: result.attempt.question,
      reward: null,
      response: null,
      order: result.attempt.order,
      selected: result.attempt.selected!,
      pagesRead: useCardStore.getState().pagesRead,
    };
    readingSession.reviewKey = historyKey.current;
    // Record quiz results after the fact that triggered them. The review modal locks
    // scrolling until the store appends the next fact or lesson recap.
    setHistory((old) => rememberPage(old, quiz));
  }, [readingSession]);
  const advance = useCallback(() => {
    const s = useCardStore.getState();
    const review = useReviewStore.getState();
    const assessment = useAssessmentStore.getState();
    if (s.asking || review.open || review.busy || review.error || assessment.activeSession || assessment.results) return;
    if (s.lessonRecap) s.continueAfterLessonRecap();
    else if (s.titleCard) s.continueAfterTitle();
    else if (s.response) s.continueAfterResponse();
    else if (s.reward) s.continueAfterReward();
    else if (s.question) {
      if (s.questionAnswered) s.continueAfterQuestion();
    } else if (s.choices[0]) s.choose(s.choices[0]);
  }, []);
  const canAdvance = question
    ? questionAnswered
    : !!(lessonRecap || titleCard || response || reward || choices.length);
  const markDragStart = useCallback(() => useCardStore.getState().markDragStart(), []);
  const markDragEnd = useCallback(() => useCardStore.getState().markDragEnd(), []);
  const pickTopic = useCallback(
    (key: string, shelfCat?: string) => {
      setSheetOpen(false);
      enterCurriculum(key, undefined, shelfCat);
    },
    [enterCurriculum]
  );
  // Counter, not boolean: every die tap must re-pop the toast even mid-fade (see RerollToast).
  const [rerollTick, setRerollTick] = useState(0);

  const [queryText, setQueryText] = useState(readingSession.searchDraft);
  const submitQuery = () => {
    if (assessmentOpen) return;
    const q = queryText.trim();
    if (!q) return;
    Keyboard.dismiss();
    readingSession.searchDraft = '';
    setQueryText('');
    void ask(q);
  };

  useEffect(() => {
    // Browsing needs no model. Hydration waits for the onboarding grade selection;
    // optional semantic setup starts when the student focuses the search box.
    if (!onboardingActive) void hydrate();
  }, [hydrate, onboardingActive]);

  if (!hydrated || !current) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.loading}>
          <Wordmark size={34} color={card.stock} />
          <Text style={styles.loadingDots}>…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const ticksOn = Math.max(
    0,
    Math.min(METER_TICKS, Math.floor((reviewReadCount / 20) * METER_TICKS))
  );
  const canSend = queryText.trim().length > 0;

  const context = <>
      {/* "you asked" ribbon when a search navigated straight to a found card. It rides on
          the BOARD, directly under the box it echoes — not on the card: the top of a card
          is its punched holes and index band, and a ribbon would print straight over them. */}
      {queryBanner && !reward && !question ? (
        <View style={[styles.banner, wideWindow && styles.desktopContext]}>
          <Text style={styles.bannerLabel} numberOfLines={1}>
            {t.cards.yourQuestion}
          </Text>
          <Text style={styles.bannerText} numberOfLines={1}>
            “{queryBanner}”
          </Text>
          {/* The [x]: "this topic is starting to bore me". Ink-ribbon grammar — a stock ✕ in
              a hairline stock ring, the ribbon's own colours. Clearing the magnet unmounts
              the whole ribbon (the query IS the magnet), and the feed continues as it is. */}
          <Pressable
            onPress={dismissQuery}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t.cards.dismissAsk}
            style={styles.bannerDismiss}
          >
            <Text style={styles.bannerDismissGlyph}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {/* CALENDAR MODE's ribbon — the same ribbon grammar, under the same box, one line:
          "KURIKULUM · Q2 · <title>" — the label names the mode and the quarter, the body is the
          held topic's DepEd title in the tutor language. Randomize leaves the mode. Mutually
          exclusive with the ask ribbon by construction (entering either clears the other in the
          store). It names the topic the feed is DRAWING FROM: on the page where a topic runs out
          the cursor has already moved on, so the ribbon already reads the next topic the scroll
          will serve. */}
      {!queryBanner && curriculum && curriculumTopic && !response && !reward && !question ? (
        <View style={[styles.banner, wideWindow && styles.desktopContext]}>
          <Text style={styles.bannerLabel} numberOfLines={1}>
            {t.cards.curriculum} · Q{curriculumTopic.quarter} ·
          </Text>
          <Text style={styles.bannerText} numberOfLines={1}>
            {topicTitle(curriculumTopic, language)}
          </Text>
        </View>
      ) : null}

  </>;
  const renderHeader = (navigation: ReactNode) => <>
    <ChromeBar desktop={wideWindow}>
      {wideWindow && <Caption desktop language={language} grade={grade}
        correctCount={correctCount} stars={achievementStars} remediationActive={remediationActive}
        bottomPad={0} onOpenSettings={openSettings} context={context} />}
    </ChromeBar>
      {/* persistent "ask anything" box — the kid's agency: type a topic or a question and
          RAG decides (found card → response card → honest abstention). Printed as a cream
          index-card field on the board; the gold diamond is the mockup's divider mark. */}
      <View style={styles.searchRow}>
        {/* Keyword search works immediately; focus starts optional semantic setup. */}
        <View style={styles.searchField}>
          <View style={styles.searchDiamond} />
          <TextInput
            accessibilityLabel={t.cards.searchPlaceholder}
            style={styles.searchInput}
            value={queryText}
            onChangeText={value => { readingSession.searchDraft = value; setQueryText(value); }}
            onFocus={() => { setSearchFocused(true); warmModel(); }}
            onBlur={() => { setSearchFocused(false); dismissKeyboardAfterBlur(); }}
            onSubmitEditing={submitQuery}
            placeholder={t.cards.searchPlaceholder}
            placeholderTextColor={card.olive}
            returnKeyType="search"
            editable={!asking && !assessmentOpen}
            selectionColor={card.sage}
          />
          {asking ? (
            <ActivityIndicator size="small" color={card.ink} style={styles.searchSpinner} />
          ) : (
            <TapTarget onPress={submitQuery} disabled={!canSend} hitSlop={4}
              accessibilityLabel={t.cards.searchAction}
              style={pressed => [styles.sendTarget, pressed && { opacity: 0.65 }]}>
              <View style={[styles.sendChip, !canSend && styles.sendChipOff]}>
                <View style={[styles.sendArrow, !canSend && styles.sendArrowOff]} />
              </View>
            </TapTarget>
          )}
        </View>
        {/* The cycling button: DIE = "reroll" (jump to a fresh topic — or, in calendar mode,
            another card of the held topic); CALENDAR = open the grade's MATATAG outline. The
            two faces alternate every 2 s; the cycle freezes while pressed and while the sheet
            is open (see CycleButton). */}
        {wideWindow ? <>
          <TapTarget accessibilityLabel={t.cards.reroll}
            onPress={() => { jumpToRandom(); setRerollTick(n => n + 1); }}
            style={pressed => [styles.desktopAction, pressed && { backgroundColor: card.gold }]}>
            <DieFace />{actionLabels && <Text style={styles.desktopActionText}>{t.cards.reroll}</Text>}
          </TapTarget>
          <TapTarget accessibilityLabel={t.cards.openCurriculum}
            onPress={openSheet}
            style={pressed => [styles.desktopAction, pressed && { backgroundColor: card.gold }]}>
            <CalendarFace />{actionLabels && <Text style={styles.desktopActionText}>{t.cards.curriculum}</Text>}
          </TapTarget>
        </> : <CycleButton
          language={language}
          frozen={sheetOpen || assessmentOpen}
          onDie={() => {
            jumpToRandom();
            setRerollTick((n) => n + 1);
          }}
          onCalendar={openSheet}
        />}
        {navigation}
        <RerollToast
          tick={rerollTick}
          text={curriculum ? t.cards.rerollToastTopic : t.cards.rerollToast}
        />
        {/* Optional-model setup progress; the search field remains interactive. */}
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

    {!wideWindow && context}
  </>;

  return (
    <SafeAreaView style={[styles.screen, wideWindow && { paddingBottom: insets.bottom }]} edges={['top']}>
      {!assessmentOpen && <MemoryNotice />}
      <AdaptiveCardPager
        renderHeader={renderHeader}
        language={language}
        pages={feedPages}
        initialVisibleKey={readingSession.visibleKey}
        preview={nextPreview}
        liveKey={liveKey}
        canAdvance={canAdvance}
        locked={asking || reviewActive || sheetOpen || onboardingActive || assessmentOpen}
        onAdvance={advance}
        onVisible={rememberVisible}
        onDragStart={markDragStart}
        onDragEnd={markDragEnd}
        renderPage={(page, live, forward, visible, minimumHeight) => (
          <View
            pointerEvents={
              asking || reviewActive || sheetOpen || onboardingActive || assessmentOpen ? 'none' : 'auto'
            }
            style={[
              styles.cardLayer,
              { position: 'relative', flex: 1, backgroundColor: stockFor(page.question) },
              wideWindow && { ...cardFrame.scrollContent, minHeight: minimumHeight },
            ]}
          >
            {page.lessonRecap ? (
              <LessonRecapPage
                content={page.lessonRecap}
                language={language}
                onRepeat={repeatLesson}
                readOnly={!live}
                onContinue={forward}
              />
            ) : page.titleCard ? (
              <TitleCardPage content={page.titleCard} language={language} onContinue={forward} />
            ) : page.response ? (
              <ResponseCard response={page.response} language={language} onContinue={forward} />
            ) : page.reward ? (
              <RewardCard reward={page.reward} language={language} onContinue={forward} />
            ) : page.question ? (
              <FeedQuestion
                wide={wideWindow}
                question={page.question}
                language={language}
                displayOrder={page.order}
                selectedOption={live ? selected : page.selected}
                disabled={!live}
                celebrate={live}
                onSelect={live ? (index) => setAnswer({ key: liveKey, selected: index }) : NOOP}
                onAnswer={live ? answerQuestion : NOOP}
                onContinue={forward}
              />
            ) : page.fact ? (
              <>
                <AssessmentExposure fact={page.fact} language={language} visible={visible && unobstructed} />
                <CardPage
                  desktop={wideWindow}
                  fact={page.fact}
                  choices={page.choices}
                  language={language}
                  instant
                  guide={live && visible}
                  onChoose={
                    live
                      ? (choice) => {
                          const state = useCardStore.getState();
                          const assessment = useAssessmentStore.getState();
                          if (state.pageKey === pageKey && !state.asking && !assessment.activeSession && !assessment.results) state.choose(choice);
                        }
                      : forward
                  }
                />
              </>
            ) : null}
            <View pointerEvents="none" style={styles.cardProgress}>
              {Array.from({ length: METER_TICKS }, (_, i) => (
                <View key={i} style={[styles.smallTick, i < ticksOn && styles.smallTickOn]} />
              ))}
              <Text style={styles.cardProgressText}>{page.pagesRead}</Text>
            </View>
          </View>
        )}
      />

      {!wideWindow && <Caption
        language={language}
        grade={grade}
        correctCount={correctCount}
        stars={achievementStars}
        remediationActive={remediationActive}
        bottomPad={Math.max(insets.bottom, 10)}
        onOpenSettings={openSettings}
      />}

      {/* The outline sheet, for the CURRENT grade (the cursor keeps the grade it was entered
          at; a grade change mid-mode shows the new grade's outline on the next open). */}
      <ReviewSeries
        language={language}
        onExit={useCardStore.getState().continueAfterReview}
        onGraded={onReviewGraded}
      />
      <CurriculumSheet
        visible={sheetOpen}
        grade={grade}
        language={language}
        activeKey={curriculum?.key ?? null}
        onPick={pickTopic}
        onClose={closeSheet}
      />
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
  loadingDots: { fontFamily: fonts.slab, fontSize: 26, color: card.sage, marginTop: 10 },

  // ---- chrome ----
  chrome: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  desktopChrome: { gap: 16, paddingVertical: 4 },
  desktopProfile: { maxWidth: 240, minHeight: 48, flexShrink: 1 },
  desktopCaption: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 16 },
  desktopGrade: { fontFamily: fonts.cardBodyBold, fontSize: 15, color: card.stock },
  desktopScore: { fontFamily: fonts.cardBodyBold, fontSize: 15, color: card.gold },
  desktopContextSlot: { flex: 1, minWidth: 0 },
  desktopContext: { marginHorizontal: 0, marginBottom: 0, paddingVertical: 4 },
  settingsButton: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
  settingsFocused: { backgroundColor: card.ink, outlineColor: card.gold, outlineWidth: 2 },
  profilePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '65%',
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: card.sage,
    backgroundColor: card.ink,
  },
  profileName: { flexShrink: 1, color: card.stock, fontFamily: fonts.cardBodyBold, fontSize: 16 },
  cardProgress: {
    height: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    marginBottom: 7,
  },
  smallTick: { width: 4, height: 8, borderRadius: 1, backgroundColor: card.sage },
  smallTickOn: { backgroundColor: card.ink },
  cardProgressText: { fontFamily: fonts.gothic, fontSize: 10, color: card.ink, marginLeft: 4 },

  // ---- search + reroll ----
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  desktopAction: { minHeight: 48, minWidth: 48, maxWidth: 210, justifyContent: 'center', flexDirection: 'row', alignItems: 'center',
    gap: 10, padding: 10, borderRadius: 11, borderWidth: CARD_EDGE, borderColor: card.ink,
    backgroundColor: card.stock },
  desktopActionText: { fontFamily: fonts.cardBodyBold, fontSize: 15, color: card.ink, flexShrink: 1 },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: 2,
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
  sendTarget: { minWidth: 40, minHeight: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
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
  // Touch-down acknowledgement. Sits on the PARENT, so the two crossfading faces keep their
  // own native-driver opacity nodes untouched. 0.6 is the deck's pressed token (the calendar
  // sheet's rows use exactly this).
  rerollPressed: { opacity: 0.6 },
  // the two faces of the cycling button, stacked on the same 22dp square and crossfaded
  face: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  die: { width: 22, height: 22, justifyContent: 'space-between' },
  dieRow: { flexDirection: 'row', justifyContent: 'space-between' },
  diePipCell: { width: 6, height: 6, borderRadius: 3 },
  diePip: { backgroundColor: card.ink },
  // the calendar face: two hanging rings, an ink header band, a page of day-cells
  cal: { width: 22, height: 22, alignItems: 'center' },
  calRings: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: 12,
    height: 4,
    marginBottom: -1, // the rings sink into the header band
    zIndex: 1,
  },
  calRing: { width: 2, height: 4, borderRadius: 1, backgroundColor: card.ink },
  calPage: {
    width: 22,
    height: 19,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: card.ink,
    overflow: 'hidden',
  },
  calHead: { height: 5, backgroundColor: card.ink },
  calGrid: { flex: 1, paddingHorizontal: 2, paddingVertical: 2, justifyContent: 'space-between' },
  calRow: { flexDirection: 'row', justifyContent: 'space-between' },
  calCell: { width: 3, height: 3, borderRadius: 1 },
  calDay: { backgroundColor: card.ink },

  cardLayer: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: CARD_RADIUS,
    borderWidth: CARD_EDGE,
    borderColor: card.ink,
    // backgroundColor is applied inline (cream stock, or teal on a quiz page)
    overflow: 'hidden', // page content is clipped to the card's rounded corners
  },
  // The reroll toast lies OVER the ask box — absolute inside the search row, so no sibling
  // can clip it — in the ribbon's own ink-and-stock grammar.
  rerollToast: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  rerollToastText: {
    fontFamily: fonts.gothic,
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: card.stock,
    backgroundColor: card.ink,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    overflow: 'hidden',
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
  // the ribbon's [x] chip: stock ✕ in a hairline stock ring, on the ink ribbon. 20dp visual
  // (the tap target is grown by hitSlop to ~40dp, comfortably past the 24dp a11y floor).
  bannerDismiss: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: cardAlpha(card.stock, 0.45),
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerDismissGlyph: {
    fontFamily: fonts.gothic,
    fontSize: 10,
    lineHeight: 12,
    color: card.stock,
  },
  // The update ribbon's action chip: the ✕ chip's grammar (stock hairline ring on ink)
  // stretched to a word — gothic caps in stock, so it reads as a button and not a label.
  // 20dp tall like the ✕ so the ribbon's height never changes as the chip's text cycles.
  bannerChip: {
    height: 20,
    minWidth: 44,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: cardAlpha(card.stock, 0.45),
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerChipTap: {
    borderColor: card.gold,
  },
  bannerChipPressed: {
    backgroundColor: cardAlpha(card.gold, 0.18),
  },
  bannerChipText: {
    fontFamily: fonts.gothic,
    fontSize: 8.5,
    letterSpacing: 1.2,
    lineHeight: 12,
    textTransform: 'uppercase',
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
  captionSide: { width: 46 }, // equal gutters keep the label optically centred
  assessmentCaption: { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  assessmentCaptionText: { textAlign: 'center', fontFamily: fonts.cardBodyBold, fontSize: 15, lineHeight: 20, color: card.gold },
  // The Settings tap target: the cog alone in the left gutter, tall enough (44dp) to be a
  // comfortable target although the glyph is 20dp.
  captionTap: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  captionTapPressed: { opacity: 0.55 },
  // The affordance. Gold (the wordmark's accent) against the sage caption, and a size up from
  // the 9.5px caps, so the row announces itself as a control instead of a label.
  captionMenuGlyph: { fontSize: 12, color: card.gold },
  captionText: {
    flex: 1,
    textAlign: 'center',
    flexShrink: 1,
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
