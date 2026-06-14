import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Language } from '@hiraia/shared';

import { LANGUAGE_OPTIONS } from '../../config/languages';
import { ACTIVE_MODEL, VECTORS_META } from '../../config/model';
import { uiStrings } from '../../config/strings';
import { HIRAIAPEDIA_VERSION, ADAPTER_VERSION } from '../../config/version';
import { listConversations, type Conversation } from '../../db/repo';
import { useChatStore } from '../../store/chatStore';
import { useEngineStore } from '../../store/engineStore';
import { colors, fonts } from '../../theme';

export default function SidebarScreen() {
  const router = useRouter();
  const language = useEngineStore((s) => s.language);
  const changeLanguage = useEngineStore((s) => s.changeLanguage);
  const setOnboardingActive = useEngineStore((s) => s.setOnboardingActive);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const switchConversation = useChatStore((s) => s.switchConversation);
  const activeConvId = useChatStore((s) => s.conversationId);

  // Past conversations for the history list. Loaded each time the sidebar opens; only
  // titled ones show (an untitled, just-created "new chat" stays hidden until first use).
  const [conversations, setConversations] = useState<Conversation[]>([]);
  useEffect(() => {
    void listConversations().then(setConversations).catch(() => undefined);
  }, []);
  const pastChats = conversations.filter((c) => c.title);

  const openConversation = (id: string) => {
    void switchConversation(id);
    router.back();
  };

  const showTutorial = () => {
    setOnboardingActive(true);
    router.back();
  };

  const newConversation = () => {
    void clearMessages(); // fresh thread — avoids the model echoing a prior turn's context
    router.back();
  };

  const t = uiStrings(language);
  const langLabel = LANGUAGE_OPTIONS.find((o) => o.lang === language)?.label ?? '—';
  const adapterInfo = language ? ADAPTER_VERSION[language] : '—';

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

        <Text style={styles.sectionTitle}>{t.sectionConversations}</Text>
        {pastChats.length === 0 ? (
          <Text style={styles.placeholder}>{t.noConversations}</Text>
        ) : (
          pastChats.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.convRow, c.id === activeConvId && styles.convRowActive]}
              onPress={() => openConversation(c.id)}
              activeOpacity={0.8}
            >
              <Text style={styles.convTitle} numberOfLines={1}>
                {c.title}
              </Text>
              <Text style={styles.convDate}>
                {new Date(c.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </Text>
            </TouchableOpacity>
          ))
        )}

        <Text style={styles.sectionTitle}>{t.sectionNotes}</Text>
        <Text style={styles.placeholder}>{t.noNotes}</Text>

        <Text style={styles.sectionTitle}>{t.sectionVersion}</Text>
        <View style={styles.versionBlock}>
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>{t.labelModel}</Text>
            <Text style={styles.versionValue}>
              {ACTIVE_MODEL.displayName} · {ACTIVE_MODEL.quant}
            </Text>
          </View>
          <View style={styles.versionRow}>
            <Text style={styles.versionLabel}>Adapter ({langLabel})</Text>
            <Text style={styles.versionValue}>{adapterInfo}</Text>
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

      <TouchableOpacity style={styles.newChatButton} onPress={newConversation} activeOpacity={0.85}>
        <Text style={styles.newChatText}>{t.newConversation}</Text>
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
  },
  contentInner: {
    padding: 16,
    paddingBottom: 24,
  },
  convRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.white,
    marginBottom: 8,
  },
  convRowActive: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  convTitle: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  convDate: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.inkMuted,
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
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.inkMuted,
  },
  versionValue: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
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
  langChipComingSoon: {
    opacity: 0.45,
    borderColor: colors.inkMuted,
  },
  langSoon: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.inkMuted,
  },
  langNote: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.inkMuted,
    marginTop: 10,
  },
  tutorialButton: {
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.white,
  },
  tutorialButtonText: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.ink,
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
