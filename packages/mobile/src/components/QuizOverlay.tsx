/**
 * Quiz-mode overlay — a full-screen "yellow legal pad" takeover that runs the
 * app-orchestrated practice quiz (see docs/QUIZ-MODE.md). The on-device LLM is NOT
 * in this loop: every question/option/explanation is pre-verified bank data
 * (data/quiz.ts) rendered deterministically. Game state lives in quizStore; this is
 * pure presentation.
 *
 * Flow: topic prompt → 5 cards (15s timer, render-shuffled options, reveal +
 * celebration) → score. On exit the round is materialized back into the chat thread
 * (quizStore.exit → chatStore.addQuizRecap).
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { uiStrings } from '../config/strings';
import { localize, TOPICS } from '../data/quiz';
import { SECONDS_PER_QUESTION, useQuizStore } from '../store/quizStore';
import { useEngineStore } from '../store/engineStore';
import { colors, fonts } from '../theme';

// Legal-pad palette (kept local — these only exist inside quiz mode).
const PAD = '#fdf6c9'; // warm yellow paper
const PAD_MARGIN = 'rgba(214, 92, 92, 0.5)'; // red margin rule
const CARD = '#fffdf2'; // option/card fill, a touch lighter than the pad
const CORRECT = '#1a7d4b';
const WRONG = '#c0392b';

/** Top-N biggest topics shown as tap-to-start suggestion chips. */
const SUGGESTED = TOPICS.slice(0, 10);

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export function QuizOverlay() {
  const phase = useQuizStore((s) => s.phase);

  return (
    <View style={[styles.fill, styles.pad]}>
      <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
        {/* faint ruled-paper feel: a single red margin rule down the left */}
        <View style={styles.marginRule} pointerEvents="none" />
        {phase === 'topic' && <TopicView />}
        {phase === 'playing' && <PlayView />}
        {phase === 'result' && <ResultView />}
      </SafeAreaView>
    </View>
  );
}

function ExitButton() {
  const exit = useQuizStore((s) => s.exit);
  return (
    <TouchableOpacity style={styles.exitButton} onPress={() => void exit()} hitSlop={12}>
      <Text style={styles.exitIcon}>✕</Text>
    </TouchableOpacity>
  );
}

function TopicView() {
  const lang = useEngineStore((s) => s.language) ?? 'tagalog';
  const Q = uiStrings(lang).quiz;
  const submitTopic = useQuizStore((s) => s.submitTopic);
  const unsupported = useQuizStore((s) => s.unsupported);
  const clearUnsupported = useQuizStore((s) => s.clearUnsupported);
  const [text, setText] = useState('');

  const go = (value: string) => {
    const v = value.trim();
    if (!v) return;
    submitTopic(v);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.fill}
    >
      <View style={styles.header}>
        <Text style={styles.brand}>{Q.button}</Text>
        <ExitButton />
      </View>
      <ScrollView contentContainerStyle={styles.topicBody} keyboardShouldPersistTaps="handled">
        <Text style={styles.topicPrompt}>{Q.topicPrompt}</Text>

        {unsupported && (
          <View style={styles.unsupported}>
            <Text style={styles.unsupportedText}>{Q.unsupported}</Text>
          </View>
        )}

        <View style={styles.topicInputRow}>
          <TextInput
            style={styles.topicInput}
            value={text}
            onChangeText={(t) => {
              setText(t);
              if (unsupported) clearUnsupported();
            }}
            placeholder={Q.topicPlaceholder}
            placeholderTextColor={colors.inkMuted}
            returnKeyType="go"
            onSubmitEditing={() => go(text)}
            autoFocus
          />
          <TouchableOpacity
            style={[styles.startButton, !text.trim() && styles.startButtonDisabled]}
            onPress={() => go(text)}
            disabled={!text.trim()}
          >
            <Text style={styles.startButtonText}>{Q.start}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.tryLabel}>{Q.tryLabel}</Text>
        <View style={styles.chips}>
          {SUGGESTED.map((t) => (
            <TouchableOpacity key={t.topic} style={styles.chip} onPress={() => go(t.topic)}>
              <Text style={styles.chipText}>{t.topic}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PlayView() {
  const lang = useEngineStore((s) => s.language) ?? 'tagalog';
  const Q = uiStrings(lang).quiz;

  const questions = useQuizStore((s) => s.questions);
  const index = useQuizStore((s) => s.index);
  const order = useQuizStore((s) => s.order);
  const selected = useQuizStore((s) => s.selected);
  const revealed = useQuizStore((s) => s.revealed);
  const selectOption = useQuizStore((s) => s.selectOption);
  const next = useQuizStore((s) => s.next);

  const q = questions[index];

  // Per-question countdown. Resets on each new question; freezes once answered/revealed.
  // When it hits zero unanswered, that's a miss → selectOption(null) reveals the answer.
  const [secs, setSecs] = useState(SECONDS_PER_QUESTION);
  useEffect(() => {
    setSecs(SECONDS_PER_QUESTION);
  }, [index]);
  useEffect(() => {
    if (revealed) return;
    if (secs <= 0) {
      selectOption(null);
      return;
    }
    const id = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secs, revealed, index, selectOption]);

  // --- keep the result + NEXT reachable on long (multi-screen) questions ---
  const scrollRef = useRef<ScrollView>(null);
  const atBottomRef = useRef(true); // is NEXT roughly on-screen right now?
  const lastInteractRef = useRef(0); // ms of the kid's last scroll (idle detection)
  const autoScrollPendingRef = useRef(false); // scroll once the reveal block lays out
  const shakeCountRef = useRef(0);
  const shakeX = useRef(new Animated.Value(0)).current;
  const shakeTranslate = shakeX.interpolate({ inputRange: [-1, 1], outputRange: [-7, 7] });

  const runShake = () => {
    shakeX.setValue(0);
    Animated.sequence(
      [1, -1, 1, -1, 0].map((toValue) =>
        Animated.timing(shakeX, { toValue, duration: 55, useNativeDriver: true })
      )
    ).start();
  };

  // new question → snap to top + clear nudge state
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    atBottomRef.current = true;
    autoScrollPendingRef.current = false;
    shakeCountRef.current = 0;
  }, [index]);

  // once answered/revealed → pull the result + NEXT into view, then nudge if the kid idles
  useEffect(() => {
    if (!revealed) return;
    autoScrollPendingRef.current = true; // onContentSizeChange scrolls once the reveal lays out
    scrollRef.current?.scrollToEnd({ animated: true }); // immediate best-effort too
    lastInteractRef.current = Date.now();
    shakeCountRef.current = 0;
    const id = setInterval(() => {
      const idle = Date.now() - lastInteractRef.current;
      const due = Math.floor(idle / 5000); // shake NEXT every 5s of inactivity
      if (due > shakeCountRef.current) {
        shakeCountRef.current = due;
        runShake();
      }
      if (idle >= 15000 && !atBottomRef.current) {
        // sat >15s scrolled away (re-reading the question) → bring NEXT back
        scrollRef.current?.scrollToEnd({ animated: true });
        lastInteractRef.current = Date.now();
        shakeCountRef.current = 0;
      }
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, index]);

  if (!q) return null;

  const correctDisplay = order.indexOf(q.a);
  const isLast = index >= questions.length - 1;
  const timedOut = revealed && selected === null;
  const gotItRight = revealed && selected === correctDisplay;
  const pct = Math.max(0, Math.min(1, secs / SECONDS_PER_QUESTION));

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <Text style={styles.progress}>
          {fill(Q.progress, { n: index + 1, total: questions.length })}
        </Text>
        <ExitButton />
      </View>

      {/* timer bar */}
      <View style={styles.timerTrack}>
        <View
          style={[
            styles.timerFill,
            { width: `${pct * 100}%`, backgroundColor: secs <= 5 ? WRONG : colors.primary },
          ]}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.playBody}
        scrollEventThrottle={100}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          atBottomRef.current =
            contentSize.height - contentOffset.y - layoutMeasurement.height <= 40;
          lastInteractRef.current = Date.now();
        }}
        onContentSizeChange={() => {
          if (revealed && autoScrollPendingRef.current) {
            autoScrollPendingRef.current = false;
            scrollRef.current?.scrollToEnd({ animated: true });
          }
        }}
      >
        <Text style={styles.questionText}>{localize(q.q, lang)}</Text>

        {order.map((optIdx, displayIdx) => {
          const isCorrectOpt = displayIdx === correctDisplay;
          const isChosen = selected === displayIdx;
          const optStyles: StyleProp<ViewStyle>[] = [styles.optionBase];
          let mark: { glyph: string; style: StyleProp<TextStyle> } | null = null;
          if (!revealed) {
            optStyles.push(styles.option);
          } else if (isCorrectOpt) {
            optStyles.push(styles.optionCorrect);
            mark = { glyph: '✓', style: styles.optionMarkCorrect };
          } else if (isChosen) {
            optStyles.push(styles.optionWrong);
            mark = { glyph: '✗', style: styles.optionMarkWrong };
          } else {
            optStyles.push(styles.optionDimmed);
          }
          return (
            <TouchableOpacity
              key={displayIdx}
              style={optStyles}
              onPress={() => selectOption(displayIdx)}
              disabled={revealed}
              activeOpacity={0.85}
            >
              <Text style={styles.optionText}>{localize(q.o[optIdx], lang)}</Text>
              {mark && <Text style={mark.style}>{mark.glyph}</Text>}
            </TouchableOpacity>
          );
        })}

        {revealed && (
          <View style={styles.reveal}>
            {timedOut && <Text style={styles.timeUp}>{Q.timeUp}</Text>}
            {gotItRight && <Text style={styles.correctHeadline}>{Q.correct}</Text>}
            <Text style={styles.explanation}>{localize(q.e, lang)}</Text>
            <Animated.View style={[styles.nextWrap, { transform: [{ translateX: shakeTranslate }] }]}>
              <TouchableOpacity style={styles.nextButton} onPress={next}>
                <Text style={styles.nextButtonText}>{isLast ? Q.finish : Q.next}</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}
      </ScrollView>

      {gotItRight && <CorrectBurst key={index} />}
    </View>
  );
}

/** Brief celebratory emoji pop on a correct answer. pointerEvents=none so Next stays tappable. */
function CorrectBurst() {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 80, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 700, delay: 500, useNativeDriver: true }),
    ]).start();
  }, [scale, opacity]);
  return (
    <Animated.View
      style={[styles.burst, { opacity, transform: [{ scale }] }]}
      pointerEvents="none"
    >
      <Text style={styles.burstEmoji}>🎉</Text>
    </Animated.View>
  );
}

function ResultView() {
  const lang = useEngineStore((s) => s.language) ?? 'tagalog';
  const Q = uiStrings(lang).quiz;
  const correctCount = useQuizStore((s) => s.correctCount);
  const total = useQuizStore((s) => s.questions.length);
  const restart = useQuizStore((s) => s.restart);
  const exit = useQuizStore((s) => s.exit);

  const ratio = total > 0 ? correctCount / total : 0;
  const praise = ratio >= 0.8 ? Q.praiseHigh : ratio >= 0.4 ? Q.praiseMid : Q.praiseLow;

  return (
    <View style={styles.resultBody}>
      <Text style={styles.resultTitle}>{Q.resultTitle}</Text>
      <Text style={styles.resultScore}>{fill(Q.score, { score: correctCount, total })}</Text>
      <Text style={styles.resultPraise}>{praise}</Text>

      <TouchableOpacity style={styles.againButton} onPress={restart}>
        <Text style={styles.againButtonText}>{Q.playAgain}</Text>
      </TouchableOpacity>
      <Pressable style={styles.endButton} onPress={() => void exit()}>
        <Text style={styles.endButtonText}>{Q.end}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { backgroundColor: PAD },
  marginRule: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 34,
    width: 2,
    backgroundColor: PAD_MARGIN,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingLeft: 48,
    paddingVertical: 12,
  },
  brand: {
    fontFamily: fonts.title,
    fontSize: 28,
    color: colors.primary,
    letterSpacing: 1,
  },
  progress: {
    fontFamily: fonts.body,
    fontSize: 18,
    color: colors.inkMuted,
  },
  exitButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12,52,61,0.06)',
  },
  exitIcon: {
    fontSize: 18,
    color: colors.ink,
  },

  // topic phase
  topicBody: {
    paddingHorizontal: 24,
    paddingLeft: 52,
    paddingTop: 12,
    paddingBottom: 40,
  },
  topicPrompt: {
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 38,
    color: colors.ink,
    marginBottom: 20,
  },
  unsupported: {
    backgroundColor: '#fdeaea',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(192,57,43,0.3)',
    padding: 12,
    marginBottom: 16,
  },
  unsupportedText: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: WRONG,
  },
  topicInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 24,
  },
  topicInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 18,
    color: colors.ink,
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  startButton: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  startButtonDisabled: {
    backgroundColor: colors.hairline,
  },
  startButtonText: {
    fontFamily: fonts.body,
    fontSize: 18,
    color: colors.white,
  },
  tryLabel: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.inkMuted,
    marginBottom: 10,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.primary,
  },

  // play phase
  timerTrack: {
    height: 8,
    marginHorizontal: 20,
    marginLeft: 48,
    borderRadius: 4,
    backgroundColor: 'rgba(12,52,61,0.08)',
    overflow: 'hidden',
  },
  timerFill: {
    height: '100%',
    borderRadius: 4,
  },
  playBody: {
    paddingHorizontal: 20,
    paddingLeft: 48,
    paddingTop: 18,
    paddingBottom: 40,
  },
  questionText: {
    fontFamily: fonts.display,
    fontSize: 27,
    lineHeight: 34,
    color: colors.ink,
    marginBottom: 22,
  },
  optionBase: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
  },
  option: {
    backgroundColor: CARD,
    borderColor: colors.hairline,
  },
  optionCorrect: {
    backgroundColor: '#e7f6ec',
    borderColor: CORRECT,
  },
  optionWrong: {
    backgroundColor: '#fdecea',
    borderColor: WRONG,
  },
  optionDimmed: {
    backgroundColor: CARD,
    borderColor: colors.hairline,
    opacity: 0.5,
  },
  optionText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 19,
    color: colors.ink,
  },
  optionMarkCorrect: { fontSize: 22, marginLeft: 10, color: CORRECT, fontWeight: '700' },
  optionMarkWrong: { fontSize: 22, marginLeft: 10, color: WRONG, fontWeight: '700' },

  reveal: {
    marginTop: 8,
  },
  timeUp: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: WRONG,
    marginBottom: 6,
  },
  correctHeadline: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: CORRECT,
    marginBottom: 6,
  },
  explanation: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 24,
    color: colors.inkMuted,
    marginBottom: 18,
  },
  nextWrap: {
    alignSelf: 'flex-start',
  },
  nextButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 18,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  nextButtonText: {
    fontFamily: fonts.body,
    fontSize: 19,
    color: colors.white,
  },
  burst: {
    position: 'absolute',
    top: 90,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  burstEmoji: {
    fontSize: 96,
  },

  // result phase
  resultBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  resultTitle: {
    fontFamily: fonts.display,
    fontSize: 38,
    color: colors.ink,
    marginBottom: 8,
  },
  resultScore: {
    fontFamily: fonts.title,
    fontSize: 30,
    color: colors.primary,
    marginBottom: 8,
  },
  resultPraise: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.inkMuted,
    marginBottom: 40,
    textAlign: 'center',
  },
  againButton: {
    backgroundColor: colors.primary,
    borderRadius: 22,
    paddingHorizontal: 44,
    paddingVertical: 16,
    marginBottom: 14,
  },
  againButtonText: {
    fontFamily: fonts.body,
    fontSize: 20,
    color: colors.white,
  },
  endButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  endButtonText: {
    fontFamily: fonts.body,
    fontSize: 18,
    color: colors.inkMuted,
  },
});
