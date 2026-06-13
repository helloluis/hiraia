import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { Language } from '@hiraia/shared';

import { LANG_BUTTON, LANG_CYCLE, Q_HOW_USE } from '../../config/onboarding';
import { LANGUAGE_OPTIONS } from '../../config/languages';
import { colors, fonts } from '../../theme';
import { useTypewriter } from './useTypewriter';

const HOLD_MS = 1500; // how long a fully-typed question lingers before the next language

/**
 * Slide 1: the "how do you want to use Hiraia?" question typewriters on, cycling
 * Tagalog → English → Bisaya → (loop), each replacing the last; three language
 * buttons (each written in its own language) below.
 */
export function LanguageSlide({ onPick }: { onPick: (lang: Language) => void }) {
  const [cycle, setCycle] = useState(0);
  const lang = LANG_CYCLE[cycle % LANG_CYCLE.length]!;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const typed = useTypewriter(Q_HOW_USE[lang], {
    playKey: cycle,
    stepMs: 48,
    onDone: () => {
      holdTimer.current = setTimeout(() => setCycle((c) => c + 1), HOLD_MS);
    },
  });

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    []
  );

  return (
    <View style={styles.slide}>
      <Image source={require('../../../assets/hiraia-profile.png')} style={styles.avatar} />
      <Text style={styles.brand}>Hiraia</Text>

      {/* fixed-height so the buttons don't jump as the question retypes */}
      <View style={styles.questionBox}>
        <Text style={styles.question}>
          {typed}
          <Text style={styles.caret}>▍</Text>
        </Text>
      </View>

      <View style={styles.options}>
        {LANGUAGE_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.lang}
            style={[styles.option, opt.comingSoon && styles.optionComingSoon]}
            onPress={() => onPick(opt.lang)}
            disabled={opt.comingSoon}
            activeOpacity={0.85}
          >
            <Text style={styles.optionLabel}>{LANG_BUTTON[opt.lang]}</Text>
            {opt.beta && (
              <View style={styles.betaPill}>
                <Text style={styles.betaText}>beta</Text>
              </View>
            )}
            {opt.comingSoon && (
              <View style={styles.soonPill}>
                <Text style={styles.soonText}>hapit na!</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  avatar: { width: 84, height: 84, borderRadius: 42, marginBottom: 10 },
  brand: { fontFamily: fonts.title, fontSize: 38, color: colors.ink, marginBottom: 20 },
  questionBox: { height: 96, justifyContent: 'center', marginBottom: 28 },
  question: {
    fontFamily: fonts.display,
    fontSize: 23,
    lineHeight: 32,
    color: colors.ink,
    textAlign: 'center',
  },
  caret: { color: colors.primary },
  options: { width: '100%', gap: 13 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 18,
    paddingVertical: 17,
  },
  optionLabel: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  betaPill: {
    marginLeft: 10,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  betaText: { fontFamily: fonts.body, fontSize: 12, color: colors.ink },
  optionComingSoon: { opacity: 0.45, borderColor: colors.inkMuted },
  soonPill: {
    marginLeft: 10,
    backgroundColor: colors.inkMuted,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  soonText: { fontFamily: fonts.body, fontSize: 12, color: colors.white },
});
