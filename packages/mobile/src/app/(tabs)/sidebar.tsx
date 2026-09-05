import { ActivityTable } from '../../telemetry/ActivityTable';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Language } from '@hiraia/shared';

import { GRADE_OPTIONS } from '../../config/grades';
import { LANGUAGE_OPTIONS } from '../../config/languages';
import { ACTIVE_MODEL, VECTORS_META } from '../../config/model';
import { uiStrings } from '../../config/strings';
import { HIRAIAPEDIA_VERSION } from '../../config/version';
import { useEngineStore } from '../../store/engineStore';
import { card, fonts } from '../../theme';

export default function SidebarScreen() {
  const router = useRouter();
  const language = useEngineStore((s) => s.language);
  const changeLanguage = useEngineStore((s) => s.changeLanguage);
  const grade = useEngineStore((s) => s.grade);
  const changeGrade = useEngineStore((s) => s.changeGrade);
  const setOnboardingActive = useEngineStore((s) => s.setOnboardingActive);

  const showTutorial = () => {
    setOnboardingActive(true);
    router.back();
  };

  const t = uiStrings(language);

  const onPickLanguage = (lang: Language) => {
    if (lang === language) return;
    // Reload the multilingual model with the chosen language prompt and retrieval bank.
    void changeLanguage(lang);
    router.back();
  };

  return (
    <View style={styles.overlay}>
      <SafeAreaView style={styles.panel} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>hiraia</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.closeButton}>{t.close}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        <Text style={styles.sectionTitle}>{t.sectionLanguage}</Text>
        <View style={styles.langRow}>
          {LANGUAGE_OPTIONS.map((opt) => {
            const active = opt.lang === language;
            return (
              <TouchableOpacity
                key={opt.lang}
                style={[
                  styles.langChip,
                  active && styles.langChipActive,
                  opt.comingSoon && styles.langChipComingSoon,
                ]}
                onPress={() => onPickLanguage(opt.lang)}
                disabled={opt.comingSoon}
                activeOpacity={0.85}
              >
                <Text style={[styles.langChipText, active && styles.langChipTextActive]}>
                  {opt.label}
                </Text>
                {opt.beta && <Text style={styles.langBeta}> {t.beta}</Text>}
                {opt.comingSoon && <Text style={styles.langSoon}> {t.comingSoon}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.langNote}>{t.langRestartNote}</Text>

        <Text style={styles.sectionTitle}>{t.sectionGrade}</Text>
        <View style={styles.langRow}>
          {GRADE_OPTIONS.map((g) => {
            const active = g === grade;
            // No reload (the adapter is per-language, not per-grade) — apply in place and
            // STAY on the sheet, unlike a language pick, so a mis-tap is one tap to undo.
            return (
              <TouchableOpacity
                key={g}
                style={[styles.langChip, styles.gradeChip, active && styles.langChipActive]}
                onPress={() => void changeGrade(g)}
                activeOpacity={0.85}
              >
                <Text style={[styles.langChipText, active && styles.langChipTextActive]}>{g}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ActivityTable />

        <Text style={styles.sectionTitle}>{t.sectionVersion}</Text>
        <View style={styles.versionBlock}>
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>{t.labelModel}</Text>
            <Text style={styles.versionValue}>
              {ACTIVE_MODEL.displayName} · {ACTIVE_MODEL.quant}
            </Text>
          </View>
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>Hiraiapedia</Text>
            <Text style={styles.versionValue}>
              v{HIRAIAPEDIA_VERSION} · {VECTORS_META.count.toLocaleString()} {t.facts}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>{t.tutorial}</Text>
        <TouchableOpacity style={styles.tutorialButton} onPress={showTutorial} activeOpacity={0.85}>
          <Text style={styles.tutorialButtonText}>{t.showTutorial}</Text>
        </TouchableOpacity>
      </ScrollView>
      </SafeAreaView>
      {/* dimmed feed beside the settings panel; tap to close */}
      <Pressable style={styles.backdrop} onPress={() => router.back()} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  panel: {
    width: '92%',
    maxWidth: 480,
    backgroundColor: card.stock,
    // Match the card feed’s cream stock and forest ink.
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 16,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 59, 46, 0.45)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: card.sage,
  },
  title: {
    fontFamily: fonts.slab,
    fontSize: 28,
    color: card.ink,
  },
  closeButton: {
    fontFamily: fonts.cardBody,
    fontSize: 18,
    color: card.ink,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
    paddingBottom: 24,
  },
  sectionTitle: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 20,
    color: card.ink,
    marginTop: 18,
    marginBottom: 8,
  },
  placeholder: {
    fontFamily: fonts.cardBody,
    fontSize: 16,
    color: card.olive,
  },
  versionBlock: {
    gap: 6,
  },
  versionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  versionLabel: {
    fontFamily: fonts.cardBody,
    fontSize: 15,
    color: card.olive,
  },
  versionValue: {
    fontFamily: fonts.cardBody,
    fontSize: 15,
    color: card.ink,
    flexShrink: 1,
    textAlign: 'right',
  },
  langRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  langChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: card.ink,
    backgroundColor: card.stock,
  },
  langChipActive: {
    backgroundColor: card.ink,
  },
  // A grade chip holds one or two digits, not a word: narrower side padding and a fixed
  // minimum keep "3" and "10" the same size so the row reads as a row of buttons.
  gradeChip: {
    justifyContent: 'center',
    minWidth: 52,
    paddingHorizontal: 10,
  },
  langChipText: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 19,
    color: card.ink,
  },
  langChipTextActive: {
    color: card.stock,
  },
  langBeta: {
    fontFamily: fonts.cardBody,
    fontSize: 12,
    color: card.forkB,
  },
  langChipComingSoon: {
    opacity: 0.45,
    borderColor: card.olive,
  },
  langSoon: {
    fontFamily: fonts.cardBody,
    fontSize: 12,
    color: card.olive,
  },
  langNote: {
    fontFamily: fonts.cardBody,
    fontSize: 14,
    color: card.olive,
    marginTop: 10,
  },
  tutorialButton: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: card.ink,
    backgroundColor: card.stock,
  },
  tutorialButtonText: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 18,
    color: card.ink,
  },
});
