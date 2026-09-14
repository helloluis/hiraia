import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Language } from '@hiraia/shared';
import type { CardChoice } from '../data/cards';
import { card, fonts } from '../theme';
import { SlideCard } from '../components/onboarding/SlideCard';
import { QuestionPage } from '../components/cards/QuestionPage';
import { cardFrame, CardPrint, IndexBand } from '../components/cards/CardFrame';
import {
  useReviewStore,
  shownReview,
  selectReviewOption,
  continueReview,
  leaveReview,
  retryReviewSave,
  hideReviewError,
  type CompletedReviewAttempt,
} from './store';
import { seriesScore } from './logic';
const copy = {
  english: {
    quick: 'Quick review',
    topic: 'Topic recap',
    done: 'Review complete',
    next: 'Continue learning',
    retry: 'Retry',
    loading: 'Preparing your review…',
    correct: 'correct',
    close: 'Back to cards',
    first: 'First attempts',
    repeat: 'Repeat attempts',
  },
  tagalog: {
    quick: 'Maikling pagbabalik-aral',
    topic: 'Balik-aral sa paksa',
    done: 'Tapos na ang balik-aral',
    next: 'Magpatuloy sa pag-aaral',
    retry: 'Subukan muli',
    loading: 'Inihahanda ang balik-aral…',
    correct: 'tama',
    close: 'Bumalik sa mga card',
    first: 'Unang pagsubok',
    repeat: 'Mga muling pagsubok',
  },
  cebuano: {
    quick: 'Mubo nga pagrepaso',
    topic: 'Pagrepaso sa hilisgutan',
    done: 'Nahuman ang pagrepaso',
    next: 'Padayon sa pagkat-on',
    retry: 'Sulayi pag-usab',
    loading: 'Giandam ang pagrepaso…',
    correct: 'sakto',
    close: 'Balik sa mga card',
    first: 'Unang pagsulay',
    repeat: 'Gisubli nga pagsulay',
  },
};
export function ReviewSeries({
  language,
  onExit,
  onGraded,
}: {
  language: Language;
  onExit: (choice: CardChoice | null) => void;
  onGraded: (result: CompletedReviewAttempt) => void;
}) {
  const s = useReviewStore();
  const t = copy[language];
  const series = s.data?.queue[0];
  const a = series?.items[series.position];
  useEffect(() => {
    if (s.open && a) shownReview();
  }, [s.open, a?.id]);
  if (!s.open && !s.busy && !s.error) return null;
  const button = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" disabled={s.busy} onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
  return (
    <SafeAreaView style={styles.screen}>
      <SlideCard backgroundColor={a ? card.teal : card.stock}>
        {s.error ? (
          <View style={styles.message}>
            <Text accessibilityRole="alert" style={styles.body}>
              {s.error}
            </Text>
            {button(t.retry, () => void retryReviewSave())}
            {button(t.close, hideReviewError)}
          </View>
        ) : s.open && a ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
            <QuestionPage
              key={a.id}
              question={a.question}
              language={language}
              reviewTitle={`${series.kind === 'topic' ? t.topic : t.quick}${series.title ? ` · ${series.title}` : ''}`}
              // One-question series needs no counter, and "Tanong 1 sa 1" reads as nonsense. For a real
              // series the counter stays "Quiz n/total" in every language: the words translate badly and
              // the numerals carry the meaning on their own.
              reviewProgress={
                series.items.length > 1 ? `Quiz ${series.position + 1}/${series.items.length}` : undefined
              }
              displayOrder={a.order}
              selectedOption={a.selected}
              disabled={s.busy}
              onSelect={(i) => void selectReviewOption(i, onGraded)}
              onAnswer={() => {}}
              onContinue={() => void continueReview(onExit)}
            />
          </ScrollView>
        ) : s.open && series ? (
          <View style={cardFrame.content}>
            <CardPrint keyline="gold" />
            <IndexBand label={t.done} tone="gold" stamp={null} />
            <View style={styles.message}>
              <Text style={styles.score}>
                {seriesScore(series)} / {series.items.length}
              </Text>
              <Text style={styles.body}>{t.correct}</Text>
              {[false, true].map((repeated) => {
                const items = series.items.filter((item) => item.attemptNumber > 1 === repeated);
                if (!items.length) return null;
                const correct = items.filter(
                  (item) => item.selected !== null && item.order[item.selected] === item.question.a
                ).length;
                return (
                  <Text key={String(repeated)} style={styles.body}>
                    {repeated ? t.repeat : t.first}: {correct} / {items.length}
                  </Text>
                );
              })}
              {button(t.next, () => void leaveReview(false, onExit))}
            </View>
          </View>
        ) : (
          <View style={styles.message}>
            <Text style={styles.body}>{t.loading}</Text>
          </View>
        )}
      </SlideCard>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, zIndex: 200, backgroundColor: card.board },
  body: { fontFamily: fonts.cardBody, fontSize: 19, color: card.ink, textAlign: 'center' },
  score: { fontFamily: fonts.slab, fontSize: 42, color: card.ink },
  message: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, gap: 18 },
  button: {
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 11,
    minHeight: 48,
    padding: 12,
    backgroundColor: card.gold,
    alignItems: 'center',
  },
  buttonText: { fontFamily: fonts.cardBodyBold, fontSize: 17, color: card.ink },
});
