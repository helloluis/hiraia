import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Language } from '@hiraia/shared';
import type { LessonRecap } from '../../data/lessonRecap';
import { cardText, getCard, warmPage } from '../../data/cards';
import { card, fonts } from '../../theme';
import { CardPrint, TapTarget } from './CardFrame';

export function LessonRecapPage({
  content,
  language,
  onRepeat,
  onContinue,
}: {
  content: LessonRecap;
  language: Language;
  onRepeat: () => void;
  onContinue: () => void;
}) {
  const [ready, setReady] = useState(() =>
    content.cardIds.every((id) => {
      const fact = getCard(id);
      return !!fact && !!cardText(fact, language);
    })
  );
  useEffect(() => {
    let active = true;
    void warmPage(content.cardIds)
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [content]);
  const lang = language === 'tagalog' ? 'tl' : language === 'cebuano' ? 'bis' : 'en';
  const copy = {
    en: [
      'LET’S RECAP',
      'Here’s what we explored',
      'Explore again',
      'Try different examples when available.',
      'Swipe to the next section',
      'Loading recap…',
    ],
    tl: [
      'BALIK-ARAL',
      'Ito ang mga tinalakay natin',
      'Balikan natin',
      'Subukan ang ibang halimbawa kung mayroon pa.',
      'Mag-swipe para sa susunod na paksa',
      'Inihahanda ang balik-aral…',
    ],
    bis: [
      'PAGBALIK-ARAL',
      'Mao kini ang atong gihisgotan',
      'Balikon nato',
      'Sulayi ang ubang pananglitan kon aduna pa.',
      'Pag-swipe ngadto sa sunod nga hilisgutan',
      'Giandam ang pagbalik-aral…',
    ],
  }[lang];
  const points = ready
    ? [
        ...new Set(
          content.cardIds
            .map((id) => {
              const fact = getCard(id);
              return fact ? cardText(fact, language) : '';
            })
            .filter(Boolean)
        ),
      ]
    : [];
  return (
    <View style={styles.page}>
      <CardPrint />
      <Text style={styles.eyebrow}>{copy[0]}</Text>
      <Text accessibilityRole="header" style={styles.title}>
        {content.title[lang]}
      </Text>
      <Text style={styles.intro}>{copy[1]}</Text>
      <ScrollView style={styles.list} contentContainerStyle={styles.points} nestedScrollEnabled>
        {!ready && <Text style={styles.point}>{copy[5]}</Text>}
        {points.map((point, i) => (
          <Text key={point} style={styles.point}>
            {i + 1}. {point}
          </Text>
        ))}
      </ScrollView>
      <TapTarget onPress={onRepeat} style={() => styles.repeat}>
        <Text style={styles.button}>{copy[2]} ↻</Text>
      </TapTarget>
      <Text style={styles.hint}>{copy[3]}</Text>
      <TapTarget onPress={onContinue} style={() => styles.next}>
        <Text style={styles.button}>{copy[4]} →</Text>
      </TapTarget>
    </View>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 22, paddingTop: 38, paddingBottom: 18 },
  eyebrow: { fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 1.2, color: card.ink },
  title: {
    fontFamily: fonts.slab,
    fontSize: 26,
    lineHeight: 31,
    color: card.ink,
    marginVertical: 10,
  },
  intro: { fontFamily: fonts.slab, fontSize: 17, color: card.ink, marginBottom: 8 },
  list: { flex: 1 },
  points: { paddingBottom: 12, gap: 12 },
  point: { fontFamily: fonts.slab, fontSize: 17, lineHeight: 24, color: card.ink },
  repeat: {
    backgroundColor: card.gold,
    borderColor: card.ink,
    borderWidth: 2,
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
  },
  next: { paddingVertical: 10 },
  button: { fontFamily: fonts.slab, fontSize: 17, color: card.ink, textAlign: 'center' },
  hint: { fontSize: 12, textAlign: 'center', color: card.ink, marginTop: 6 },
});
