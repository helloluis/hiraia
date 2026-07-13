/**
 * One notebook page of the question-cards feed: illustration + the fact, typewritered
 * onto a blank page, with the two blue-ink "teacher's note" choices at the bottom
 * corners. Tap anywhere while typing → complete instantly (visual-novel convention).
 *
 * Typography reacts to content length: short facts go BIG in felt marker (centered),
 * long facts settle into smaller handwriting (top-left). The typewriter renders the
 * full text invisibly to reserve layout, revealing a prefix — so centered text never
 * re-wraps/jumps as it types.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Language } from '@hiraia/shared';

import { cardText, type CardChoice, type CardFact } from '../../data/cards';
import { colors, fonts, notebook } from '../../theme';
import { ImageSlot } from '../ImageSlot';

// Content starts to the RIGHT of the red margin rule (the notebook's gutter), like a
// child writing inside the margin. `+14` is the writing gutter past the rule.
const GUTTER_LEFT = notebook.marginX + 14;

const CHARS_PER_TICK = 5;
const TICK_MS = 24; // ≈ 210 chars/s — a card lands in ~1s; tap to finish instantly

interface Tier {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  textAlign: 'center' | 'left';
  centered: boolean; // vertical centering + image size
}

function tierFor(text: string): Tier {
  const n = text.length;
  if (n <= 70) return { fontFamily: fonts.marker, fontSize: 30, lineHeight: 44, textAlign: 'center', centered: true };
  if (n <= 150) return { fontFamily: fonts.display, fontSize: 27, lineHeight: 38, textAlign: 'center', centered: true };
  if (n <= 260) return { fontFamily: fonts.body, fontSize: 20, lineHeight: 30, textAlign: 'left', centered: false };
  return { fontFamily: fonts.body, fontSize: 17, lineHeight: 26, textAlign: 'left', centered: false };
}

interface CardPageProps {
  fact: CardFact;
  choices: CardChoice[];
  language: Language;
  onChoose: (choice: CardChoice) => void;
  /** Render fully typed with no animation (the outgoing page during the flip). */
  instant?: boolean;
}

export function CardPage({ fact, choices, language, onChoose, instant = false }: CardPageProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8); // clear the Android nav bar
  const text = cardText(fact, language);
  const tier = tierFor(text);
  const [shown, setShown] = useState(instant ? text.length : 0);
  const done = shown >= text.length;
  const extrasOpacity = useRef(new Animated.Value(instant ? 1 : 0)).current;

  // typewriter (starts shortly after mount, i.e. as the page flip settles)
  useEffect(() => {
    if (instant) return;
    let i = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      i += CHARS_PER_TICK;
      setShown((prev) => (prev >= text.length ? prev : i));
      if (i < text.length) setTimeout(tick, TICK_MS);
    };
    const start = setTimeout(tick, 260);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fact.id, instant]);

  // image + choices fade in once the text lands
  useEffect(() => {
    if (done) {
      Animated.timing(extrasOpacity, { toValue: 1, duration: 240, useNativeDriver: true }).start();
    }
  }, [done, extrasOpacity]);

  const skip = () => {
    if (!done) setShown(text.length);
  };

  const visible = text.slice(0, Math.min(shown, text.length));
  const hidden = text.slice(Math.min(shown, text.length));

  return (
    <Pressable style={[styles.page, { paddingBottom: 78 + bottomPad }]} onPress={skip} disabled={done}>
      <View style={[styles.content, tier.centered ? styles.contentCentered : styles.contentTop]}>
        <Animated.View style={[styles.imageWrap, { opacity: extrasOpacity, width: tier.centered ? 250 : 190 }]}>
          <ImageSlot desc={fact.topic} slug={fact.slug} />
        </Animated.View>
        <Text
          style={{
            fontFamily: tier.fontFamily,
            fontSize: tier.fontSize,
            lineHeight: tier.lineHeight,
            textAlign: tier.textAlign,
            color: colors.ink,
            marginTop: 14,
          }}
        >
          {visible}
          <Text style={styles.unrevealed}>{hidden}</Text>
        </Text>
      </View>

      {/* the two teacher's-note choices, blue ink, bottom corners */}
      <Animated.View style={[styles.choicesRow, { bottom: 12 + bottomPad, opacity: extrasOpacity }]} pointerEvents={done ? 'auto' : 'none'}>
        {choices[0] && (
          <Pressable onPress={() => onChoose(choices[0]!)} hitSlop={14} style={[styles.choice, styles.choiceLeft]}>
            <Text style={styles.choiceText} numberOfLines={1}>
              {choices[0].label} <Text style={styles.choiceArrow}>⤴</Text>
            </Text>
          </Pressable>
        )}
        {choices[1] && (
          <Pressable onPress={() => onChoose(choices[1]!)} hitSlop={14} style={[styles.choice, styles.choiceRight]}>
            <Text style={styles.choiceText} numberOfLines={1}>
              {choices[1].label} <Text style={styles.choiceArrow}>⤴</Text>
            </Text>
          </Pressable>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    paddingLeft: GUTTER_LEFT, // stay right of the red margin rule
    paddingRight: 26,
    paddingTop: 8,
    // paddingBottom applied inline (78 + bottom safe-area inset) so content clears both
    // the choice notes and the Android nav bar.
  },
  content: {
    flex: 1,
  },
  contentCentered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentTop: {
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    paddingTop: 8,
  },
  imageWrap: {
    alignSelf: 'center',
  },
  unrevealed: {
    opacity: 0, // reserves layout so centered text doesn't re-wrap while typing
  },
  choicesRow: {
    position: 'absolute',
    left: GUTTER_LEFT, // left teacher's-note stays right of the margin rule too
    right: 22,
    // bottom applied inline (12 + bottom safe-area inset) to clear the Android nav bar.
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  choice: {
    maxWidth: '46%',
    borderBottomWidth: 1.5,
    borderBottomColor: colors.inkBlue,
    paddingBottom: 1,
  },
  choiceLeft: {
    transform: [{ rotate: '-2deg' }],
  },
  choiceRight: {
    transform: [{ rotate: '1.5deg' }],
  },
  choiceText: {
    fontFamily: fonts.display,
    fontSize: 23,
    color: colors.inkBlue,
  },
  choiceArrow: {
    fontSize: 16,
  },
});
