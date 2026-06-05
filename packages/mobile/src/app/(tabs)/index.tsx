import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatHeader } from '../../components/ChatHeader';
import { ChatTextInput } from '../../components/ChatTextInput';
import { ChatThread } from '../../components/ChatThread';
import { LoadingBar } from '../../components/LoadingBar';
import { NotebookBackground } from '../../components/NotebookBackground';
import { useChatStore } from '../../store/chatStore';
import { useEngineStore } from '../../store/engineStore';
import { colors } from '../../theme';

export default function ChatScreen() {
  const { messages, sendMessage, isStreaming, currentStreamingContent } = useChatStore();
  const hasHydrated = useChatStore((s) => s.hasHydrated);
  const showColdStartFactoid = useChatStore((s) => s.showColdStartFactoid);
  const isReady = useEngineStore((s) => s.isReady);
  const [inputText, setInputText] = useState('');

  // Once persisted history has loaded, drop in one "Alam mo ba na…?" factoid so
  // there's something to read while the model warms up. Exactly once per launch.
  const factoidShown = useRef(false);
  useEffect(() => {
    if (hasHydrated && !factoidShown.current) {
      factoidShown.current = true;
      showColdStartFactoid();
    }
  }, [hasHydrated, showColdStartFactoid]);

  const handleSend = async () => {
    if (!inputText.trim()) return;

    await sendMessage(inputText.trim());
    setInputText('');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ChatHeader />
        <View style={styles.chatContainer}>
          <NotebookBackground />
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
            placeholder={isReady ? 'Magtanong tungkol sa agham...' : 'Inihahanda ang AI...'}
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
