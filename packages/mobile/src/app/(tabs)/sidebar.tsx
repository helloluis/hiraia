import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Language } from '@hiraia/shared';

import { LANGUAGE_OPTIONS } from '../../config/languages';
import { useEngineStore } from '../../store/engineStore';
import { colors, fonts } from '../../theme';

export default function SidebarScreen() {
  const router = useRouter();
  const language = useEngineStore((s) => s.language);
  const changeLanguage = useEngineStore((s) => s.changeLanguage);

  const onPickLanguage = (lang: Language) => {
    if (lang === language) return;
    // Reloads the model (adapter swap, ~20-30s). Return to chat to watch it load.
    void changeLanguage(lang);
    router.back();
  };

  return (
    <View style={styles.overlay}>
      <SafeAreaView style={styles.panel} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>hiraia</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.closeButton}>Isara</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Wika</Text>
        <View style={styles.langRow}>
          {LANGUAGE_OPTIONS.map((opt) => {
            const active = opt.lang === language;
            return (
              <TouchableOpacity
                key={opt.lang}
                style={[styles.langChip, active && styles.langChipActive]}
                onPress={() => onPickLanguage(opt.lang)}
                activeOpacity={0.85}
              >
                <Text style={[styles.langChipText, active && styles.langChipTextActive]}>
                  {opt.label}
                </Text>
                {opt.beta && <Text style={styles.langBeta}> beta</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.langNote}>Sandali itong magri-restart kapag pinalitan.</Text>

        <Text style={styles.sectionTitle}>Mga Usapan</Text>
        <Text style={styles.placeholder}>Wala pang usapan</Text>

        <Text style={styles.sectionTitle}>Mga Tala</Text>
        <Text style={styles.placeholder}>Wala pang tala</Text>
      </View>

      <TouchableOpacity style={styles.newChatButton}>
        <Text style={styles.newChatText}>+ Bagong Usapan</Text>
      </TouchableOpacity>
      </SafeAreaView>
      {/* dimmed page peeking out beside the notebook cover; tap to close */}
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
    width: '80%',
    backgroundColor: colors.cover,
    // drop shadow along the right edge — looks like the cover of a notebook
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 16,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(12, 52, 61, 0.28)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  title: {
    fontFamily: fonts.title,
    fontSize: 28,
    color: colors.ink,
  },
  closeButton: {
    fontFamily: fonts.body,
    fontSize: 18,
    color: colors.primary,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.ink,
    marginTop: 24,
    marginBottom: 8,
  },
  placeholder: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.inkMuted,
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
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.white,
  },
  langChipActive: {
    backgroundColor: colors.primary,
  },
  langChipText: {
    fontFamily: fonts.display,
    fontSize: 19,
    color: colors.ink,
  },
  langChipTextActive: {
    color: colors.white,
  },
  langBeta: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.accent,
  },
  langNote: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkMuted,
    marginTop: 10,
  },
  newChatButton: {
    backgroundColor: colors.primary,
    padding: 16,
    alignItems: 'center',
    margin: 16,
    borderRadius: 12,
  },
  newChatText: {
    fontFamily: fonts.body,
    color: colors.white,
    fontSize: 18,
  },
});
