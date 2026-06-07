import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { LANGUAGE_OPTIONS, DEFAULT_LANGUAGE } from '../config/languages';
import { useEngineStore } from '../store/engineStore';
import { colors, fonts } from '../theme';

export function ChatHeader() {
  const router = useRouter();
  const language = useEngineStore((s) => s.language) ?? DEFAULT_LANGUAGE;
  const languageLabel =
    LANGUAGE_OPTIONS.find((o) => o.lang === language)?.label ?? 'Tagalog';

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
});
