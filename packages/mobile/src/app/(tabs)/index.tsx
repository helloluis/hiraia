import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatHeader } from '../../components/ChatHeader';
import { ChatTextInput } from '../../components/ChatTextInput';
import { ChatThread } from '../../components/ChatThread';
import { LoadingBar } from '../../components/LoadingBar';
import { QuizOverlay } from '../../components/QuizOverlay';
import { ACTIVE_MODEL_KEY } from '../../config/model';
import { uiStrings } from '../../config/strings';
import { useChatStore } from '../../store/chatStore';
import { useEngineStore } from '../../store/engineStore';
import { useQuizStore } from '../../store/quizStore';
import { colors } from '../../theme';

// The 1B "kitten" build can make mistakes — including on safety / "is this true?"
// questions (role-play QA, 2026-06-19). Surface a dismissible disclaimer on the
// opening chat screen so a kid/parent sees it. Cat (3B) build never shows this.
const IS_KITTEN = ACTIVE_MODEL_KEY === 'sailor2-1b';

export default function ChatScreen() {
  const { messages, sendMessage, isStreaming, currentStreamingContent } = useChatStore();
  const hasHydrated = useChatStore((s) => s.hasHydrated);
  const showColdStartFactoid = useChatStore((s) => s.showColdStartFactoid);
  const isReady = useEngineStore((s) => s.isReady);
  const t = uiStrings(useEngineStore((s) => s.language));
  const quizActive = useQuizStore((s) => s.active);
  const [inputText, setInputText] = useState('');
  // Re-shows each cold open (dismissal not persisted) — it's a safety notice.
  const [showKittenNote, setShowKittenNote] = useState(IS_KITTEN);

  // Once persisted history has loaded, offer a "Alam mo ba na…?" factoid so there's
  // something to read while the model warms up. The store decides whether to actually
  // show one (it no-ops if a fresh factoid is already on screen / shown < 1h ago), so
  // this is safe to re-fire on a resume re-mount.
  const factoidShown = useRef(false);
  useEffect(() => {
    if (hasHydrated && !factoidShown.current) {
      factoidShown.current = true;
      void showColdStartFactoid();
    }
  }, [hasHydrated, showColdStartFactoid]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text) return;

    // Clear the field immediately — sendMessage() doesn't resolve until the whole
    // streamed response finishes, so awaiting it before clearing left the typed
    // question sitting in the input the entire time the model was generating.
    setInputText('');
    void sendMessage(text);
  };

  // Quiz mode takes over the whole screen (yellow legal-pad). Render it instead of the
  // chat so the chat's KeyboardAvoidingView / input bar don't fight the quiz layout;
  // on exit the round is appended back into the chat thread (quizStore → addQuizRecap).
  if (quizActive) {
    return <QuizOverlay />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
        keyboardVerticalOffset={0}
      >
        <ChatHeader />
        {showKittenNote && (
          <View style={styles.kittenNote}>
            <Text style={styles.kittenNoteIcon}>⚠️</Text>
            <Text style={styles.kittenNoteText}>{t.kittenExperimental}</Text>
            <Pressable onPress={() => setShowKittenNote(false)} hitSlop={10} accessibilityLabel="Dismiss">
              <Text style={styles.kittenNoteClose}>✕</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.chatContainer}>
          <ChatThread
            messages={messages}
            isStreaming={isStreaming}
            streamingContent={currentStreamingContent}
          />
          <LoadingBar loading={!isReady} />
          <ChatTextInput
            value={inputText}
            onChangeText={setInputText}
            onSend={handleSend}
            disabled={!isReady}
            placeholder={isReady ? t.inputPlaceholder : t.inputPreparing}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  chatContainer: {
    flex: 1,
  },
  kittenNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#fff4ed',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#b54708',
  },
  kittenNoteIcon: {
    fontSize: 14,
    lineHeight: 18,
  },
  kittenNoteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: '#9a3412',
  },
  kittenNoteClose: {
    fontSize: 13,
    color: '#9a3412',
    paddingHorizontal: 2,
  },
});
