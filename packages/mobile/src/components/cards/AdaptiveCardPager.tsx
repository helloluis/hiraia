import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { Language } from '@hiraia/shared';
import { VerticalCardPager } from './VerticalCardPager';
import { feedViewport, railDestination, railOffset } from './adaptiveFeed';
import { useScreenReader } from './useScreenReader';
import { useReduceMotion } from './useReduceMotion';
import { Arrow } from './CardFrame';
import { uiStrings } from '../../config/strings';
import { card, fonts } from '../../theme';
import { ReaderInput } from '../../../modules/hiraia-reader-input/src';

export interface CardPagerProps<T extends { key: string }> {
  pages: T[];
  preview: T | null;
  liveKey: string;
  canAdvance: boolean;
  locked: boolean;
  onAdvance: () => void;
  onVisible: (live: boolean, key?: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  renderPage: (page: T, live: boolean, forward: () => void, visible: boolean, minimumHeight?: number) => ReactNode;
  renderHeader?: (navigation: ReactNode) => ReactNode;
  initialVisibleKey?: string;
  language: Language;
}

export function AdaptiveCardPager<T extends { key: string }>(props: CardPagerProps<T>) {
  const { width, fontScale } = useWindowDimensions();
  const reader = useScreenReader();
  const viewport = feedViewport(width, fontScale, reader);
  const visibleKey = useRef(props.initialVisibleKey ?? props.liveKey);
  const onVisible = (live: boolean, key?: string) => {
    if (key) visibleKey.current = key;
    props.onVisible(live, key);
  };
  const shared = { ...props, onVisible, initialVisibleKey: visibleKey.current };
  return viewport.horizontal
    ? <HorizontalCardPager {...shared} viewport={viewport} screenReader={reader} />
    : <>{props.renderHeader?.(null)}<VerticalCardPager {...shared} /></>;
}

function NavigationButton({ label, direction, disabled, onPress }: {
  label: string; direction: 'left' | 'right'; disabled: boolean; onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled }} disabled={disabled} focusable={!disabled}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress}
    style={({ pressed }) => [styles.button, disabled && styles.disabled,
      (focused || pressed) && styles.focused]}>
    <Arrow direction={direction} color={card.ink} />
  </Pressable>;
}

/** A reading desk: history + current + a half-width next page at ordinary text size.
 * The known sequence grows only when the child advances. At the start of a new session
 * there is no previous card; at quiz boundaries there is no invented future card.
 */
export function HorizontalCardPager<T extends { key: string }>({
  pages, preview, liveKey, canAdvance, locked, onAdvance, onVisible, onDragStart, onDragEnd,
  renderPage, renderHeader, initialVisibleKey = liveKey, language, viewport, screenReader,
}: CardPagerProps<T> & { viewport: ReturnType<typeof feedViewport>; screenReader: boolean }) {
  const list = useRef<FlatList<T>>(null);
  const [height, setHeight] = useState(0);
  const [visibleKey, setVisibleKey] = useState(initialVisibleKey);
  const visible = useRef(initialVisibleKey);
  const lastLive = useRef(liveKey);
  const dragging = useRef(false);
  const offset = useRef(0);
  const start = useRef({ offset: 0, index: 0 });
  const consumed = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useReduceMotion();
  const { stride, cardWidth, columns, anchor } = viewport;
  const t = uiStrings(language).cards;
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const jump = (index: number, animated = false) => {
    const page = pages[index];
    if (!page) return;
    visible.current = page.key;
    setVisibleKey(page.key);
    onVisible(page.key === liveKey, page.key);
    offset.current = railOffset(index, stride, anchor);
    list.current?.scrollToOffset({ offset: offset.current, animated: animated && !reduceMotion });
  };
  useLayoutEffect(() => {
    clearTimer();
    dragging.current = false;
    onDragEnd();
    if (lastLive.current !== liveKey) {
      lastLive.current = liveKey;
      consumed.current = null;
      visible.current = liveKey;
    }
    const index = pages.findIndex(p => p.key === visible.current);
    jump(index >= 0 ? index : pages.length - 1);
  }, [liveKey, stride, anchor, height, pages.length, pages[0]?.key]);
  useEffect(() => () => { clearTimer(); onDragEnd(); }, []);
  useEffect(() => {
    if (!locked) return;
    clearTimer();
    dragging.current = false;
    onDragEnd();
  }, [locked]);
  const requestAdvance = () => {
    if (locked || !canAdvance || consumed.current === liveKey) return;
    consumed.current = liveKey;
    onVisible(false);
    onAdvance();
    // Reviews may intercept a turn. Their modal owns the next action.
    clearTimer();
    timer.current = setTimeout(() => {
      if (lastLive.current !== liveKey) return;
      consumed.current = null;
      jump(pages.findIndex(p => p.key === liveKey));
    }, 180);
  };
  const navigate = (index: number) => {
    if (locked || dragging.current) return;
    if (index >= pages.length) requestAdvance();
    else jump(Math.max(0, index), true);
  };
  const settle = () => {
    if (!dragging.current) return;
    clearTimer();
    dragging.current = false;
    onDragEnd();
    const destination = railDestination(offset.current, start.current.offset, start.current.index,
      stride, pages.length, canAdvance && !locked && !!preview);
    if (destination.advance) requestAdvance();
    else jump(destination.index);
  };
  const beginDrag = () => {
    clearTimer();
    dragging.current = true;
    start.current = { offset: offset.current, index: Math.max(0, pages.findIndex(p => p.key === visible.current)) };
    onVisible(false);
    onDragStart();
  };
  const selectedIndex = Math.max(0, pages.findIndex(p => p.key === visibleKey));
  const data = canAdvance && !locked && preview ? [...pages, preview] : pages;
  const navigation = <View style={styles.controls}>
    <NavigationButton label={t.previousCard} direction="left" disabled={locked || selectedIndex === 0}
      onPress={() => navigate(selectedIndex - 1)} />
    <Text style={styles.position} accessibilityLiveRegion="polite">{selectedIndex + 1} / {pages.length}</Text>
    <NavigationButton label={t.nextCard} direction="right"
      disabled={locked || (selectedIndex === pages.length - 1 && !canAdvance)}
      onPress={() => navigate(selectedIndex + 1)} />
  </View>;
  return <ReaderInput style={styles.root} enabled={!locked}
    onNavigate={event => navigate(selectedIndex + event.nativeEvent.direction)}>
    {renderHeader ? renderHeader(navigation) : navigation}
    <View style={[styles.root, columns === 1 && { width: cardWidth + 32, alignSelf: 'center' }]}
      onLayout={event => setHeight(event.nativeEvent.layout.height)}>
      {height > 0 && <FlatList ref={list} horizontal data={data} keyExtractor={p => p.key}
        testID="horizontal-card-carousel" extraData={visibleKey}
        contentContainerStyle={{ paddingLeft: 16, paddingRight: Math.max(16, (columns - 1) * stride) }}
        snapToInterval={stride} decelerationRate="fast" disableIntervalMomentum
        scrollEnabled={!locked} nestedScrollEnabled directionalLockEnabled bounces={false}
        overScrollMode="never" showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled"
        getItemLayout={(_, index) => ({ length: stride, offset: stride * index, index })}
        initialNumToRender={4} maxToRenderPerBatch={4} windowSize={5}
        onScroll={event => { offset.current = event.nativeEvent.contentOffset.x; }} scrollEventThrottle={16}
        onScrollBeginDrag={beginDrag}
        onScrollEndDrag={event => {
          offset.current = event.nativeEvent.contentOffset.x;
          clearTimer(); timer.current = setTimeout(settle, 120);
        }}
        onMomentumScrollBegin={clearTimer}
        onMomentumScrollEnd={event => { offset.current = event.nativeEvent.contentOffset.x; settle(); }}
        onContentSizeChange={() => {
          if (!dragging.current) jump(pages.findIndex(p => p.key === visible.current));
        }}
        renderItem={({ item, index }) => {
          const speculative = index === pages.length;
          const active = item.key === visibleKey;
          return <View style={{ width: stride, height, paddingRight: 16, paddingTop: 3, paddingBottom: 12 }}>
            <ReaderInput style={[styles.page, { width: cardWidth }, active && styles.activePage]}
              blockDescendantFocus={locked || !active}
              collapsable={false}
              pointerEvents={locked || speculative || (screenReader && !active) ? 'none' : 'auto'}
              accessibilityElementsHidden={locked || speculative || (screenReader && !active)}
              importantForAccessibility={locked || speculative || (screenReader && !active) ? 'no-hide-descendants' : 'auto'}>
              <ScrollView nestedScrollEnabled style={styles.root}
                contentContainerStyle={{ flexGrow: 1, minHeight: height - 15 }}
                keyboardShouldPersistTaps="handled">
                {renderPage(item, item.key === liveKey, () => navigate(index + 1), active, height - 15)}
              </ScrollView>
            </ReaderInput>
          </View>;
        }} />}
    </View>
  </ReaderInput>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  page: { flex: 1, borderRadius: 20 },
  activePage: { outlineColor: card.gold, outlineWidth: 2, outlineOffset: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  button: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: 11, borderWidth: 3, borderColor: card.ink, backgroundColor: card.stock },
  focused: { backgroundColor: card.gold, borderColor: card.stock },
  disabled: { opacity: 0.45 },
  position: { minWidth: 46, textAlign: 'center', fontFamily: fonts.cardBody, fontSize: 14, color: card.stock },
});
