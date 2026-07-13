/**
 * The question-cards feed — the app's home screen on this branch. A top-spine notebook
 * pad: one fact per page, blank-page + typewriter entry, and a page-FLIP-UP transition
 * (the outgoing page is the live view rotating around the pad's top edge — no snapshot
 * needed because the incoming page starts blank).
 *
 * Navigation: tap a blue choice, or swipe UP from the bottom-left / bottom-right corner
 * region (left corner = left choice, right corner = right choice; the middle is dead so
 * casual scroll-flicks don't advance). Every 4-5 pages the flip is intercepted by a
 * single MCQ about a recently-read fact (see cardStore).
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
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
import { CardPage } from './CardPage';
import { QuestionPage } from './QuestionPage';

const FLIP_MS = 330;

/** What was on the pad for the page being flipped away. */
interface PageSnap {
  pageKey: number;
  fact: CardFact | null;
  choices: CardChoice[];
  question: CardQuestion | null;
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

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // ---- page-flip transition (outgoing page rotates up around the top spine) ----
  const [outgoing, setOutgoing] = useState<PageSnap | null>(null);
  const flip = useRef(new Animated.Value(0)).current;
  const [pageH, setPageH] = useState(0);
  const lastSnap = useRef<PageSnap | null>(null);

  useEffect(() => {
    const prev = lastSnap.current;
    if (prev && prev.pageKey !== pageKey) {
      setOutgoing(prev);
      flip.setValue(0);
      Animated.timing(flip, {
        toValue: 1,
        duration: FLIP_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => setOutgoing(null));
    }
    lastSnap.current = { pageKey, fact: current, choices, question };
  }, [pageKey, current, choices, question, flip]);

  // ---- corner-swipe-up = same as tapping the corresponding choice ----
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_evt, g) =>
        g.dy < -14 && Math.abs(g.dy) > Math.abs(g.dx) * 1.3,
      onPanResponderRelease: (_evt, g) => {
        if (g.dy > -55) return;
        const s = useCardStore.getState();
        if (s.question) return; // question page: answer/continue by tap
        const W = width;
        if (g.x0 < W * 0.38 && s.choices[0]) s.choose(s.choices[0]);
        else if (g.x0 > W * 0.62 && s.choices[1]) s.choose(s.choices[1]);
      },
    })
  ).current;

  const rotateX = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-95deg'] });
  const flipShadow = flip.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.18, 0.05] });

  if (!hydrated || !current) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loading}>
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
        <Text style={styles.score}>✓ {correctCount}</Text>
      </View>

      {/* the pad */}
      <View
        style={styles.pad}
        onLayout={(e) => setPageH(e.nativeEvent.layout.height)}
        {...pan.panHandlers}
      >
        {/* incoming page (starts blank; CardPage typewriters itself in) */}
        <View style={styles.pageLayer} key={pageKey}>
          {question ? (
            <QuestionPage
              question={question}
              language={language}
              onAnswer={answerQuestion}
              onContinue={continueAfterQuestion}
            />
          ) : (
            <CardPage fact={current} choices={choices} language={language} onChoose={choose} />
          )}
        </View>

        {/* outgoing page flipping up around the top edge */}
        {outgoing && pageH > 0 && (
          <Animated.View
            style={[
              styles.pageLayer,
              styles.outgoing,
              {
                transform: [
                  { perspective: 1400 },
                  { translateY: -pageH / 2 },
                  { rotateX },
                  { translateY: pageH / 2 },
                ],
              },
            ]}
            pointerEvents="none"
          >
            {outgoing.fact && !outgoing.question ? (
              <CardPage
                fact={outgoing.fact}
                choices={outgoing.choices}
                language={language}
                onChoose={() => undefined}
                instant
              />
            ) : (
              <View style={styles.blankPaper} />
            )}
            <Animated.View style={[StyleSheet.absoluteFill, styles.flipShade, { opacity: flipShadow }]} />
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
  holes: {
    flexDirection: 'row',
    gap: 16,
  },
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
  score: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.inkBlue,
    minWidth: 72,
    textAlign: 'right',
  },
  pad: {
    flex: 1,
    borderTopWidth: 2,
    borderTopColor: 'rgba(12,52,61,0.18)', // the spine
    backgroundColor: colors.paper,
    overflow: 'hidden',
  },
  pageLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.paper,
  },
  outgoing: {
    backfaceVisibility: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  blankPaper: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  flipShade: {
    backgroundColor: '#000',
  },
});
