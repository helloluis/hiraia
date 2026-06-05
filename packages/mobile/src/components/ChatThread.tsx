import { FlatList, StyleSheet, Text, View } from 'react-native';

import type { Message } from '@hiraia/shared';

import { colors, fonts } from '../theme';

import { MessageBubble } from './MessageBubble';

interface ChatThreadProps {
  messages: Message[];
}

export function ChatThread({ messages }: ChatThreadProps) {
  return (
    <View style={styles.container}>
      {messages.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Maligayang Pagdating sa Hiraia!</Text>
          <Text style={styles.emptySubtitle}>
            Magtanong ka ng kahit ano tungkol sa agham. Nandito ako para tulungan kang matuto.
          </Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          renderItem={({ item }) => <MessageBubble message={item} />}
          keyExtractor={(item, index) => `${item.timestamp?.getTime() ?? index}`}
          contentContainerStyle={styles.messageList}
          inverted={false}
        />
      )}
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
});
