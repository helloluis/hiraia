import { StyleSheet, Text, View } from 'react-native';

import type { Message } from '@hiraia/shared';

import { colors, fonts } from '../theme';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      {!isUser && <Text style={styles.avatar}>🐻</Text>}
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.text, isUser ? styles.userText : styles.assistantText]}>
          {message.content}
        </Text>
        {message.timestamp && (
          <Text style={[styles.timestamp, isUser ? styles.userTimestamp : styles.assistantTimestamp]}>
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
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: colors.bubble,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 24,
  },
  userText: {
    color: colors.white,
  },
  assistantText: {
    color: colors.ink,
  },
  timestamp: {
    fontFamily: fonts.body,
    fontSize: 12,
    marginTop: 4,
  },
  userTimestamp: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  assistantTimestamp: {
    color: colors.inkMuted,
  },
});
