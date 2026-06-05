import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatHeader } from '../../components/ChatHeader';
import { ChatTextInput } from '../../components/ChatTextInput';
import { ChatThread } from '../../components/ChatThread';
import { useChatStore } from '../../store/chatStore';

export default function ChatScreen() {
  const { messages, sendMessage } = useChatStore();
  const [inputText, setInputText] = useState('');

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
          <ChatThread messages={messages} />
          <ChatTextInput
            value={inputText}
            onChangeText={setInputText}
            onSend={handleSend}
            placeholder="Magtanong tungkol sa agham..."
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  chatContainer: {
    flex: 1,
  },
});
