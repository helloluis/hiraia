import { useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Language } from '@hiraia/shared';

import { colors, fonts } from '../../theme';
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
  // whether a language has been chosen — pre-set (re-watch from Settings) or picked here.
  // Gates NEXT on slide 1 so first-time kids must actually pick before moving on.
  const [chosen, setChosen] = useState(initialLanguage != null);

  const goTo = (i: number) => scrollRef.current?.scrollTo({ x: i * width, animated: true });

  const handlePick = (picked: Language) => {
    setLang(picked);
    setChosen(true);
    onPickLanguage(picked); // persists + starts loading the engine/model in the background
    goTo(1);
  };

  const showBack = index > 0;
  const showNext = (index === 0 && chosen) || index === 1;

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

      <View style={styles.navBar}>
        {/* BACK (left) */}
        {showBack ? (
          <TouchableOpacity style={styles.navBtn} onPress={() => goTo(index - 1)} activeOpacity={0.8}>
            <Text style={styles.navArrow}>←</Text>
            <Text style={styles.navText}>BACK</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.navSlot} />
        )}

        <View style={styles.dots}>
          {Array.from({ length: SLIDES }, (_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        {/* NEXT (right) — primary, so it reads as the main "keep going" action */}
        {showNext ? (
          <TouchableOpacity
            style={[styles.navBtn, styles.navBtnPrimary]}
            onPress={() => goTo(index + 1)}
            activeOpacity={0.8}
          >
            <Text style={styles.navTextPrimary}>NEXT</Text>
            <Text style={styles.navArrowPrimary}>→</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.navSlot} />
        )}
      </View>
    </SafeAreaView>
  );
}

const NAV_SLOT_W = 116; // keeps the dots centered whether or not a button is present

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.paper, zIndex: 100 },
  navBar: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  navSlot: { width: NAV_SLOT_W },
  navBtn: {
    width: NAV_SLOT_W,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.white,
  },
  navBtnPrimary: { backgroundColor: colors.primary },
  navArrow: { fontSize: 20, color: colors.primary, fontWeight: '700' },
  navText: { fontFamily: fonts.display, fontSize: 18, color: colors.primary, letterSpacing: 1 },
  navArrowPrimary: { fontSize: 20, color: colors.white, fontWeight: '700' },
  navTextPrimary: { fontFamily: fonts.display, fontSize: 18, color: colors.white, letterSpacing: 1 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.hairline },
  dotActive: { backgroundColor: colors.primary, width: 22 },
});
