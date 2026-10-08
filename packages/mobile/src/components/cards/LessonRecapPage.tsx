import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { GradeLevel, Language } from '@hiraia/shared';
import type { LessonRecap } from '../../data/lessonRecap';
import {
  cardText,
  cardTitle,
  choiceLabel,
  getCard,
  warmPage,
  readingAvailability,
} from '../../data/cards';
import { suggestedCollections } from '../../data/lessonExploration';
import { card, fonts } from '../../theme';
import { Arrow, CardPrint, TapTarget } from './CardFrame';

export function LessonRecapPage({
  content,
  language,
  onRepeat,
  onReadMore,
  onExplore,
  seen,
  onContinue,
  readOnly = false,
}: {
  content: LessonRecap;
  language: Language;
  onRepeat: () => void;
  onReadMore: () => void;
  onExplore: (key: string) => void;
  seen: ReadonlySet<string>;
  onContinue: () => void;
  readOnly?: boolean;
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
  const availability = useMemo(
    () => readingAvailability(content.grade as GradeLevel, content.key, seen, content.run.shelfCat),
    [content, seen]
  );
  const suggestions = useMemo(
    () => suggestedCollections(content.grade, content.key, seen, (id) => getCard(id)?.factId ?? id),
    [content, seen]
  );
  const more = {
    en: [
      'Read more',
      '{count} unread cards',
      'You have read every card here.',
      'Explore more science',
      'Return to your lesson',
    ],
    tl: [
      'Magbasa pa',
      'Hindi pa nababasa: {count} kard',
      'Nabasa mo na ang lahat ng kard dito.',
      'Tumuklas pa sa agham',
      'Bumalik sa aralin',
    ],
    bis: [
      'Magbasa pa',
      'Wala pa mabasa: {count} ka kard',
      'Nabasa na nimo ang tanang kard dinhi.',
      'Susihon pa ang siyensya',
      'Balik sa leksiyon',
    ],
  }[lang];
  const copy = {
    en: [
      'LET’S RECAP',
      'Here’s what we explored',
      'Explore again',
      'Try different examples when available.',
      'Scroll down to the next section',
      'Loading recap…',
    ],
    tl: [
      'BALIK-ARAL',
      'Ito ang mga tinalakay natin',
      'Balikan natin',
      'Subukan ang ibang halimbawa kung mayroon pa.',
      'Mag-scroll pababa para sa susunod na paksa',
      'Inihahanda ang balik-aral…',
    ],
    bis: [
      'PAGBALIK-ARAL',
      'Mao kini ang atong gihisgotan',
      'Balikon nato',
      'Sulayi ang ubang pananglitan kon aduna pa.',
      'Pag-scroll paubos ngadto sa sunod nga hilisgutan',
      'Giandam ang pagbalik-aral…',
    ],
  }[lang];
  // Reuse short, localized labels rather than repeating every card's body text.
  // Sample across the completed section so the recap includes its later topics too.
  const concepts = new Map<string, string>();
  if (ready) {
    for (const id of content.cardIds) {
      const fact = getCard(id);
      if (!fact) continue;
      const title = cardTitle(fact, language).replace(/\s+/g, ' ').trim();
      const label =
        title && title.length <= 60 && title.split(' ').length <= 8
          ? title
          : choiceLabel(fact, language).trim();
      if (label && !concepts.has(label.toLowerCase())) concepts.set(label.toLowerCase(), label);
    }
  }
  const labels = [...concepts.values()];
  const points =
    labels.length <= 3
      ? labels
      : [labels[0], labels[Math.floor((labels.length - 1) / 2)], labels[labels.length - 1]];
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
        {!readOnly && suggestions.length > 0 && (
          <View style={styles.exploration}>
            <Text style={styles.explorationHeading}>{more[3]}</Text>
            {suggestions.map(({ collection, unread }) => (
              <TapTarget
                key={collection.key}
                onPress={() => onExplore(collection.key)}
                style={() => styles.collection}
              >
                <Text style={styles.button}>{collection.lesson.title[lang]} →</Text>
                <Text style={styles.hint}>{more[1]!.replace('{count}', String(unread))}</Text>
              </TapTarget>
            ))}
          </View>
        )}
      </ScrollView>
      {!readOnly && (
        <>
          {(availability.unread > 0 || !content.key.startsWith('explore:')) && (
            <TapTarget
              onPress={availability.unread ? onReadMore : onRepeat}
              style={() => styles.repeat}
            >
              <Text style={styles.button}>{availability.unread ? more[0] : copy[2]} →</Text>
            </TapTarget>
          )}
          <Text style={styles.hint}>
            {availability.unread
              ? more[1]!.replace('{count}', String(availability.unread))
              : more[2]}
          </Text>
        </>
      )}
      <TapTarget onPress={onContinue} style={() => styles.next}>
        <Text style={styles.button}>{content.run.mode === 'exploration' ? more[4] : copy[4]}</Text>
        <Arrow color={card.ink} />
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
  exploration: { gap: 8, marginTop: 12 },
  explorationHeading: { fontFamily: fonts.slab, fontSize: 17, color: card.ink },
  collection: {
    borderWidth: 1,
    borderColor: card.ink,
    borderRadius: 10,
    padding: 12,
    minHeight: 64,
  },
  point: { fontFamily: fonts.slab, fontSize: 17, lineHeight: 24, color: card.ink },
  repeat: {
    backgroundColor: card.gold,
    borderColor: card.ink,
    borderWidth: 2,
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
  },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  button: {
    flexShrink: 1,
    fontFamily: fonts.slab,
    fontSize: 17,
    color: card.ink,
    textAlign: 'center',
  },
  hint: { fontSize: 12, textAlign: 'center', color: card.ink, marginTop: 6 },
});
