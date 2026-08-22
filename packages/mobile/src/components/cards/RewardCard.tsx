/**
 * Reward interject page of the question-cards feed: a periodic (jittered 15-25 cards)
 * celebration of how much the kid just learned, naming a few real recent topics. The warm
 * line is LLM-generated when the (background-warmed) model is ready, else a deterministic
 * template — but the topic NAMES always come from the real view-log, so it never fabricates
 * what they learned. A gold "ituloy" ticket resumes the walk onto the card they'd chosen.
 *
 * LOOK — design/mockups/midcentury.html. The mockup draws four frames and this is not one
 * of them, so every treatment below is DERIVED from one that is, and each is credited
 * inline. In short: an ordinary card of the same deck, recoloured GOLD the way frame 04
 * recolours the quiz card's band and keyline to mark an interject, with the cat promoted
 * from its 26px band stamp to the big peach-matted disc that frame gives it (.qcat). Gold
 * rather than the quiz's teal stock, which is reserved for actual quizzes.
 *
 * CardFeedScreen owns the card SURFACE — stock, the 3px ink edge, the rounded corners, the
 * ledge and the board it lies on — and clips page content to it. This file prints ON that
 * surface only: keyline, punched holes, index band, type, ticket. Same division as
 * CardPage. Every "shadow" is a ledge (a darker parent View with a few px of bottom
 * padding), because RN on Android ignores shadowOffset and honours only `elevation`.
 */
import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';

import type { Language } from '@hiraia/shared';

import { uiStrings } from '../../config/strings';
import type { RewardContent } from '../../data/reward';
import { card, fonts } from '../../theme';
import { CardPrint, Divider, IndexBand, Ticket, cardFrame } from './CardFrame';

/** The mascot — the same alpha-cut PNG the chat avatar and every other card use. */
const CAT = require('../../../assets/hiraia-profile.png');

/**
 * The index-band label. Local to this component rather than in config/strings.ts, the way
 * QuestionPage keeps its own printed furniture: it is a set-in-metal label belonging to
 * ONE card type, not app copy another screen shares. It names what the number chip beside
 * it counts (cards read in this stretch) and echoes the phrasing data/reward.ts already
 * uses for the body line, so band and body never contradict each other.
 */
const BAND_LABEL: Record<Language, string> = {
  tagalog: 'Natutunan mo',
  english: 'What you learned',
  cebuano: 'Imong nakat-onan',
};

/**
 * The reward line's type ramp: steps off `string.length` alone, no onLayout measurement
 * pass — the runtime advantage this direction was picked for. CardPage runs the factoid
 * body at 16.5/15/14/13; this line is a single warm sentence and the page's headline, so
 * it sits a step or two above that ramp, in the register of the mockup's centred .qq
 * (22px) rather than its .fact.
 */
function rewardTier(text: string): { fontSize: number; lineHeight: number } {
  const n = text.length;
  if (n <= 80) return { fontSize: 22, lineHeight: 28 };
  if (n <= 160) return { fontSize: 19, lineHeight: 25 };
  return { fontSize: 16.5, lineHeight: 22 };
}

export function RewardCard({
  reward,
  language,
  onContinue,
}: {
  reward: RewardContent;
  language: Language;
  onContinue: () => void;
}) {
  const t = uiStrings(language);

  // The gentle pop-in is unchanged — it just carries the cat disc now instead of a 🌟.
  // Android renders emoji in full colour, which breaks the ten-colour palette on sight,
  // and the mascot is the mockup's own hero for an interject page.
  const scale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 70, useNativeDriver: true }).start();
  }, [scale]);

  return (
    <View style={cardFrame.content}>
      {/* keyline + punched binder holes; the keyline goes gold, as .k-quiz does on the
          interject frame */}
      <CardPrint keyline="gold" />

      {/* Index band, gold (.band.b-quiz), its chip inverted to gold-on-ink. A factoid
          card's chip carries the card's catalogue number; the number that belongs to THIS
          page is how many cards the kid just read, and the label beside it names what that
          number counts. Both come straight from the view-log — the card can't claim more
          than the data does. */}
      <IndexBand
        tone="gold"
        chip={String(reward.count)}
        label={BAND_LABEL[language]}
        stamp={<Image source={CAT} style={cardFrame.stampImage} resizeMode="contain" />}
      />

      <View style={styles.center}>
        {/* .qcat — the 88px peach-matted disc with the 3px ink edge. On the quiz frame it
            is the cat stepping forward to announce an interruption; the reward is the
            other interruption, so it gets the same entrance. */}
        <Animated.View style={[styles.disc, { transform: [{ scale }] }]}>
          <Image source={CAT} style={styles.discImage} resizeMode="contain" />
        </Animated.View>

        <Text style={[styles.body, rewardTier(reward.text)]}>{reward.text}</Text>

        {reward.topics.length > 0 && (
          <>
            {/* the printed rule + gold diamond that introduces an answer everywhere in the
                deck; here it separates the warm line from the receipts under it */}
            <Divider style={styles.divider} />
            <View style={styles.chips}>
              {reward.topics.map((tp) => (
                // Derived from .pick: a printed label plate — coloured fill, ink edge,
                // cream type. Olive, not gold, so the topics never compete with the one
                // gold ticket, which is the only thing on the card to press.
                <View key={tp} style={styles.chip}>
                  <Text style={styles.chipText} numberOfLines={1}>
                    {tp}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
      </View>

      {/* .foot > .ledge > .tab — the continue ticket, same gold ticket as every other page
          of the deck (gold is the palette's single-path continuation). hitSlop is
          unchanged from the ink note this replaces. */}
      <Ticket
        label={t.cards.continueNote}
        onPress={onContinue}
        hitSlop={20}
        style={styles.ticketGap}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // ---- the celebration ----
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  disc: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: card.peach, // the warm mat every print in this deck sits on
    borderWidth: 3,
    borderColor: card.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 14,
  },
  discImage: { width: 76, height: 76 },
  body: {
    // Zilla Slab. Only the 400 and 700 static TTFs are bundled, so the mockup's 500/600
    // round to the regular and its 700 to the bold; this line is the page's headline, so
    // it takes the bold. Size and leading come from rewardTier().
    fontFamily: fonts.cardBodyBold,
    color: card.ink,
    textAlign: 'center',
  },
  divider: { alignSelf: 'stretch', marginTop: 14, marginBottom: 12 },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    backgroundColor: card.olive,
    borderWidth: 2,
    borderColor: card.ink,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '80%',
  },
  chipText: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 14,
    color: card.stock, // cream on a coloured fill, per the palette — 4.79:1 on olive
  },
  ticketGap: { marginTop: 12 },
});
