import { useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Language } from '@hiraia/shared';

import { colors } from '../../theme';
import { NotebookBackground } from '../NotebookBackground';
import { DemoSlide } from './DemoSlide';
import { DownloadSlide } from './DownloadSlide';
import { LanguageSlide } from './LanguageSlide';

const SLIDES = 3;

/**
 * The onboarding carousel (first launch + Settings → "show tutorial"). Three swipeable
 * slides: language pick → chat demo → download notice. Picking a language on slide 1
 * fires `onPickLanguage` (which starts the model download in the background) and advances
 * to slide 2, so the wait overlaps the tutorial. `onFinish` (slide-3 OK) dismisses it.
 * The user can swipe back to any earlier slide at any time.
 */
export function OnboardingCarousel({
  onPickLanguage,
  onFinish,
  initialLanguage,
}: {
  onPickLanguage: (lang: Language) => void;
  onFinish: () => void;
  initialLanguage?: Language | null;
}) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  // language driving slides 2-3 copy; defaults to the saved language (re-trigger) or TL.
  const [lang, setLang] = useState<Language>(initialLanguage ?? 'tagalog');

  const goTo = (i: number) => scrollRef.current?.scrollTo({ x: i * width, animated: true });

  const handlePick = (picked: Language) => {
    setLang(picked);
    onPickLanguage(picked); // persists + starts loading the engine/model in the background
    goTo(1);
  };

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));

  return (
    <SafeAreaView style={styles.overlay}>
      <NotebookBackground />
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width }}>
          <LanguageSlide onPick={handlePick} />
        </View>
        <View style={{ width }}>
          <DemoSlide language={lang} />
        </View>
        <View style={{ width }}>
          <DownloadSlide language={lang} onDone={onFinish} />
        </View>
      </ScrollView>

      <View style={styles.dots}>
        {Array.from({ length: SLIDES }, (_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.paper, zIndex: 100 },
  dots: {
    position: 'absolute',
    bottom: 28,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.hairline },
  dotActive: { backgroundColor: colors.primary, width: 22 },
});
