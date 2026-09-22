/**
 * Card 3 of the onboarding deck — the START card, and the last one: the gold ticket that
 * dismisses the carousel, and nothing else to do.
 *
 * It used to be a looping animated tutorial — a mini deck being turned through four
 * tap/swipe beats, itself a replacement for an older chat mock. The loop is gone: the last
 * card of onboarding now just starts the app instead of running a lesson first, and the
 * deck's affordances are learned where they live, on the real cards. What survives is the
 * card itself and its ticket.
 *
 * PRINTED ON the card surface OnboardingCarousel owns: this fills `cardFrame.content` and
 * adds the deck's shared die-cut (punched holes, keyline, index band), exactly as the two
 * slides before it do.
 *
 * THE TICKET IS OUTSIZED on purpose. It is the deck's gold single-path continuation — the
 * same ink ledge, gold plate, 3px edge and boxed arrow as CardFrame's Ticket — but this
 * button is the only control on the card and the finger pressing it is a young child's, so
 * it is printed about half again the shared size. Built here from TapTarget + the card
 * palette rather than by growing Ticket itself: the feed's tickets keep their one size, and
 * the press-into-the-ledge behaviour still comes from the shared primitive.
 */
import { Image, StyleSheet, Text, View } from 'react-native';

import type { Language } from '@hiraia/shared';

import { DEMO_START, SLIDE_BAND } from '../../config/onboarding';
import { card, fonts } from '../../theme';
import { Arrow, CardPrint, IndexBand, TapTarget, cardFrame } from '../cards/CardFrame';

const CAT = require('../../../assets/hiraia-profile.png');

export function DemoSlide({
  language,
  onStart,
}: {
  language: Language;
  /** Part of the carousel's slide contract. Nothing animates here any more, so nothing
      gates on it — GradeSlide still uses its copy to (re)type the question. */
  active: boolean;
  onStart: () => void;
}) {
  return (
    <View style={cardFrame.content}>
      {/* keyline + punched binder holes — the deck's shared die-cut */}
      <CardPrint keyline="sage" />

      <IndexBand
        tone="ink"
        label={SLIDE_BAND[language].demo}
        stamp={<Image source={CAT} style={cardFrame.stampImage} resizeMode="contain" />}
      />

      {/* The cat on its peach-matted disc, as on the two cards before — without it the
          card is an empty frame around one button. Larger than the other slides' discs:
          it has the whole face of the card to itself. */}
      <View style={styles.hero}>
        <View style={styles.disc}>
          <Image source={CAT} style={styles.discImage} resizeMode="contain" />
        </View>
        <Text style={styles.instructions}>
          {language === 'english'
            ? 'Scroll down for the next card. Scroll up to revisit earlier cards.'
            : language === 'tagalog'
              ? 'Mag-scroll pababa para sa susunod na card. Mag-scroll pataas para balikan ang mga naunang card.'
              : 'Pag-scroll paubos para sa sunod nga card. Pag-scroll pataas aron balikan ang naunang mga card.'}
        </Text>
      </View>

      {/* The last — and only — action of onboarding. GOLD, because the deck reserves gold
          for the ordinary continuation and "start" is exactly that. The model download this
          card's ancestor once warned about still runs in the background from the language
          pick on card 1, so there is nothing to wait for and nothing else to say. */}
      <View style={styles.ticketLedge}>
        <TapTarget
          onPress={onStart}
          hitSlop={20}
          accessibilityLabel={DEMO_START[language]}
          style={(pressed) => [styles.ticket, pressed && styles.pressed]}
        >
          <Text style={styles.ticketWord} numberOfLines={1} ellipsizeMode="tail">
            {DEMO_START[language]}
          </Text>
          <View style={styles.arrowBox}>
            {/* the shared border-triangle has one printed size; scale it to the bigger box
                rather than reimplementing it */}
            <View style={styles.arrowScale}>
              <Arrow />
            </View>
          </View>
        </TapTarget>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  instructions: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 18,
    lineHeight: 25,
    color: card.ink,
    textAlign: 'center',
    marginTop: 22,
    paddingHorizontal: 12,
  },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  disc: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: card.peach, // the warm mat every print in this deck sits on
    borderWidth: 3,
    borderColor: card.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  discImage: { width: 82, height: 82 },

  // ---- the outsized START ticket: CardFrame's ticket vocabulary, scaled up ----
  ticketLedge: {
    backgroundColor: card.ink,
    borderRadius: 16,
    paddingBottom: 6, // the ledge itself — a darker parent, never a shadow
  },
  ticket: {
    minHeight: 84,
    backgroundColor: card.gold,
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingLeft: 18,
    paddingRight: 10,
  },
  pressed: { transform: [{ translateY: 2 }] }, // the ticket presses into its ledge
  ticketWord: {
    flex: 1,
    fontFamily: fonts.cardBodyBold,
    fontSize: 27,
    lineHeight: 32,
    color: card.ink, // 5.25:1 on gold
  },
  arrowBox: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: card.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowScale: { transform: [{ scale: 1.4 }] },
});
