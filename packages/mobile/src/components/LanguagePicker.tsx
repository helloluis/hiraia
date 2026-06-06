import { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Language } from '@hiraia/shared';

import { LANGUAGE_OPTIONS } from '../config/languages';
import { colors, fonts } from '../theme';
import { NotebookBackground } from './NotebookBackground';

/**
 * First-launch takeover: the kid chooses Tagalog / Bisaya / English before the
 * model loads, so the right adapter is loaded the first time (no reload). The
 * choice is persisted and can be changed later in the Menu. Language is undecided
 * here, so the framing line is trilingual.
 */
export function LanguagePicker({ onPick }: { onPick: (language: Language) => void }) {
  const [picked, setPicked] = useState<Language | null>(null);

  const choose = (lang: Language) => {
    if (picked) return; // guard against double-tap during the hand-off
    setPicked(lang);
    onPick(lang);
  };

  return (
    <SafeAreaView style={styles.overlay}>
      <NotebookBackground />
      <View style={styles.content}>
        <Image source={require('../../assets/hiraia-profile.png')} style={styles.avatar} />
        <Text style={styles.brand}>Hiraia</Text>
        <Text style={styles.prompt}>Piliin ang wika{'\n'}Pilia ang pinulongan{'\n'}Choose your language</Text>

        <View style={styles.options}>
          {LANGUAGE_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.lang}
              style={[styles.option, picked === opt.lang && styles.optionPicked]}
              onPress={() => choose(opt.lang)}
              disabled={!!picked}
              activeOpacity={0.85}
            >
              <Text style={styles.optionLabel}>{opt.label}</Text>
              {opt.beta && (
                <View style={styles.betaPill}>
                  <Text style={styles.betaText}>beta</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.note}>Mababago mo ito mamaya sa Menu.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.paper,
    zIndex: 100,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    marginBottom: 12,
  },
  brand: {
    fontFamily: fonts.title,
    fontSize: 40,
    color: colors.ink,
    marginBottom: 16,
  },
  prompt: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 30,
    color: colors.inkMuted,
    textAlign: 'center',
    marginBottom: 36,
  },
  options: {
    width: '100%',
    gap: 14,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 18,
    paddingVertical: 18,
  },
  optionPicked: {
    backgroundColor: colors.primary,
  },
  optionLabel: {
    fontFamily: fonts.display,
    fontSize: 24,
    color: colors.ink,
  },
  betaPill: {
    marginLeft: 10,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  betaText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.ink,
  },
  note: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.inkMuted,
    marginTop: 28,
    textAlign: 'center',
  },
});
