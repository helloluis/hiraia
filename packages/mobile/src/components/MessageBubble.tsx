import { StyleSheet, Text, View } from 'react-native';

import type { Message } from '@hiraia/shared';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      {!isUser && <Text style={styles.avatar}>🤖</Text>}
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.text, isUser ? styles.userText : styles.assistantText]}>
          {message.content}
        </Text>
        {message.timestamp && (
          <Text style={styles.timestamp}>
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    maxWidth: '85%',
  },
  userContainer: {
    alignSelf: 'flex-end',
  },
  assistantContainer: {
    alignSelf: 'flex-start',
  },
  avatar: {
    fontSize: 24,
    marginRight: 8,
    marginTop: 4,
  },
  bubble: {
    padding: 12,
    borderRadius: 18,
  },
  userBubble: {
    backgroundColor: '#2563EB',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: '#F7F7F8',
    borderBottomLeftRadius: 4,
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
  },
  userText: {
    color: '#FFFFFF',
  },
  assistantText: {
    color: '#1A1A1A',
  },
  timestamp: {
    fontSize: 11,
    color: '#6B6B6B',
    marginTop: 4,
  },
});
