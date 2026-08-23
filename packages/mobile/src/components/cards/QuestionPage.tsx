/**
 * Interject page of the question-cards feed: ONE multiple-choice question about a fact
 * the kid read in the last few pages (exact MCQ from the verified quiz bank, keyed by
 * factId). Options shuffle at render (canonical answer index stored). After the reveal,
 * a gold "ituloy" ticket resumes the walk onto the card the kid had chosen.
 *
 * LOOK — frame 04 of design/mockups/midcentury.html: a 1950s laminated flash card,
 * punched for a binder. This is the ONLY page printed on teal stock, which is what makes
 * a quiz read instantly as a different KIND of page (teal is reserved for exactly this
 * and is deliberately not a fork colour). Gold is the accent: index band, printed
 * keyline, letter chips, the continue ticket.
 *
 * CardFeedScreen owns the card SURFACE — the teal stock (it picks it from `question`),
 * the 3px ink edge, the rounded corners, the ledge and the board — and clips page content
 * to it. This file prints ON that surface only, inside `cardFrame.content`; painting its
 * own board/ledge/card here would nest a second card inside the first.
 *
 * Everything chunky here is built the Android way — a darker parent View with a few px of
 * bottom padding ("the ledge"), never shadow props, which RN on Android ignores except
 * for `elevation`.
 */
import { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { Language } from '@hiraia/shared';

import { uiStrings } from '../../config/strings';
import { type CardQuestion } from '../../data/cards';
import { localize } from '../../data/quiz';
import { card, fonts } from '../../theme';
import { CardPrint, Divider, IndexBand, Ticket, cardFrame } from './CardFrame';

/** The mascot — same alpha-cut PNG for the small band stamp and the big peach disc. */
const CAT = require('../../../assets/hiraia-profile.png');

/**
 * Printed furniture: the index-band label, the cat's eyebrow, the footer hint and the
 * post-answer heading. Deliberately local to this component rather than in
 * config/strings.ts — these are set-in-metal labels belonging to ONE card type (they only
 * exist because this page is a quiz), not app copy that other screens share. They move to
 * the shared strings file if a second screen ever needs them.
 */
const LABELS: Record<Language, { band: string; eyebrow: string; hint: string; answer: string }> = {
  tagalog: {
    band: 'Pagsusulit',
    eyebrow: 'Sandali — tanong!',
    hint: 'Pumili ng isang sagot',
    answer: 'Ang tamang sagot',
  },
  english: {
    band: 'Quiz',
    eyebrow: 'Wait — a question!',
    hint: 'Pick one answer',
    answer: 'The correct answer',
  },
  cebuano: {
    band: 'Pagsulay',
    eyebrow: 'Kadiyot — pangutana!',
    hint: 'Pili ug usa ka tubag',
    answer: 'Ang husto nga tubag',
  },
};

/**
 * Type/size steps off `string.length` alone — the mockup's adaptive scale, no measurement
 * pass. It matters more here than on a factoid page: bank questions run to 139 chars at
 * p99 and single options to 126, so the roomy setting would push four answer rows off a
 * 720x1600 panel. Falling one step keeps the whole card on screen without scrolling
 * (the feed's corner-swipe pan responder captures vertical drags, so a ScrollView here
 * would fight the page turn).
 */
interface Tier {
  /** Diameter of the peach disc the cat sits on. */
  cat: number;
  q: number;
  qLine: number;
  opt: number;
  optLine: number;
  /** Minimum answer-row height — the mockup's chunky 52px row, tightened as text grows. */
  row: number;
  gap: number;
}

function tierFor(qChars: number, optChars: number): Tier {
  if (qChars <= 90 && optChars <= 55) {
    return { cat: 88, q: 22, qLine: 28, opt: 16, optLine: 21, row: 52, gap: 10 };
  }
  if (qChars <= 130 && optChars <= 95) {
    return { cat: 66, q: 20, qLine: 26, opt: 15, optLine: 20, row: 46, gap: 8 };
  }
  return { cat: 50, q: 18, qLine: 23, opt: 14, optLine: 19, row: 40, gap: 7 };
}

/** How an answer row is printed once the answer is out. */
type RowState = 'live' | 'correct' | 'wrong' | 'dim';

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

interface QuestionPageProps {
  question: CardQuestion;
  language: Language;
  onAnswer: (correct: boolean) => void;
  onContinue: () => void;
}

export function QuestionPage({ question, language, onAnswer, onContinue }: QuestionPageProps) {
  const t = uiStrings(language);
  const labels = LABELS[language];
  const order = useMemo(() => shuffled(question.o.length), [question.f, question.o.length]);
  const [selected, setSelected] = useState<number | null>(null);
  const revealed = selected !== null;
  const correctDisplay = order.indexOf(question.a);
  const gotIt = revealed && selected === correctDisplay;

  const pickOption = (displayIdx: number) => {
    if (revealed) return;
    setSelected(displayIdx);
    onAnswer(displayIdx === correctDisplay);
  };

  const questionText = localize(question.q, language);
  // Localised options in DISPLAY order (order[i] = which bank option is printed i-th), so
  // the row loop below indexes by display position exactly like the shuffle does.
  const optionTexts = order.map((optIdx) => localize(question.o[optIdx], language));
  const tier = tierFor(questionText.length, Math.max(...optionTexts.map((o) => o.length), 0));
  // Once answered the hero is gone entirely, so the disc only ever draws at full size; the
  // question — already read — steps down to give the explanation its room.
  const catSize = tier.cat;
  const qSize = revealed ? tier.q - 2 : tier.q;
  const qLine = revealed ? tier.qLine - 3 : tier.qLine;

  return (
    <View style={cardFrame.content}>
      {/* keyline + binder punches; the keyline goes gold on an interject page */}
      <CardPrint keyline="gold" />

      {/* A factoid card's index chip carries its catalogue number; a quiz card has none to
          carry, so the chip holds the mark that says what this page is. */}
      {/* The chip is the VERDICT once the page is answered — a tick or a cross where the "?"
          was. Putting it here is what let the whole verdict ROW go: the row said the same
          thing a second time, one line further down, next to a cat the band already shows. */}
      <IndexBand
        tone="gold"
        chip={revealed ? (gotIt ? '✓' : '✗') : '?'}
        chipSymbol={revealed}
        label={labels.band}
        stamp={<Image source={CAT} style={cardFrame.stampImage} resizeMode="contain" />}
      />

      {/* Before answering, the cat is the interruption: full-size disc and an eyebrow. After
          answering it yields the space outright — the verdict is in the band, the correct
          answer is the highlighted row, and repeating either here only pushed the
          explanation off the bottom of the card. */}
      {revealed ? null : (
        <>
          <View style={[styles.disc, styles.discHero, discSize(catSize)]}>
            <Image source={CAT} style={imageSize(catSize)} resizeMode="contain" />
          </View>
          <Text style={styles.eyebrow}>{labels.eyebrow}</Text>
        </>
      )}

      <Text
        style={[styles.question, { fontSize: qSize, lineHeight: qLine }]}
        numberOfLines={revealed ? 3 : undefined}
      >
        {questionText}
      </Text>

      <View style={[styles.options, { gap: tier.gap }]}>
        {optionTexts.map((text, displayIdx) => {
          const isCorrect = displayIdx === correctDisplay;
          const isChosen = displayIdx === selected;
          // Same three-way decision as before the restyle; only the printing changed.
          let state: RowState = 'live';
          let mark = '';
          if (revealed) {
            if (isCorrect) {
              state = 'correct';
              // A STAR when this was the reader's own pick, a tick when it is merely the
              // answer they missed. The row is the only place that distinction now lives.
              mark = gotIt ? '★' : '✓';
            } else if (isChosen) {
              state = 'wrong';
              mark = '✗';
            } else {
              state = 'dim';
            }
          }
          const fill: StyleProp<ViewStyle> =
            state === 'correct'
              ? styles.rowCorrect
              : state === 'wrong'
                ? styles.rowWrong
                : styles.rowStock;
          const chipFill: StyleProp<ViewStyle> =
            state === 'wrong' ? styles.keyChipStock : styles.keyChipInk;
          const chipText: StyleProp<TextStyle> =
            state === 'wrong' ? styles.keyTextGraphite : styles.keyTextGold;
          const wordStyle: StyleProp<TextStyle>[] = [
            styles.optionText,
            { fontSize: tier.opt, lineHeight: tier.optLine },
          ];
          // Right/wrong never rests on hue alone: the correct row also gains the bold
          // cut and a check, the chosen-wrong row is struck through and crossed out.
          if (state === 'correct') wordStyle.push(styles.optionTextCorrect);
          if (state === 'wrong') wordStyle.push(styles.optionTextWrong);
          return (
            <View key={displayIdx} style={[cardFrame.rowLedge, state === 'dim' && styles.rowDim]}>
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  fill,
                  { minHeight: tier.row },
                  pressed && cardFrame.pressed,
                ]}
                onPress={() => pickOption(displayIdx)}
                disabled={revealed}
                // The tightest tier prints a 40px row, under the 44dp touch minimum, so
                // the target is padded out to 48 without spending any layout. 4px a side
                // is safe: rows are 7px apart plus their 4px ledge, so two targets can
                // never overlap.
                hitSlop={{ top: 4, bottom: 4 }}
              >
                <View style={[styles.keyChip, chipFill]}>
                  <Text style={[styles.keyText, chipText]}>
                    {String.fromCharCode(65 + displayIdx)}
                  </Text>
                </View>
                {/* Rows the kid neither picked nor needed are spent: clamp them so a
                    long bank option cannot push the ticket off the card. */}
                <Text style={wordStyle} numberOfLines={state === 'dim' ? 2 : undefined}>
                  {text}
                </Text>
                {!!mark && (
                  <Text
                    style={[styles.mark, state === 'correct' ? styles.markInk : styles.markStock]}
                  >
                    {mark}
                  </Text>
                )}
              </Pressable>
            </View>
          );
        })}
      </View>

      {revealed ? (
        <>
          {/* the printed rule + diamond that introduces an answer everywhere in the deck */}
          <Divider style={styles.divider} />
          <Text style={styles.explanation}>{localize(question.e, language)}</Text>
          <Ticket
            label={t.cards.continueNote}
            onPress={onContinue}
            hitSlop={12}
            style={styles.ticketGap}
          />
        </>
      ) : (
        <Text style={styles.hint}>{labels.hint}</Text>
      )}
    </View>
  );
}

/** Disc geometry is content-driven (see `tierFor`), so it cannot live in StyleSheet. */
function discSize(size: number): ViewStyle {
  return { width: size, height: size, borderRadius: size / 2 };
}

/** The engraving-style mascot keeps a peach margin inside its disc. */
function imageSize(size: number): ImageStyle {
  const inner = Math.round(size * 0.86);
  return { width: inner, height: inner };
}

const styles = StyleSheet.create({
  // ---- hero: the cat announces the interruption ----
  disc: {
    alignSelf: 'center',
    backgroundColor: card.peach, // the warm mat every print in this deck sits on
    borderWidth: 3,
    borderColor: card.ink,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  discHero: { marginTop: 18 },
  eyebrow: {
    marginTop: 11,
    textAlign: 'center',
    fontFamily: fonts.gothic,
    fontSize: 10,
    letterSpacing: 1.9,
    textTransform: 'uppercase',
    // Cream, not the mockup's gold: gold on teal stock measures 2.9:1, which is not a
    // daylight-legible micro-label on a cheap 720p panel. Cream is 5.6:1.
    color: card.stock,
  },
  question: {
    marginTop: 7,
    paddingHorizontal: 4,
    textAlign: 'center',
    fontFamily: fonts.cardBodyBold,
    color: card.stock,
  },

  // ---- answer rows (the mockup's `.opt`, on the deck's shared `.ledge-o`) ----
  options: {
    marginTop: 'auto', // the rows sit on the bottom edge of the card, as printed
    paddingTop: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 3,
    borderColor: card.ink,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rowStock: { backgroundColor: card.stock },
  rowCorrect: { backgroundColor: card.gold },
  rowWrong: { backgroundColor: card.graphite },
  rowDim: { opacity: 0.45 },
  keyChip: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyChipInk: { backgroundColor: card.ink },
  keyChipStock: { backgroundColor: card.stock },
  keyText: { fontFamily: fonts.slab, fontSize: 13, lineHeight: 17, includeFontPadding: false },
  keyTextGold: { color: card.gold },
  keyTextGraphite: { color: card.graphite },
  optionText: {
    flex: 1,
    fontFamily: fonts.cardBody,
    color: card.ink,
  },
  optionTextCorrect: { fontFamily: fonts.cardBodyBold },
  optionTextWrong: { color: card.stock, textDecorationLine: 'line-through' },
  // No fontFamily on the marks: the check and cross are not in the bundled display faces,
  // so they are left to the system font's fallback chain. (The continue ARROW is not a
  // glyph at all — see CardFrame's border triangle.)
  mark: { fontSize: 18, fontWeight: '700', marginLeft: 2 },
  markInk: { color: card.ink },
  markStock: { color: card.stock },

  // ---- pre-answer hint / post-answer explanation + ticket ----
  hint: {
    marginTop: 12,
    textAlign: 'center',
    fontFamily: fonts.gothic,
    fontSize: 9,
    letterSpacing: 1.9,
    textTransform: 'uppercase',
    color: card.stock,
    opacity: 0.85, // quieter than the eyebrow without dropping below a legible contrast
  },
  divider: { marginTop: 12 },
  explanation: {
    marginTop: 8,
    fontFamily: fonts.cardBody,
    fontSize: 14.5,
    lineHeight: 20,
    color: card.stock,
  },
  ticketGap: { marginTop: 12 },
});
