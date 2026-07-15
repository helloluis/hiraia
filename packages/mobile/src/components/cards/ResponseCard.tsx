/**
 * Response interject page of the question-cards feed — shown when the kid TYPED a query and
 * the local card search found no confident match. Two shapes:
 *   - generated : a short grounded answer from the (background-warmed) model, prefixed with
 *     the kid's question so it reads like a teacher answering them.
 *   - abstain   : an honest "I don't know that yet" (retrieval missed AND the model couldn't
 *     ground / wasn't ready), offering the nearest topic as a soft landing.
 * A confident retrieval HIT never reaches here — it navigates straight to the found card
 * with a small "you asked" banner instead. A blue "ituloy ⤴" note continues the walk.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Language } from '@hiraia/shared';

import { uiStrings } from '../../config/strings';
import type { FeedResponse } from '../../store/cardStore';
import { colors, fonts, notebook } from '../../theme';

const GUTTER_LEFT = notebook.marginX + 14;

export function ResponseCard({
  response,
  language,
  onContinue,
}: {
  response: FeedResponse;
  language: Language;
  onContinue: () => void;
}) {
  const t = uiStrings(language);
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const abstain = response.kind === 'abstain';

  return (
    <View style={[styles.page, { paddingBottom: 78 + bottomPad }]}>
      {/* the kid's question, as a teacher's note */}
      <Text style={styles.qLabel}>{t.cards.yourQuestion}</Text>
      <Text style={styles.query}>“{response.query}”</Text>

      <View style={styles.answerWrap}>
        {abstain ? (
          <>
            <Text style={styles.abstainEmoji}>🤔</Text>
            <Text style={styles.abstain}>{t.cards.abstain}</Text>
            {response.suggestion && (
              <Text style={styles.suggest}>
                {t.cards.abstainSuggest}:{' '}
                <Text style={styles.suggestTopic}>{response.suggestion}</Text>
              </Text>
            )}
          </>
        ) : (
          <Text style={styles.answer}>{response.text}</Text>
        )}
      </View>

      <Pressable onPress={onContinue} hitSlop={20} style={[styles.continueNote, { bottom: 14 + bottomPad }]}>
        <Text style={styles.continueText}>
          {t.cards.continueNote} <Text style={styles.continueArrow}>⤴</Text>
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    paddingLeft: GUTTER_LEFT,
    paddingRight: 26,
    paddingTop: 18,
  },
  qLabel: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  query: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 32,
    color: colors.inkBlue,
    marginBottom: 20,
  },
  answerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  answer: {
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 38,
    color: colors.ink,
  },
  abstainEmoji: { fontSize: 52, marginBottom: 12 },
  abstain: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 34,
    color: colors.ink,
  },
  suggest: {
    fontFamily: fonts.body,
    fontSize: 18,
    lineHeight: 26,
    color: colors.inkMuted,
    marginTop: 16,
  },
  suggestTopic: {
    fontFamily: fonts.display,
    color: colors.inkBlue,
  },
  continueNote: {
    position: 'absolute',
    right: 24,
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
