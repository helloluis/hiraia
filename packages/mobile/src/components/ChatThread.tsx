import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Message } from '@hiraia/shared';

import { colors, fonts } from '../theme';

import { MessageBubble } from './MessageBubble';
import { NotebookBackground } from './NotebookBackground';
import { RichText } from './RichText';

const HIRAIA_AVATAR = require('../../assets/hiraia-profile.png');
const WINDOW_H = Dimensions.get('window').height;

interface ChatThreadProps {
  messages: Message[];
  isStreaming?: boolean;
  streamingContent?: string;
}

export function ChatThread({ messages, isStreaming, streamingContent }: ChatThreadProps) {
  const listRef = useRef<FlatList<Message>>(null);
  // Scroll offset drives the lined paper so it moves WITH the messages (one sheet,
  // not a fixed backdrop). Native-driven for smoothness.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [contentH, setContentH] = useState(0);

  // Keep the newest message (and the streaming bubble) in view.
  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length, isStreaming, streamingContent]);

  if (messages.length === 0) {
    return (
      <View style={styles.container}>
        <NotebookBackground />
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
      {/* lined sheet sized to the content, translated by -scrollY so it scrolls
          with the messages (one continuous notebook page) */}
      <Animated.View
        style={[styles.paperLayer, { transform: [{ translateY: Animated.multiply(scrollY, -1) }] }]}
        pointerEvents="none"
      >
        <NotebookBackground height={Math.max(contentH, WINDOW_H) + WINDOW_H} />
      </Animated.View>
      <Animated.FlatList
        ref={listRef as never}
        data={messages}
        renderItem={({ item }: { item: Message }) => <MessageBubble message={item} />}
        keyExtractor={(item: Message, index: number) =>
          `${item.timestamp?.getTime() ?? index}-${index}`
        }
        contentContainerStyle={styles.messageList}
        onContentSizeChange={(_w: number, h: number) => {
          setContentH(h);
          listRef.current?.scrollToEnd({ animated: true });
        }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
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
      <Image source={HIRAIA_AVATAR} style={styles.avatar} />
      <View style={styles.streamingBubble}>
        {content ? (
          <RichText text={content} style={styles.streamingText} />
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
    overflow: 'hidden', // clip the translated paper layer
  },
  paperLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 48, // clearance so the newest line / streaming spinner fully clears the input (+20px so the responding indicator isn't hidden under the text field)
    gap: 16,
  },
  streamingRow: {
    flexDirection: 'row',
    maxWidth: '85%',
    alignSelf: 'flex-start',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 8,
    marginTop: 2,
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
