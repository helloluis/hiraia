/**
 * Reward interject page of the question-cards feed: a periodic (jittered 15-25 cards)
 * celebration of how much the kid just learned, naming a few real recent topics. The warm
 * line is LLM-generated when the (background-warmed) model is ready, else a deterministic
 * template — but the topic NAMES always come from the real view-log, so it never fabricates
 * what they learned. A blue "ituloy ⤴" note resumes the walk onto the card they'd chosen.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Language } from '@hiraia/shared';

import { uiStrings } from '../../config/strings';
import type { RewardContent } from '../../data/reward';
import { colors, fonts, notebook } from '../../theme';

const GUTTER_LEFT = notebook.marginX + 14;

export function RewardCard({
  reward,
  language,
  onContinue,
}: {
  reward: RewardContent;
  language: Language;
  onContinue: () => void;
}) {
  const t = uiStrings(language);
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);

  // a gentle star pop-in
  const scale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 70, useNativeDriver: true }).start();
  }, [scale]);

  return (
    <View style={[styles.page, { paddingBottom: 78 + bottomPad }]}>
      <View style={styles.center}>
        <Animated.Text style={[styles.star, { transform: [{ scale }] }]}>🌟</Animated.Text>
        <Text style={styles.body}>{reward.text}</Text>
        {reward.topics.length > 0 && (
          <View style={styles.chips}>
            {reward.topics.map((tp) => (
              <View key={tp} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>
                  {tp}
                </Text>
              </View>
            ))}
          </View>
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
    paddingTop: 10,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  star: {
    fontSize: 72,
    marginBottom: 14,
  },
  body: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 38,
    color: colors.ink,
    textAlign: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 20,
  },
  chip: {
    backgroundColor: colors.bubble,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.hairline,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: '80%',
  },
  chipText: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.primary,
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
