import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { Message } from '@hiraia/shared';

import { uiStrings } from '../config/strings';
import { useEngineStore } from '../store/engineStore';
import { colors, fonts } from '../theme';

import { MessageBubble } from './MessageBubble';
import { NotebookBackground } from './NotebookBackground';
import { RichText } from './RichText';
import { ThinkingIndicator } from './ThinkingIndicator';

const HIRAIA_AVATAR = require('../../assets/hiraia-profile.png');
const WINDOW_H = Dimensions.get('window').height;
// How close to the bottom (px) still counts as "following the stream". Within this
// slack we keep auto-scrolling; scroll up past it and we stop fighting the user.
const STICK_SLOP = 48;

// A chat row is either a message or a centered date page-break ("June 14, 2026") so a
// kid can scroll and find an old exchange by day.
type Row = { kind: 'date'; key: string; label: string } | { kind: 'msg'; key: string; message: Message };

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const formatDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/** Build the render list, inserting a date divider before each new day's first message. */
function withDateDividers(messages: Message[]): Row[] {
  const out: Row[] = [];
  let lastDay: string | null = null;
  messages.forEach((m, idx) => {
    const ts = m.timestamp ?? new Date();
    const k = dayKey(ts);
    if (k !== lastDay) {
      lastDay = k;
      out.push({ kind: 'date', key: `date-${k}`, label: formatDay(ts) });
    }
    out.push({ kind: 'msg', key: `${ts.getTime?.() ?? idx}-${idx}`, message: m });
  });
  return out;
}

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
  // Whether to keep following new content. True while the user is at/near the bottom;
  // flips false the moment they scroll up to re-read, so a streaming reply never yanks
  // the viewport back. Updated from onScroll.
  const stickToBottom = useRef(true);
  // The floating "jump to newest" arrow: shown once the user is more than ONE screen up;
  // blinks while a reply is actively printing (something new below to read).
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const prevStreaming = useRef(false);
  const blink = useRef(new Animated.Value(1)).current;
  const isPrinting = !!streamingContent; // the answer is actively streaming tokens
  const t = uiStrings(useEngineStore((s) => s.language));
  const rows = useMemo(() => withDateDividers(messages), [messages]);

  const scrollToBottom = (animated = true) => {
    stickToBottom.current = true;
    setShowScrollBtn(false);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  };

  // Follow a new message ONLY if the user is still at the bottom — never yank them down
  // when they've scrolled up to read; the floating arrow handles that case instead.
  useEffect(() => {
    if (messages.length > 0 && stickToBottom.current) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  // When the "thinking…" narration first begins, reveal it with ONE auto-scroll. After
  // that we respect wherever the user scrolls (only-once, per the UX spec).
  useEffect(() => {
    if (isStreaming && !prevStreaming.current) scrollToBottom(true);
    prevStreaming.current = !!isStreaming;
  }, [isStreaming]);

  // Blink the arrow while the reply prints (and the user is scrolled up); steady otherwise.
  useEffect(() => {
    if (showScrollBtn && isPrinting) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(blink, { toValue: 0.25, duration: 500, useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => {
        loop.stop();
        blink.setValue(1);
      };
    }
    blink.setValue(1);
    return undefined;
  }, [showScrollBtn, isPrinting, blink]);

  if (messages.length === 0) {
    return (
      <View style={styles.container}>
        <NotebookBackground />
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t.welcomeTitle}</Text>
          <Text style={styles.emptySubtitle}>{t.welcomeSubtitle}</Text>
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
        data={rows}
        renderItem={({ item }: { item: Row }) =>
          item.kind === 'date' ? (
            <DateDivider label={item.label} />
          ) : (
            <MessageBubble message={item.message} />
          )
        }
        keyExtractor={(item: Row) => item.key}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={(_w: number, h: number) => {
          setContentH(h);
          // Only follow the growing stream when the user is already at the bottom. If
          // the newest line is already in view (they scrolled to it), leave it be. The
          // 10px breathing room below the new line comes from messageList paddingBottom.
          if (stickToBottom.current) {
            requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
          }
        }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
          // Track whether the user is following the bottom; if they scroll up past the
          // slack, stop auto-following so the stream doesn't fight them.
          listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
            stickToBottom.current = distanceFromBottom <= STICK_SLOP;
            // Floating "jump to newest" arrow once the user is more than one full screen up.
            const scrolledFar = distanceFromBottom > layoutMeasurement.height;
            setShowScrollBtn((prev) => (prev !== scrolledFar ? scrolledFar : prev));
          },
        })}
        scrollEventThrottle={16}
        ListFooterComponent={
          isStreaming ? <StreamingBubble content={streamingContent ?? ''} /> : null
        }
      />
      {showScrollBtn && (
        <Animated.View style={[styles.scrollFab, { opacity: blink }]} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.scrollFabBtn}
            onPress={() => scrollToBottom(true)}
            activeOpacity={0.8}
            accessibilityLabel="Pumunta sa pinakabagong mensahe"
          >
            <Text style={styles.scrollFabIcon}>↓</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
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
          <ThinkingIndicator />
        )}
      </View>
    </View>
  );
}

/** A centered, underlined date page-break between days of messages. */
function DateDivider({ label }: { label: string }) {
  return (
    <View style={styles.dateDividerRow}>
      <Text style={styles.dateDividerText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden', // clip the translated paper layer
  },
  dateDividerRow: {
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 4,
  },
  dateDividerText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.inkMuted,
    textDecorationLine: 'underline',
    letterSpacing: 0.3,
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
    paddingBottom: 58, // clearance so the newest line / streaming spinner clears the input, +10px breathing room above it while streaming
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
  scrollFab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
  scrollFabBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  scrollFabIcon: {
    color: colors.white,
    fontSize: 24,
    lineHeight: 26,
    fontWeight: '700',
  },
});
