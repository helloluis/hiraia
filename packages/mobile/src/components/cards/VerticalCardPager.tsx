import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FlatList, View } from 'react-native';
import { scrollDestination } from './verticalFeed';

/** A native vertical list: history is above, one new page can be requested below. */
export function VerticalCardPager<T extends { key: string }>({
  pages,
  preview,
  liveKey,
  canAdvance,
  locked,
  onAdvance,
  onVisible,
  onDragStart,
  onDragEnd,
  renderPage,
}: {
  pages: T[];
  preview: T | null;
  liveKey: string;
  canAdvance: boolean;
  locked: boolean;
  onAdvance: () => void;
  onVisible: (live: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  renderPage: (page: T, live: boolean, forward: () => void, visible: boolean) => ReactNode;
}) {
  const list = useRef<FlatList<T>>(null);
  const [height, setHeight] = useState(0);
  const [visibleKey, setVisibleKey] = useState(liveKey);
  const visible = useRef(liveKey);
  const dragging = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offset = useRef(0);
  const consumed = useRef<string | null>(null);
  const previousLive = useRef(liveKey);
  const mounted = useRef(true);
  const previousHeight = useRef(0);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const jump = (index: number, animated = true) => {
    list.current?.scrollToOffset({ offset: index * height, animated });
    const key = pages[index]?.key;
    if (key) {
      visible.current = key;
      setVisibleKey(key);
      onVisible(key === liveKey);
    }
  };
  // A new store page follows a button tap or the trailing scroll slot. Offset updates also
  // preserve the same history page when the viewport changes or the oldest page is evicted.
  useLayoutEffect(() => {
    if (previousHeight.current !== height) {
      previousHeight.current = height;
      dragging.current = false;
      clearTimer();
      onDragEnd();
    }
    if (previousLive.current !== liveKey) {
      previousLive.current = liveKey;
      consumed.current = null;
      visible.current = liveKey;
      dragging.current = false;
      clearTimer();
      onDragEnd();
    }
    const index = pages.findIndex((p) => p.key === visible.current);
    if (index >= 0 && height > 0) jump(index, false);
  }, [liveKey, height, pages.length, pages[0]?.key]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      onDragEnd();
    };
  }, []);

  const requestAdvance = () => {
    if (locked || !canAdvance || consumed.current === liveKey) return;
    consumed.current = liveKey;
    onVisible(false);
    onAdvance();
    // A review can intercept navigation without changing the underlying page. Return
    // to it while the modal owns the next action; never strand an empty trailing slot.
    timer.current = setTimeout(() => {
      if (!mounted.current || previousLive.current !== liveKey) return;
      consumed.current = null;
      jump(
        Math.max(
          0,
          pages.findIndex((p) => p.key === liveKey)
        ),
        false
      );
    }, 180);
  };
  const settle = () => {
    if (!dragging.current) return;
    clearTimer();
    dragging.current = false;
    onDragEnd();
    const target = scrollDestination(
      offset.current,
      height,
      pages.length,
      canAdvance && !locked && !!preview
    );
    if (target.advance) requestAdvance();
    else jump(Math.min(target.index, pages.length - 1), false);
  };
  const data = canAdvance && !locked && preview ? [...pages, preview] : pages;
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      {height > 0 && (
        <FlatList
          ref={list}
          data={data}
          keyExtractor={(p) => p.key}
          pagingEnabled
          nestedScrollEnabled
          directionalLockEnabled
          scrollEnabled={!locked}
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={5}
          onScroll={(e) => {
            offset.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => {
            clearTimer();
            dragging.current = true;
            onVisible(false);
            onDragStart();
          }}
          onScrollEndDrag={(e) => {
            offset.current = e.nativeEvent.contentOffset.y;
            clearTimer();
            timer.current = setTimeout(settle, 120);
          }}
          onMomentumScrollBegin={clearTimer}
          onMomentumScrollEnd={(e) => {
            offset.current = e.nativeEvent.contentOffset.y;
            settle();
          }}
          onContentSizeChange={() => {
            if (!dragging.current) {
              const index = pages.findIndex((p) => p.key === visible.current);
              if (index >= 0) jump(index, false);
            }
          }}
          renderItem={({ item, index }) => (
            <View style={{ height, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10 }}>
              <View
                style={{ flex: 1 }}
                pointerEvents={index === pages.length ? 'none' : 'auto'}
                accessibilityElementsHidden={index === pages.length}
                importantForAccessibility={index === pages.length ? 'no-hide-descendants' : 'auto'}
              >
                {renderPage(
                  item,
                  item.key === liveKey,
                  () => {
                    if (dragging.current || locked || index === pages.length) return;
                    if (item.key === liveKey) requestAdvance();
                    else jump(Math.min(index + 1, pages.length - 1));
                  },
                  item.key === visibleKey
                )}
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}
