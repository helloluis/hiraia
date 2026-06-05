import { FlatList, StyleSheet, Text, View } from 'react-native';

import type { Message } from '@hiraia/shared';

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
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#6B6B6B',
    textAlign: 'center',
  },
  messageList: {
    padding: 16,
    gap: 16,
  },
});
