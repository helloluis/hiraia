import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { GradeLevel, Language } from '@hiraia/shared';

import { GRADE_OPTIONS } from '../../config/grades';
import { GRADE_BUTTON, Q_GRADE } from '../../config/onboarding';
import { colors, fonts } from '../../theme';
import { useTypewriter } from './useTypewriter';

const COLUMNS = 2;
// Bottom clearance for the carousel's absolutely-positioned BACK/NEXT bar (OnboardingCarousel
// navBar: bottom 20 + ~56 tall). It renders ABOVE the slides, so on a short 360×640 phone the
// centred grid's last row would otherwise sit under it and a tap on Grade 9/10 would hit NEXT.
const NAV_BAR_CLEARANCE = 80;

/**
 * Slide 2: "what grade are you in?" typewriters on in the language just picked on slide 1,
 * above a 2×4 grid of grade buttons (3–10) styled like the language options. The current
 * grade (Grade 5 by default — our kids are behind academically, so the tutor pitches low
 * unless told otherwise) is pre-highlighted; tapping any grade applies it and advances.
 */
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
  const typed = useTypewriter(Q_GRADE[language], { playKey: `${language}/${active ? 1 : 0}`, stepMs: 48 });

  const rows: GradeLevel[][] = [];
  for (let i = 0; i < GRADE_OPTIONS.length; i += COLUMNS) rows.push(GRADE_OPTIONS.slice(i, i + COLUMNS));

  return (
    <View style={styles.slide}>
      <Image source={require('../../../assets/hiraia-profile.png')} style={styles.avatar} />

      {/* fixed-height so the grid doesn't jump as the question types */}
      <View style={styles.questionBox}>
        <Text style={styles.question}>
          {typed}
          <Text style={styles.caret}>▍</Text>
        </Text>
      </View>

      <View style={styles.grid}>
        {rows.map((row) => (
          <View key={row[0]} style={styles.row}>
            {row.map((g) => {
              const isSelected = g === selected;
              return (
                <TouchableOpacity
                  key={g}
                  style={[styles.option, isSelected && styles.optionSelected]}
                  onPress={() => onPick(g)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                    {GRADE_BUTTON[language]} {g}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: NAV_BAR_CLEARANCE,
  },
  avatar: { width: 84, height: 84, borderRadius: 42, marginBottom: 16 },
  // two lines max ("Anong grade ka na?") — shorter than slide 1's box so the 4-row grid fits
  // above the nav bar on a 360×640 phone
  questionBox: { height: 80, justifyContent: 'center', marginBottom: 16 },
  question: {
    fontFamily: fonts.display,
    fontSize: 23,
    lineHeight: 32,
    color: colors.ink,
    textAlign: 'center',
  },
  caret: { color: colors.primary },
  grid: { width: '100%', gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 18,
    paddingVertical: 12,
  },
  optionSelected: { backgroundColor: colors.primary },
  optionLabel: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  optionLabelSelected: { color: colors.white },
});
