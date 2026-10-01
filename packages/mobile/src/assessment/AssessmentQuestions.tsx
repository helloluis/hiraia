import { useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { Language } from '@hiraia/shared';
import { ReaderInput } from '../../modules/hiraia-reader-input/src';
import { Arrow } from '../components/cards/CardFrame';
import { CardSpeaker } from '../components/cards/CardSpeaker';
import { feedViewport } from '../components/cards/adaptiveFeed';
import { useReduceMotion } from '../components/cards/useReduceMotion';
import { useScreenReader } from '../components/cards/useScreenReader';
import { uiStrings } from '../config/strings';
import { card, fonts } from '../theme';
import { AssessmentDiagramView } from './AssessmentDiagramView';
import { assessmentCopy } from './uiCopy';
import type { AssessmentSession } from './types';

/** All twelve questions are independent. Browsing never submits an answer, moves
 * the curriculum, or reveals correctness. Each choice is saved under its item id. */
export function AssessmentQuestions({ session, language, foreground, busy, pending,
  onAnswer, onReadAloud }: {
  session: AssessmentSession;
  language: Language;
  foreground: boolean;
  busy: boolean;
  pending: { itemId: string; optionId: string } | null;
  onAnswer: (itemId: string, optionId: string) => void;
  onReadAloud: (itemId: string) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const screenReader = useScreenReader();
  const reduceMotion = useReduceMotion();
  const viewport = feedViewport(width, fontScale);
  // Linear document order is easier to explore with a screen reader and when
  // zoom leaves too little space for a row. Every question stays available.
  const horizontal = viewport.horizontal && !screenReader;
  const { cardWidth, stride } = viewport;
  const rail = useRef<ScrollView>(null);
  const questions = useRef<(View | null)[]>([]);
  const focusedQuestion = useRef<number | null>(null);
  const offset = useRef(0);
  const previous = useRef({ stride, horizontal });
  const [height, setHeight] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(false);
  const t = assessmentCopy(language);
  const navigation = uiStrings(language).cards;
  const firstUnanswered = Math.max(0, session.items.findIndex(item => !session.answers.some(a => a.itemId === item.id)));
  const initialIndex = useRef(firstUnanswered);
  const positioned = useRef(false);
  const positions = useRef(new Map<number, number>());

  const jump = (index: number, animated = true) => {
    const target = Math.max(0, Math.min(session.items.length - 1, index));
    rail.current?.scrollTo(horizontal
      ? { x: target * stride, animated: animated && !reduceMotion }
      : { y: positions.current.get(target) ?? 0, animated: animated && !reduceMotion });
  };
  useLayoutEffect(() => {
    if (height <= 0) return;
    const index = positioned.current
      ? Math.round(offset.current / previous.current.stride) : initialIndex.current;
    previous.current = { stride, horizontal };
    // Resize/zoom preserves the part being read. Answering never scrolls the row.
    if (horizontal) jump(index, false);
    positioned.current = true;
  }, [stride, horizontal, height]);

  const controls = horizontal && <View style={styles.arrows}>
    <Pressable accessibilityRole="button" accessibilityLabel={navigation.previousCard}
      disabled={start === 0} accessibilityState={{ disabled: start === 0 }}
      onPress={() => jump(start - 1)} style={[styles.arrow, start === 0 && styles.disabled]}>
      <Arrow direction="left" color={card.ink} />
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={navigation.nextCard}
      disabled={end} accessibilityState={{ disabled: end }}
      onPress={() => jump(start + 1)} style={[styles.arrow, end && styles.disabled]}>
      <Arrow direction="right" color={card.ink} />
    </Pressable>
  </View>;

  return <ReaderInput style={styles.root} enabled={horizontal}
    onNavigate={event => {
      const index = Math.max(0, Math.min(11, (focusedQuestion.current ?? start) + event.nativeEvent.direction));
      // Do not leave Enter aimed at an answer that arrows moved off screen.
      // Focus the question shell, so another deliberate Tab/choice is needed.
      jump(index, false);
      questions.current[index]?.focus();
    }}>
    <View style={styles.toolbar}>
      <Text style={styles.instructions}>{t.pick}</Text>
      <Text testID="exam-answer-count" style={styles.count} accessibilityLiveRegion="polite"
        accessibilityLabel={`${t.review}: ${session.answers.length} / 12`}>
        {session.answers.length} / 12 ✓
      </Text>
      {controls}
    </View>
    <View style={styles.root} onLayout={event => setHeight(event.nativeEvent.layout.height)}>
      <ScrollView ref={rail} key={horizontal ? 'row' : 'column'} horizontal={horizontal}
        testID={horizontal ? 'exam-question-carousel' : 'exam-question-list'}
        style={styles.root} contentContainerStyle={horizontal ? styles.row : styles.column}
        keyboardShouldPersistTaps="handled" nestedScrollEnabled directionalLockEnabled
        showsHorizontalScrollIndicator showsVerticalScrollIndicator={!horizontal}
        onScroll={event => {
          if (!horizontal) return;
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          offset.current = contentOffset.x;
          setStart(Math.max(0, Math.round(contentOffset.x / stride)));
          setEnd(contentOffset.x + layoutMeasurement.width >= contentSize.width - 2);
        }} scrollEventThrottle={32}>
        {session.items.map((item, index) => {
          const selected = session.answers.find(answer => answer.itemId === item.id);
          const waiting = pending?.itemId === item.id;
          const disabled = !!selected || !!pending || busy || !foreground;
          const speakerText = `${item.stem}. ${item.options.map((option, number) => `${number + 1}. ${option.text}`).join('. ')}`;
          const content = <>
            <View style={styles.questionHeader}>
              <Text style={styles.counter} accessibilityRole="header">{t.question} {index + 1} / 12</Text>
              {foreground && !pending && !busy && <CardSpeaker text={speakerText} language={language}
                onAudioStart={() => onReadAloud(item.id)} />}
            </View>
            <Text style={styles.question}>{item.stem}</Text>
            {item.diagram && <AssessmentDiagramView diagram={item.diagram} language={session.language} />}
            <View style={styles.options}>
              {item.options.map((option, number) => {
                const chosen = selected?.optionId === option.id || (waiting && pending.optionId === option.id);
                return <Pressable key={option.id} onPress={() => onAnswer(item.id, option.id)}
                  disabled={disabled} accessibilityRole="button"
                  accessibilityLabel={`${number + 1}. ${option.text}`}
                  accessibilityState={{ disabled, selected: chosen }}
                  style={({ pressed }) => [styles.option, (pressed || chosen) && styles.chosen]}>
                  <Text style={styles.optionNumber}>{chosen ? '✓' : number + 1}</Text>
                  <Text style={styles.optionText}>{option.text}</Text>
                </Pressable>;
              })}
            </View>
            {selected && <Text style={styles.saved}>{t.yourAnswer}: {item.options.find(o => o.id === selected.optionId)?.text}</Text>}
            {waiting && <View style={styles.saving} accessibilityLiveRegion="polite">
              <ActivityIndicator color={card.ink} /><Text style={styles.saved}>{t.saving}</Text>
            </View>}
          </>;
          return <View key={item.id} testID={`exam-question-${index + 1}`}
            ref={node => { questions.current[index] = node; }} focusable={horizontal}
            onFocus={() => { focusedQuestion.current = index; }}
            onBlur={() => { focusedQuestion.current = null; }}
            onLayout={event => { positions.current.set(index, event.nativeEvent.layout.y); }}
            style={[styles.paper, horizontal
              ? { width: cardWidth, height: Math.max(1, height - 24), marginRight: index < 11 ? 16 : 0 }
              : styles.verticalPaper]}>
            {horizontal ? <ScrollView style={styles.root} nestedScrollEnabled
              contentContainerStyle={styles.cardContent} keyboardShouldPersistTaps="handled">{content}</ScrollView>
              : <View style={styles.cardContent}>{content}</View>}
          </View>;
        })}
      </ScrollView>
    </View>
  </ReaderInput>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  toolbar: { paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  instructions: { flex: 1, minWidth: 180, fontFamily: fonts.cardBody, fontSize: 15, lineHeight: 21, color: card.stock },
  count: { fontFamily: fonts.cardBodyBold, fontSize: 18, color: card.stock },
  arrows: { flexDirection: 'row', gap: 8 },
  arrow: { minWidth: 48, minHeight: 48, backgroundColor: card.stock, borderWidth: 2, borderColor: card.ink, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.45 },
  row: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 20 },
  column: { padding: 12, paddingBottom: 24, gap: 16, alignItems: 'center' },
  paper: { borderWidth: 3, borderColor: card.ink, borderRadius: 18, backgroundColor: card.stock, overflow: 'hidden' },
  verticalPaper: { width: '100%', maxWidth: 720 },
  cardContent: { padding: 18, gap: 16, flexGrow: 1 },
  questionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'space-between' },
  counter: { flex: 1, fontFamily: fonts.cardBodyBold, fontSize: 17, color: card.olive },
  question: { fontFamily: fonts.cardBodyBold, fontSize: 24, lineHeight: 32, color: card.ink },
  options: { gap: 12, marginTop: 'auto', paddingTop: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, padding: 12, borderRadius: 12, borderWidth: 2, borderColor: card.ink, backgroundColor: card.plate },
  chosen: { backgroundColor: card.gold },
  optionNumber: { minWidth: 18, fontFamily: fonts.cardBodyBold, fontSize: 20, color: card.ink },
  optionText: { flex: 1, fontFamily: fonts.cardBody, fontSize: 18, lineHeight: 25, color: card.ink },
  saved: { fontFamily: fonts.cardBody, fontSize: 15, lineHeight: 21, color: card.olive },
  saving: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
