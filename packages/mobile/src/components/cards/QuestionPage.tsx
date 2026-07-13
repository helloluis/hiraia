/**
 * Interject page of the question-cards feed: ONE multiple-choice question about a fact
 * the kid read in the last few pages (exact MCQ from the verified quiz bank, keyed by
 * factId). Options shuffle at render (canonical answer index stored). After the reveal,
 * a single blue "ituloy ⤴" note resumes the walk onto the card the kid had chosen.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Language } from '@hiraia/shared';

import { uiStrings } from '../../config/strings';
import { type CardQuestion } from '../../data/cards';
import { localize } from '../../data/quiz';
import { colors, fonts, notebook } from '../../theme';

const GUTTER_LEFT = notebook.marginX + 14; // stay right of the red margin rule

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

interface QuestionPageProps {
  question: CardQuestion;
  language: Language;
  onAnswer: (correct: boolean) => void;
  onContinue: () => void;
}

export function QuestionPage({ question, language, onAnswer, onContinue }: QuestionPageProps) {
  const t = uiStrings(language);
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const order = useMemo(() => shuffled(question.o.length), [question.f, question.o.length]);
  const [selected, setSelected] = useState<number | null>(null);
  const revealed = selected !== null;
  const correctDisplay = order.indexOf(question.a);
  const gotIt = revealed && selected === correctDisplay;

  const pickOption = (displayIdx: number) => {
    if (revealed) return;
    setSelected(displayIdx);
    onAnswer(displayIdx === correctDisplay);
  };

  return (
    <View style={[styles.page, { paddingBottom: 78 + bottomPad }]}>
      <Text style={styles.header}>{t.cards.questionHeader}</Text>
      <Text style={styles.question}>{localize(question.q, language)}</Text>

      {order.map((optIdx, displayIdx) => {
        const isCorrect = displayIdx === correctDisplay;
        const isChosen = displayIdx === selected;
        let mark = '';
        const extra: StyleProp<ViewStyle>[] = [];
        if (!revealed) {
          extra.push(styles.option);
        } else if (isCorrect) {
          mark = '✓';
          extra.push(styles.optionCorrect);
        } else if (isChosen) {
          mark = '✗';
          extra.push(styles.optionWrong);
        } else {
          extra.push(styles.optionDim);
        }
        return (
          <Pressable
            key={displayIdx}
            style={[styles.optionBase, ...extra]}
            onPress={() => pickOption(displayIdx)}
            disabled={revealed}
          >
            <Text style={styles.optionText}>{localize(question.o[optIdx], language)}</Text>
            {!!mark && (
              <Text style={[styles.mark, mark === '✓' ? styles.markCorrect : styles.markWrong]}>{mark}</Text>
            )}
          </Pressable>
        );
      })}

      {revealed && (
        <View style={styles.reveal}>
          {gotIt && <Text style={styles.correctLine}>{t.quiz.correct}</Text>}
          <Text style={styles.explanation}>{localize(question.e, language)}</Text>
        </View>
      )}

      {revealed && (
        <Pressable onPress={onContinue} hitSlop={20} style={[styles.continueNote, { bottom: 14 + bottomPad }]}>
          <Text style={styles.continueText}>
            {t.cards.continueNote} <Text style={styles.continueArrow}>⤴</Text>
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    paddingLeft: GUTTER_LEFT, // stay right of the red margin rule
    paddingRight: 26,
    paddingTop: 10,
    // paddingBottom applied inline (78 + bottom safe-area inset) to clear the nav bar.
  },
  header: {
    fontFamily: fonts.marker,
    fontSize: 24,
    color: colors.inkBlue,
    marginBottom: 10,
    transform: [{ rotate: '-1.5deg' }],
  },
  question: {
    fontFamily: fonts.body,
    fontSize: 20,
    lineHeight: 29,
    color: colors.ink,
    marginBottom: 16,
  },
  optionBase: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  option: {
    backgroundColor: colors.white,
    borderColor: colors.hairline,
  },
  optionCorrect: {
    backgroundColor: '#e7f6ec',
    borderColor: '#1a7d4b',
  },
  optionWrong: {
    backgroundColor: '#fdecea',
    borderColor: '#c0392b',
  },
  optionDim: {
    backgroundColor: colors.white,
    borderColor: colors.hairline,
    opacity: 0.45,
  },
  optionText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 23,
    color: colors.ink,
  },
  mark: { fontSize: 19, marginLeft: 8, fontWeight: '700' },
  markCorrect: { color: '#1a7d4b' },
  markWrong: { color: '#c0392b' },
  reveal: { marginTop: 4 },
  correctLine: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: '#1a7d4b',
    marginBottom: 4,
  },
  explanation: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.inkMuted,
  },
  continueNote: {
    position: 'absolute',
    right: 24,
    bottom: 18,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.inkBlue,
    paddingBottom: 1,
    transform: [{ rotate: '1.5deg' }],
  },
  continueText: {
    fontFamily: fonts.display,
    fontSize: 23,
    color: colors.inkBlue,
  },
  continueArrow: { fontSize: 16 },
});
