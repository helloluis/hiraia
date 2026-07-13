/**
 * The question-cards feed — the app's home screen on this branch. A notebook pad on
 * lined paper: one fact per page, blank-page + typewriter entry, and a page that PEELS
 * UP FROM THE SWIPED CORNER (left choice/corner → peels from the bottom-left; right →
 * bottom-right), revealing the next page beneath.
 *
 * Navigation: tap a blue choice, or swipe UP from the bottom-left / bottom-right corner.
 * Every 4-5 pages the flip is intercepted by a single MCQ about a recently-read fact.
 *
 * ROBUSTNESS: the incoming page never carries a transform (always visible + tappable),
 * the outgoing (peeling) page always animates fully off-screen, and a safety timer clears
 * it even if the animation callback is dropped — so a transition can never strand a layer
 * over the screen (the earlier hang).
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { uiStrings } from '../../config/strings';
import type { CardChoice, CardFact, CardQuestion } from '../../data/cards';
import { useCardStore } from '../../store/cardStore';
import { useEngineStore } from '../../store/engineStore';
import { colors, fonts } from '../../theme';
import { NotebookBackground } from '../NotebookBackground';
import { CardPage } from './CardPage';
import { QuestionPage } from './QuestionPage';

const FLIP_MS = 380;

type Side = 'left' | 'right';

/** What was on the pad for the page being peeled away. */
interface PageSnap {
  pageKey: number;
  fact: CardFact | null;
  choices: CardChoice[];
  question: CardQuestion | null;
  side: Side;
}

export function CardFeedScreen() {
  const language = useEngineStore((s) => s.language) ?? 'tagalog';
  const t = uiStrings(language);
  const { width } = useWindowDimensions();

  const hydrated = useCardStore((s) => s.hydrated);
  const hydrate = useCardStore((s) => s.hydrate);
  const current = useCardStore((s) => s.current);
  const choices = useCardStore((s) => s.choices);
  const question = useCardStore((s) => s.question);
  const pageKey = useCardStore((s) => s.pageKey);
  const pagesRead = useCardStore((s) => s.pagesRead);
  const correctCount = useCardStore((s) => s.correctCount);
  const choose = useCardStore((s) => s.choose);
  const answerQuestion = useCardStore((s) => s.answerQuestion);
  const continueAfterQuestion = useCardStore((s) => s.continueAfterQuestion);
  const jumpToRandom = useCardStore((s) => s.jumpToRandom);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Which corner the last navigation came from (drives the peel origin). Tapping the
  // left choice / swiping the left corner → 'left'; right → 'right'.
  const sideRef = useRef<Side>('right');
  const chooseFrom = (choice: CardChoice, side: Side) => {
    sideRef.current = side;
    choose(choice);
  };

  // ---- page-peel transition ----
  const [outgoing, setOutgoing] = useState<PageSnap | null>(null);
  const flip = useRef(new Animated.Value(0)).current;
  const [pageH, setPageH] = useState(0);
  const lastSnap = useRef<PageSnap | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = lastSnap.current;
    if (prev && prev.pageKey !== pageKey) {
      setOutgoing({ ...prev, side: sideRef.current });
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
    lastSnap.current = { pageKey, fact: current, choices, question, side: sideRef.current };
  }, [pageKey, current, choices, question, flip]);

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  // ---- corner-swipe-up = tap the corresponding choice ----
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        g.dy < -14 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
      onPanResponderRelease: (_e, g) => {
        if (g.dy > -55) return;
        const s = useCardStore.getState();
        if (s.question) {
          // A swipe-up anywhere is a fallback for the continue note (also nav-bar-safe),
          // but only once the question has actually been answered.
          if (s.questionAnswered) {
            sideRef.current = 'right';
            s.continueAfterQuestion();
          }
          return;
        }
        if (g.x0 < width * 0.4 && s.choices[0]) chooseFrom(s.choices[0], 'left');
        else if (g.x0 > width * 0.6 && s.choices[1]) chooseFrom(s.choices[1], 'right');
      },
    })
  ).current;

  // Peel transform: page hinges up from the swiped bottom corner, slides off the top.
  // 2D (no 3D perspective → no foreshorten/recede), corner-anchored via a translate
  // sandwich, with a small tilt so it reads as peeling from that corner.
  const side = outgoing?.side ?? 'right';
  const cx = side === 'left' ? -width / 2 : width / 2; // pivot = bottom-left / bottom-right corner
  const cy = pageH / 2;
  const lift = flip.interpolate({ inputRange: [0, 1], outputRange: [0, -(pageH * 1.12)] });
  const tilt = flip.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', side === 'left' ? '10deg' : '-10deg'],
  });
  const drift = flip.interpolate({
    inputRange: [0, 1],
    outputRange: [0, side === 'left' ? width * 0.12 : -width * 0.12],
  });
  const shadeOpacity = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.22, 0] });

  if (!hydrated || !current) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loading}>
          <NotebookBackground />
          <Text style={styles.loadingText}>…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* counters + spine */}
      <View style={styles.header}>
        <Text style={styles.pageCount}>
          {t.cards.readLabel} {pagesRead}
        </Text>
        <View style={styles.holes}>
          {Array.from({ length: 5 }, (_, i) => (
            <View key={i} style={styles.hole} />
          ))}
        </View>
        <View style={styles.headerRight}>
          {/* "Reroll" — jump to an unrelated fresh topic. Placeholder trigger; a
              shake gesture (expo-sensors) is the intended trigger, TBD. */}
          <Pressable
            onPress={() => {
              sideRef.current = Math.random() < 0.5 ? 'left' : 'right';
              jumpToRandom();
            }}
            hitSlop={12}
            style={styles.reroll}
          >
            <Text style={styles.rerollIcon}>🎲</Text>
          </Pressable>
          <Text style={styles.score}>✓ {correctCount}</Text>
        </View>
      </View>

      {/* the pad */}
      <View
        style={styles.pad}
        onLayout={(e) => setPageH(e.nativeEvent.layout.height)}
        {...pan.panHandlers}
      >
        {/* incoming page — lined paper, blank content that types itself in. NEVER
            transformed, so it's always visible + tappable (hang-proof). */}
        <View style={styles.pageLayer} key={pageKey}>
          <NotebookBackground />
          {question ? (
            <QuestionPage
              question={question}
              language={language}
              onAnswer={answerQuestion}
              onContinue={continueAfterQuestion}
            />
          ) : (
            <CardPage
              fact={current}
              choices={choices}
              language={language}
              onChoose={(c) => chooseFrom(c, choices[0] === c ? 'left' : 'right')}
            />
          )}
        </View>

        {/* outgoing page peeling up from the swiped corner */}
        {outgoing && pageH > 0 && (
          <Animated.View
            style={[
              styles.pageLayer,
              styles.outgoing,
              {
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
            <NotebookBackground />
            {outgoing.fact && !outgoing.question ? (
              <CardPage
                fact={outgoing.fact}
                choices={outgoing.choices}
                language={language}
                onChoose={() => undefined}
                instant
              />
            ) : null}
            <Animated.View style={[StyleSheet.absoluteFill, styles.shade, { opacity: shadeOpacity }]} />
          </Animated.View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontFamily: fonts.display, fontSize: 30, color: colors.inkMuted },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 6,
    paddingBottom: 4,
  },
  holes: { flexDirection: 'row', gap: 16 },
  hole: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(12,52,61,0.25)',
    backgroundColor: colors.white,
  },
  pageCount: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.inkMuted,
    minWidth: 72,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 72,
    justifyContent: 'flex-end',
  },
  reroll: { padding: 2 },
  rerollIcon: { fontSize: 20 },
  score: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.inkBlue,
  },
  pad: {
    flex: 1,
    borderTopWidth: 2,
    borderTopColor: 'rgba(12,52,61,0.18)', // the spine
    overflow: 'hidden',
  },
  pageLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.paper,
  },
  outgoing: {
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  shade: {
    backgroundColor: '#000',
  },
});
