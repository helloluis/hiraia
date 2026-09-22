import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Language } from '@hiraia/shared';
import type { TitleCardContent } from '../../data/titleCard';
import { useArtSource } from '../../data/artSource';
import { card, fonts } from '../../theme';
import { Arrow, TapTarget, CardPrint } from './CardFrame';

function Thumbnail({ slug }: { slug: string }) {
  const source = useArtSource(slug);
  return source ? (
    <View style={styles.thumb}>
      <Image source={source} resizeMode="contain" style={styles.image} accessible={false} />
    </View>
  ) : null;
}
export function TitleCardPage({
  content,
  language,
  onContinue,
}: {
  content: TitleCardContent;
  language: Language;
  onContinue: () => void;
}) {
  const title =
    content.title[language === 'tagalog' ? 'tl' : language === 'cebuano' ? 'bis' : 'en'];
  return (
    <View style={styles.page}>
      <CardPrint />
      <ScrollView nestedScrollEnabled contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>
          {language === 'english' ? 'QUARTER' : 'MARKAHAN'} {content.quarter} ·{' '}
          {content.category.toUpperCase()}
        </Text>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <View style={styles.thumbnails}>
          {content.slugs.map((slug) => (
            <Thumbnail key={slug} slug={slug} />
          ))}
        </View>
      </ScrollView>
      <TapTarget onPress={onContinue} style={() => styles.button}>
        <Text style={styles.buttonText}>
          {language === 'english'
            ? 'Let’s begin'
            : language === 'tagalog'
              ? 'Simulan natin'
              : 'Magsugod kita'}
        </Text>
        <Arrow color={card.ink} />
      </TapTarget>
    </View>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 22, paddingTop: 38, paddingBottom: 28 },
  content: { flexGrow: 1, justifyContent: 'center', paddingVertical: 16 },
  eyebrow: {
    fontFamily: 'sans-serif',
    fontSize: 11,
    letterSpacing: 1.2,
    color: card.ink,
    textAlign: 'center',
  },
  title: {
    fontFamily: fonts.slab,
    fontSize: 38,
    lineHeight: 44,
    color: card.ink,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 28,
  },
  thumbnails: { flexDirection: 'row', justifyContent: 'center', gap: 9 },
  thumb: {
    flex: 1,
    maxWidth: 96,
    aspectRatio: 1,
    padding: 6,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: card.ink,
  },
  image: { width: '100%', height: '100%' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: card.gold,
    borderColor: card.ink,
    borderWidth: 3,
    borderRadius: 12,
    padding: 12,
  },
  buttonText: {
    flexShrink: 1,
    fontFamily: fonts.slab,
    fontSize: 19,
    color: card.ink,
    textAlign: 'center',
  },
});
