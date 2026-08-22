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
 * Navigation: tap a choice ticket, or swipe UP from the bottom-left / bottom-right corner.
 * Every 4-5 pages the flip is intercepted by a single MCQ about a recently-read fact.
 *
 * ROBUSTNESS: the incoming page never carries a transform (always visible + tappable),
 * the outgoing (peeling) page always animates fully off-screen, and a safety timer clears
 * it even if the animation callback is dropped — so a transition can never strand a layer
 * over the screen (the earlier hang).
 */
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
    void hydrate();
    // Background, non-blocking: warm the model while the kid reads, so reward text can be
    // generated ahead of time. The feed itself never waits on it.
    warmModel();
  }, [hydrate, warmModel]);

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
  // The card rect, measured off the deck. The peel pivots on the CARD's bottom corner, not
  // the screen's, now that the card is inset from the board.
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
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
    lastSnap.current = {
      pageKey,
      fact: current,
      choices,
      question,
      reward,
      response,
      side: sideRef.current,
    };
  }, [pageKey, current, choices, question, reward, response, flip]);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    []
  );

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

  // Peel transform: card hinges up from the swiped bottom corner, slides off the top.
  // 2D (no 3D perspective → no foreshorten/recede), corner-anchored via a translate
  // sandwich, with a small tilt so it reads as peeling from that corner.
  const side = outgoing?.side ?? 'right';
  const cardW = pageSize.w || width; // fall back to the screen until the deck has measured
  const cx = side === 'left' ? -cardW / 2 : cardW / 2; // pivot = bottom-left / bottom-right corner
  const cy = pageSize.h / 2;
  const lift = flip.interpolate({ inputRange: [0, 1], outputRange: [0, -(pageSize.h * 1.12)] });
  const tilt = flip.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', side === 'left' ? '10deg' : '-10deg'],
  });
  const drift = flip.interpolate({
    inputRange: [0, 1],
    outputRange: [0, side === 'left' ? cardW * 0.12 : -cardW * 0.12],
  });
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

      {/* the deck: board behind, card on top. `pad` clips the peel to the board area;
          `deck` deliberately does NOT clip, so the fanned branch cards can lean past the
          card edge the way they do in the mockup. */}
      <View style={styles.pad} {...pan.panHandlers}>
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
              Android honours only `elevation`, which can't be offset downward. */}
          <View style={styles.cardLedge} pointerEvents="none" />

          {/* incoming card — never transformed, so it's always visible + tappable
              (hang-proof). The layer IS the card surface: stock, ink edge, rounded. */}
          <View style={[styles.cardLayer, { backgroundColor: stockFor(question) }]} key={pageKey}>
            {response ? (
              <ResponseCard
                response={response}
                language={language}
                onContinue={continueAfterResponse}
              />
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
            {/* thinking veil while the fallback generation is in flight */}
            {asking ? (
              <View style={styles.thinking} pointerEvents="none">
                <Text style={styles.thinkingText}>{t.cards.thinking}…</Text>
              </View>
            ) : null}
          </View>

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
