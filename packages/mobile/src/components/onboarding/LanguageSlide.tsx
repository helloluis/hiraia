/**
 * Card 1 of the onboarding deck: "how do you want to use Hiraia?" typewriters on, cycling
 * Tagalog → English → (loop), each replacing the last; three language plates (each written
 * in its own language) below.
 *
 * PRINTED ON the card surface OnboardingCarousel owns — this component fills that surface's
 * content box (`cardFrame.content`) exactly as CardPage/QuestionPage/RewardCard do, and adds
 * the deck's shared die-cut: punched binder holes, the printed keyline, the index band with
 * the cat stamp. Every colour comes from `card` in theme.ts.
 *
 * The three language plates are printed the way the deck prints "pick one of N" — a plate
 * with a 3px ink edge on a ledge, as QuestionPage's answer rows are — NOT in the fork
 * colours (forkA/forkB mean a two-way branch of the thread) and not in gold (which means
 * "keep going"). They take the mat's own peach so they read as printed plates on the cream
 * stock: ink on peach measures 6.40:1.
 */
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { Language } from '@hiraia/shared';

import { LANG_BUTTON, LANG_CYCLE, Q_HOW_USE, SLIDE_BAND } from '../../config/onboarding';
import { LANGUAGE_OPTIONS } from '../../config/languages';
import { card, fonts } from '../../theme';
import { Arrow, CardPrint, IndexBand, cardFrame } from '../cards/CardFrame';
import { useTypewriter } from './useTypewriter';

const HOLD_MS = 1500; // how long a fully-typed question lingers before the next language

/** The mascot — the same alpha-cut PNG every card in the deck stamps its band with. */
const CAT = require('../../../assets/hiraia-profile.png');

export function LanguageSlide({ onPick }: { onPick: (lang: Language) => void }) {
  const [cycle, setCycle] = useState(0);
  const lang = LANG_CYCLE[cycle % LANG_CYCLE.length]!;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const typed = useTypewriter(Q_HOW_USE[lang], {
    playKey: cycle,
    stepMs: 48,
    onDone: () => {
      holdTimer.current = setTimeout(() => setCycle((c) => c + 1), HOLD_MS);
    },
  });

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    []
  );

  return (
    <View style={cardFrame.content}>
      {/* keyline + punched binder holes — the deck's shared die-cut */}
      <CardPrint keyline="sage" />

      {/* No language has been chosen yet, so the band label rides the same cycle the
          question does: it says WIKA while the Tagalog question is up, LANGUAGE while the
          English one is. */}
      <IndexBand
        tone="ink"
        label={SLIDE_BAND[lang].language}
        stamp={<Image source={CAT} style={cardFrame.stampImage} resizeMode="contain" />}
      />

      <View style={styles.hero}>
        {/* the peach-matted disc the deck gives the cat whenever it is the one speaking
            (QuestionPage's .qcat, RewardCard's disc) */}
        <View style={styles.disc}>
          <Image source={CAT} style={styles.discImage} resizeMode="contain" />
        </View>
        {/* Set in CAPS to match CardFeedScreen's wordmark exactly — the board this hands
            off to prints `HIRAIA.`, and the brand should not change case between the first
            screen a child sees and the second. Bigger here (28 vs 16), which is fine. */}
        <Text style={styles.brand}>
          HIRAIA<Text style={styles.brandDot}>.</Text>
        </Text>

        {/* fixed-height so the plates don't jump as the question retypes */}
        <View style={styles.questionBox}>
          <Text style={styles.question}>
            {typed}
            <Text style={styles.caret}>▍</Text>
          </Text>
        </View>
      </View>

      <View style={styles.options}>
        {LANGUAGE_OPTIONS.map((opt) => (
          <View key={opt.lang} style={opt.comingSoon ? undefined : cardFrame.rowLedge}>
            <TouchableOpacity
              style={[styles.option, opt.comingSoon && styles.optionComingSoon]}
              onPress={() => onPick(opt.lang)}
              disabled={opt.comingSoon}
              activeOpacity={0.85}
            >
              <Text
                style={[styles.optionLabel, opt.comingSoon && styles.optionLabelComingSoon]}
                numberOfLines={1}
              >
                {LANG_BUTTON[opt.lang]}
              </Text>
              {opt.beta && (
                <View style={styles.betaPill}>
                  <Text style={styles.pillText}>beta</Text>
                </View>
              )}
              {opt.comingSoon ? (
                <View style={styles.soonPill}>
                  <Text style={styles.pillText}>hapit na!</Text>
                </View>
              ) : (
                <Arrow color={card.ink} />
              )}
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // ---- the cat, the wordmark and the cycling question ----
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  disc: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: card.peach, // the warm mat every print in this deck sits on
    borderWidth: 3,
    borderColor: card.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  discImage: { width: 65, height: 65 },
  brand: {
    // The fat Clarendon slab the feed sets its wordmark in, so the brand reads the same on
    // the first screen as it does on the board afterwards.
    fontFamily: fonts.slab,
    fontSize: 28,
    color: card.ink,
    letterSpacing: 0.4,
    marginTop: 10,
  },
  /**
   * The feed's dot is gold, but gold measures 1.95:1 on cream stock and simply disappears,
   * so on-card it has to be some other colour. Press graphite, NOT the oxblood accent:
   * theme.ts reserves `card.accent` for the one mark that names the term a card is TEACHING,
   * and a wordmark's full stop teaches nothing — spending the accent here would dilute the
   * only semantic the palette gives it. Graphite is the deck's quiet ink and carries no
   * instruction at all. 7.67:1 on stock.
   */
  brandDot: { color: card.graphite },
  /**
   * 76, matching GradeSlide's identical box: both questions wrap to 2 lines at this size in
   * every language they cycle through (the longest, 'Paano mo gustong gamitin ang Hiraia?',
   * is 35 characters against ~27 per line in the 288dp box), so 76 holds 2x28 with slack.
   * The 12 it gives back matters because `hero` is the thing that overflows on a 640dp-tall
   * panel, and `cardLayer` clips — the overflow would shave the top off the cat's disc.
   */
  questionBox: { height: 76, justifyContent: 'center', marginTop: 12 },
  question: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 21,
    lineHeight: 28,
    color: card.ink, // 10.25:1 on cream stock
    textAlign: 'center',
  },
  // A blinking caret is neither an instruction nor an emphasis, so it takes the deck's quiet
  // ink — not `card.accent`, which the palette reserves for the term a card is teaching.
  // 7.67:1 on stock.
  caret: { color: card.graphite },

  // ---- the three language plates ----
  options: { gap: 9, paddingTop: 12 },
  option: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: card.peach,
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 11,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  optionLabel: {
    flex: 1,
    fontFamily: fonts.cardBodyBold,
    fontSize: 19,
    lineHeight: 24,
    color: card.ink, // 6.40:1 on peach
  },
  /**
   * Bisaya is shown but not selectable. It is printed as a plate that has NOT been inked —
   * stock fill, a sage edge, no ledge and no arrow — rather than the old 45% opacity, which
   * dropped its label to roughly 5:1-equivalent on a cheap panel in daylight. Disabled
   * controls are exempt from the contrast rule, but there is no reason to spend the
   * legibility when the state can be carried by the printing instead.
   */
  optionComingSoon: { backgroundColor: card.stock, borderColor: card.sage },
  optionLabelComingSoon: { color: card.graphite }, // 7.67:1 on stock
  betaPill: {
    backgroundColor: card.graphite,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  soonPill: {
    backgroundColor: card.olive,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  // Cream on a coloured fill, per the palette: 7.67:1 on graphite, 4.79:1 on olive.
  pillText: {
    fontFamily: fonts.gothic,
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: card.stock,
  },
});
