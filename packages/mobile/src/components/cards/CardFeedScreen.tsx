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
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { uiStrings } from '../../config/strings';
import type { CardChoice, CardFact, CardQuestion } from '../../data/cards';
import { useCardStore, type FeedResponse } from '../../store/cardStore';
import { useEngineStore } from '../../store/engineStore';
import { colors, fonts } from '../../theme';
import { NotebookBackground } from '../NotebookBackground';
import type { RewardContent } from '../../data/reward';
import { CardPage } from './CardPage';
import { QuestionPage } from './QuestionPage';
import { ResponseCard } from './ResponseCard';
import { RewardCard } from './RewardCard';

const FLIP_MS = 380;

type Side = 'left' | 'right';

/** What was on the pad for the page being peeled away. */
interface PageSnap {
  pageKey: number;
  fact: CardFact | null;
  choices: CardChoice[];
  question: CardQuestion | null;
  reward: RewardContent | null;
  response: FeedResponse | null;
  side: Side;
}

export function CardFeedScreen() {
  const router = useRouter();
  const language = useEngineStore((s) => s.language) ?? 'tagalog';
  const onboardingActive = useEngineStore((s) => s.onboardingActive);
  const t = uiStrings(language);
  const { width } = useWindowDimensions();

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
  const choose = useCardStore((s) => s.choose);
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
    // Background, non-blocking: warm the model while the kid reads, so reward text can be
    // generated ahead of time. The feed itself never waits on it.
    warmModel();
  }, [hydrate, warmModel, onboardingActive]);

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
    lastSnap.current = { pageKey, fact: current, choices, question, reward, response, side: sideRef.current };
  }, [pageKey, current, choices, question, reward, response, flip]);

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
        if (s.response) {
          sideRef.current = 'right';
          s.continueAfterResponse();
          return;
        }
        if (s.reward) {
          sideRef.current = 'right';
          s.continueAfterReward();
          return;
        }
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
        <View style={styles.headerLeft}>
          {/* Menu / Settings (language, grade, past chats). The feed is the home screen, so
              this is the only way to the sidebar from the pad. */}
          <Pressable onPress={() => router.push('/sidebar')} hitSlop={12} style={styles.menu}>
            <Text style={styles.menuIcon}>☰</Text>
          </Pressable>
          <Text style={styles.pageCount}>
            {t.cards.readLabel} {pagesRead}
          </Text>
        </View>
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

      {/* persistent "ask anything" box — the kid's agency: type a topic or a question and
          RAG decides (found card → response card → honest abstention). */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          value={queryText}
          onChangeText={setQueryText}
          onSubmitEditing={submitQuery}
          placeholder={t.cards.searchPlaceholder}
          placeholderTextColor={colors.inkMuted}
          returnKeyType="search"
          editable={!asking}
          selectionColor={colors.inkBlue}
        />
        {/* While an answer is being generated the submit button becomes a progress
            circle, so the kid knows the app is working and they should wait. */}
        {asking ? (
          <ActivityIndicator size="small" color={colors.inkBlue} style={styles.searchSpinner} />
        ) : (
          <Pressable onPress={submitQuery} disabled={!queryText.trim()} hitSlop={8}>
            <Text style={[styles.searchSend, !queryText.trim() && styles.searchSendOff]}>
              ➤
            </Text>
          </Pressable>
        )}
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
          {response ? (
            <ResponseCard response={response} language={language} onContinue={continueAfterResponse} />
          ) : reward ? (
            <RewardCard reward={reward} language={language} onContinue={continueAfterReward} />
          ) : question ? (
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
          {/* "you asked" ribbon when a search navigated straight to a found card */}
          {queryBanner && !response && !reward && !question ? (
            <View style={styles.banner} pointerEvents="none">
              <Text style={styles.bannerText} numberOfLines={1}>
                {t.cards.yourQuestion}: “{queryBanner}”
              </Text>
            </View>
          ) : null}
          {/* thinking veil while the fallback generation is in flight */}
          {asking ? (
            <View style={styles.thinking} pointerEvents="none">
              <Text style={styles.thinkingText}>{t.cards.thinking}…</Text>
            </View>
          ) : null}
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
            {outgoing.fact && !outgoing.question && !outgoing.reward && !outgoing.response ? (
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 72,
  },
  menu: { padding: 2 },
  menuIcon: { fontSize: 20, color: colors.ink },
  pageCount: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.inkMuted,
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: 'rgba(12,52,61,0.18)',
  },
  searchIcon: { fontSize: 15, marginRight: 8, opacity: 0.7 },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    padding: 0,
  },
  searchSend: {
    fontSize: 15,
    color: colors.inkBlue,
    marginLeft: 8,
  },
  searchSendOff: { opacity: 0.3 },
  searchSpinner: { marginLeft: 8 },
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(240,246,247,0.92)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(12,52,61,0.12)',
    paddingHorizontal: 20,
    paddingVertical: 6,
  },
  bannerText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.inkBlue,
    fontStyle: 'italic',
  },
  thinking: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(247,244,236,0.72)',
  },
  thinkingText: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.inkMuted,
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
