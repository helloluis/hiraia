/**
 * Card 2 of the onboarding deck: "what grade are you in?" typewriters on in the language
 * just picked on card 1, above a 2×4 grid of grade plates (3–10). The current grade —
 * Grade 5 by default, because our kids are behind academically and the tutor pitches low
 * unless told otherwise — is pre-highlighted; tapping any grade applies it and advances.
 *
 * PRINTED ON the card surface OnboardingCarousel owns: this fills `cardFrame.content` and
 * adds the deck's shared die-cut (punched holes, keyline, index band), exactly as the feed
 * pages do. The grade plates use the same printing as card 1's language plates — peach
 * plate, 3px ink edge, on a ledge — with the CURRENT grade knocked out in ink, which is the
 * deck's loudest "this one is set" treatment (CardPage's `dKnockBox`) and, unlike gold or
 * the fork pair, carries no instruction of its own.
 */
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { GradeLevel, Language } from '@hiraia/shared';

import { GRADE_OPTIONS, GRADE_WORD } from '../../config/grades';
import { Q_GRADE, SLIDE_BAND } from '../../config/onboarding';
import { card, fonts } from '../../theme';
import { CardPrint, IndexBand, cardFrame } from '../cards/CardFrame';
import { useTypewriter } from './useTypewriter';

const COLUMNS = 2;

/** The mascot — the same alpha-cut PNG every card in the deck stamps its band with. */
const CAT = require('../../../assets/hiraia-profile.png');

export function GradeSlide({
  language,
  selected,
  active,
  onPick,
}: {
  language: Language;
  selected: GradeLevel;
  /** True while this slide is the one on screen — the question (re)types on arrival. */
  active: boolean;
  onPick: (grade: GradeLevel) => void;
}) {
  const typed = useTypewriter(Q_GRADE[language], {
    playKey: `${language}/${active ? 1 : 0}`,
    stepMs: 48,
  });

  const rows: GradeLevel[][] = [];
  for (let i = 0; i < GRADE_OPTIONS.length; i += COLUMNS)
    rows.push(GRADE_OPTIONS.slice(i, i + COLUMNS));

  return (
    <View style={cardFrame.content}>
      {/* keyline + punched binder holes — the deck's shared die-cut */}
      <CardPrint keyline="sage" />

      <IndexBand
        tone="ink"
        label={SLIDE_BAND[language].grade}
        stamp={<Image source={CAT} style={cardFrame.stampImage} resizeMode="contain" />}
      />

      <View style={styles.hero}>
        <View style={styles.disc}>
          <Image source={CAT} style={styles.discImage} resizeMode="contain" />
        </View>
        {/* fixed-height so the grid doesn't jump as the question types */}
        <View style={styles.questionBox}>
          <Text style={styles.question}>
            {typed}
            <Text style={styles.caret}>▍</Text>
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        {rows.map((row) => (
          <View key={row[0]} style={styles.row}>
            {row.map((g) => {
              const isSelected = g === selected;
              return (
                <View key={g} style={[cardFrame.rowLedge, styles.cell]}>
                  <TouchableOpacity
                    style={[styles.option, isSelected && styles.optionSelected]}
                    onPress={() => onPick(g)}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}
                      numberOfLines={1}
                    >
                      {GRADE_WORD[language]} {g}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  disc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: card.peach, // the warm mat every print in this deck sits on
    borderWidth: 3,
    borderColor: card.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  discImage: { width: 62, height: 62 },
  questionBox: { height: 76, justifyContent: 'center', marginTop: 12 },
  question: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 21,
    lineHeight: 28,
    color: card.ink, // 10.25:1 on cream stock
    textAlign: 'center',
  },
  // Quiet ink, 7.67:1 on stock. NOT `card.accent`: the palette reserves oxblood for the term
  // a card is teaching, and a caret teaches nothing (same call as LanguageSlide's).
  caret: { color: card.graphite },

  // ---- the 2x4 grade grid ----
  grid: { gap: 8, paddingTop: 12 },
  row: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1 },
  option: {
    minHeight: 44, // the touch minimum; the ledge under it adds 4 more
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: card.peach,
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 11,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  /** Knocked out of ink — the deck's "this one is set", and it borrows no signal colour. */
  optionSelected: { backgroundColor: card.ink },
  optionLabel: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 18,
    lineHeight: 23,
    color: card.ink, // 6.40:1 on peach
  },
  optionLabelSelected: { color: card.stock }, // 10.25:1 on ink
});
