import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { Language } from '@hiraia/shared';

import { DL_BODY, DL_OK, DL_TITLE } from '../../config/onboarding';
import { colors, fonts } from '../../theme';

/**
 * Slide 3: tell the kid a large one-time download is needed (Hiraiapedia + AI tutor)
 * and that it already started in the background. OK dismisses the carousel.
 */
export function DownloadSlide({ language, onDone }: { language: Language; onDone: () => void }) {
  return (
    <View style={styles.slide}>
      <Text style={styles.icon}>📦</Text>
      <Text style={styles.title}>{DL_TITLE[language]}</Text>
      <Text style={styles.body}>{DL_BODY[language]}</Text>
      <TouchableOpacity style={styles.ok} onPress={onDone} activeOpacity={0.85}>
        <Text style={styles.okText}>{DL_OK[language]}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  icon: { fontSize: 56, marginBottom: 16 },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 26,
    color: colors.inkMuted,
    textAlign: 'center',
    marginBottom: 40,
  },
  ok: {
    backgroundColor: colors.primary,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 64,
  },
  okText: { fontFamily: fonts.display, fontSize: 22, color: colors.white },
});
