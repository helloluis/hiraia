import { useRouter } from 'expo-router';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { LANGUAGE_OPTIONS, DEFAULT_LANGUAGE } from '../config/languages';
import { uiStrings } from '../config/strings';
import { useEngineStore } from '../store/engineStore';
import { useQuizStore } from '../store/quizStore';
import { colors, fonts } from '../theme';

export function ChatHeader() {
  const router = useRouter();
  const language = useEngineStore((s) => s.language) ?? DEFAULT_LANGUAGE;
  const languageLabel =
    LANGUAGE_OPTIONS.find((o) => o.lang === language)?.label ?? 'Tagalog';
  const openQuiz = useQuizStore((s) => s.open);
  const Q = uiStrings(language).quiz;

  // Anti-mistap confirm before taking over the screen with quiz mode.
  const confirmQuiz = () => {
    Alert.alert(Q.confirmTitle, Q.confirmBody, [
      { text: Q.confirmCancel, style: 'cancel' },
      { text: Q.confirmStart, onPress: () => openQuiz() },
    ]);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.push('/sidebar')} style={styles.menuButton}>
        <Text style={styles.menuIcon}>☰</Text>
      </TouchableOpacity>

      <View style={styles.titleContainer}>
        <Text style={styles.title} numberOfLines={1}>
          hiraia
        </Text>
      </View>

      <View style={styles.pills}>
        {/* Practice-quiz mode. Confirms first (anti-mistap), then takes over the screen. */}
        <TouchableOpacity style={styles.quizPill} onPress={confirmQuiz}>
          <Text style={styles.quizPillText}>{Q.button}</Text>
        </TouchableOpacity>
        {/* Active language, spelled out. Tap to open the language picker. */}
        <TouchableOpacity style={styles.pill} onPress={() => router.push('/sidebar')}>
          <Text style={styles.pillText}>{languageLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.paper,
  },
  menuButton: {
    padding: 8,
  },
  menuIcon: {
    fontSize: 24,
    color: colors.ink,
  },
  titleContainer: {
    flex: 1,
    marginHorizontal: 12,
  },
  title: {
    fontFamily: fonts.title,
    fontSize: 26,
    color: colors.ink,
  },
  pills: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    backgroundColor: colors.bubble,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pillText: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.primary,
  },
  quizPill: {
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(12,52,61,0.18)',
  },
  quizPillText: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.ink,
    letterSpacing: 0.5,
  },
});
