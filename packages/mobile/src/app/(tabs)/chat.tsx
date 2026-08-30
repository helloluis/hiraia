import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatHeader } from '../../components/ChatHeader';
import { ChatTextInput } from '../../components/ChatTextInput';
import { ChatThread } from '../../components/ChatThread';
import { LoadingBar } from '../../components/LoadingBar';
import { uiStrings } from '../../config/strings';
import { useChatStore } from '../../store/chatStore';
import { useEngineStore } from '../../store/engineStore';
import { colors } from '../../theme';

export default function ChatScreen() {
  const { messages, sendMessage, isStreaming, currentStreamingContent } = useChatStore();
  const hasHydrated = useChatStore((s) => s.hasHydrated);
  const showColdStartFactoid = useChatStore((s) => s.showColdStartFactoid);
  const isReady = useEngineStore((s) => s.isReady);
  const engineError = useEngineStore((s) => s.error);
  const language = useEngineStore((s) => s.language);
  const changeLanguage = useEngineStore((s) => s.changeLanguage);
  const t = uiStrings(language);
  const [inputText, setInputText] = useState('');

  // LAZY LOAD: the model is NOT warmed on app boot (the home screen is the card feed).
  // Warm it the first time chat is opened. changeLanguage is a no-op if already ready.
  const engineKicked = useRef(false);
  useEffect(() => {
    if (language && !isReady && !engineKicked.current) {
      engineKicked.current = true;
      void changeLanguage(language);
    }
  }, [language, isReady, changeLanguage]);

  // A FAILED load must not masquerade as a slow one. Before this, `disabled={!isReady}`
  // and `placeholder={t.inputPreparing}` meant an engine that had already given up sat
  // behind a creeping progress bar and the words "Preparing the AI…" forever — the exact
  // silent-degradation this screen now refuses elsewhere (LocalEngine declines to run the
  // raw base model when the LoRA adapter is missing, and that refusal lands here as
  // `error`). So: stop the bar, say so plainly, and make the whole bar a retry target —
  // the same affordance the feed's search field already offers.
  const retryLoad = () => {
    if (!language) return;
    // changeLanguage() serialises every load behind one promise chain, so a retry tapped
    // while something is still running waits for it rather than stacking a second
    // LocalEngine init (and a second writer on the same download .part).
    engineKicked.current = true;
    void changeLanguage(language);
  };

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

  // Quiz mode is ARCHIVED. It was a separate full-screen practice mode reached from the
  // chat header, but the card feed's interject now covers the same ground in the place the
  // kid already is, and nothing in the current design points at it. QuizOverlay and
  // quizStore are left in the tree unwired (as LoaderOverlay is) rather than deleted —
  // but its 2.2 MB bundled question sample is no longer shipped, and 969 of those 1,567
  // questions were tied to facts that never became cards, so they were unreachable twice
  // over: no UI to open, and no card to ask about.
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
        keyboardVerticalOffset={0}
      >
        <ChatHeader />
        <View style={styles.chatContainer}>
          <ChatThread
            messages={messages}
            isStreaming={isStreaming}
            streamingContent={currentStreamingContent}
          />
          {/* `failed` matters: without it an engine that gave up plays the SUCCESS
              animation (fill to 100%, fade) — the bar would say "done" at the exact
              moment the tutor became unavailable. */}
          <LoadingBar loading={!isReady && !engineError} failed={!!engineError} />
          <ChatTextInput
            value={inputText}
            onChangeText={setInputText}
            onSend={handleSend}
            disabled={!isReady}
            placeholder={
              engineError ? t.inputUnavailable : isReady ? t.inputPlaceholder : t.inputPreparing
            }
            onDisabledPress={engineError ? retryLoad : undefined}
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
});
