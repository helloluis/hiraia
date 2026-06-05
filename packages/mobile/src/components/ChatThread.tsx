import { useEffect, useRef } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import type { Message } from '@hiraia/shared';

import { colors, fonts } from '../theme';

import { MessageBubble } from './MessageBubble';

interface ChatThreadProps {
  messages: Message[];
  isStreaming?: boolean;
  streamingContent?: string;
}

export function ChatThread({ messages, isStreaming, streamingContent }: ChatThreadProps) {
  const listRef = useRef<FlatList<Message>>(null);

  // Keep the newest message (and the streaming bubble) in view.
  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length, isStreaming, streamingContent]);

  if (messages.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Maligayang Pagdating sa Hiraia!</Text>
          <Text style={styles.emptySubtitle}>
            Magtanong ka ng kahit ano tungkol sa agham. Nandito ako para tulungan kang matuto.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={messages}
        renderItem={({ item }) => <MessageBubble message={item} />}
        keyExtractor={(item, index) => `${item.timestamp?.getTime() ?? index}-${index}`}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListFooterComponent={
          isStreaming ? <StreamingBubble content={streamingContent ?? ''} /> : null
        }
      />
    </View>
  );
}

/** The assistant's in-progress reply: shows tokens as they arrive, or a "thinking" dot. */
function StreamingBubble({ content }: { content: string }) {
  return (
    <View style={styles.streamingRow}>
      <Text style={styles.avatar}>🐻</Text>
      <View style={styles.streamingBubble}>
        {content ? (
          <Text style={styles.streamingText}>{content}</Text>
        ) : (
          <ActivityIndicator color={colors.primary} size="small" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 34,
    color: colors.ink,
    marginBottom: 10,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: fonts.body,
    fontSize: 18,
    lineHeight: 26,
    color: colors.inkMuted,
    textAlign: 'center',
  },
  messageList: {
    padding: 16,
    gap: 16,
  },
  streamingRow: {
    flexDirection: 'row',
    maxWidth: '85%',
    alignSelf: 'flex-start',
  },
  avatar: {
    fontSize: 24,
    marginRight: 8,
    marginTop: 4,
  },
  streamingBubble: {
    padding: 12,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    backgroundColor: colors.bubble,
    borderWidth: 1,
    borderColor: colors.hairline,
    minWidth: 44,
    justifyContent: 'center',
  },
  streamingText: {
    fontFamily: fonts.body,
    fontSize: 17,
    lineHeight: 24,
    color: colors.ink,
  },
});
