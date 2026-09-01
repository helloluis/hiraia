/**
 * Response interject page of the question-cards feed — shown when the kid TYPED a query and
 * the local card search found no confident match. Three shapes:
 *   - generated : a short grounded fact card from the (background-warmed) model, prefixed with
 *     the kid's question so it reads like a card printed in answer to them — matted in the
 *     deck's own engraving plate when RETRIEVAL found a picture it is confident about, and
 *     printed as plain type when it did not, which is the common case (see the illustration
 *     note on the render below).
 *   - abstain   : an in-domain GAP — science, but no page for it yet — offering the nearest
 *     topic as a soft landing.
 *   - offdomain : the query wasn't science at all. States what the DECK holds and offers
 *     four example subjects; deliberately NO nearest topic, because answering "roblox" with a
 *     science card is the thing this shape exists to stop.
 * The two miss shapes share the disc-centred layout — they are the same KIND of page, and the
 * only visible difference is the sentence. A confident retrieval HIT never reaches here — it
 * navigates straight to the found card with a small "you asked" banner instead. A gold
 * "ituloy" ticket continues the walk.
 *
 * LOOK — design/mockups/midcentury.html. The mockup draws four frames and this is not one
 * of them, so every treatment below is DERIVED from one that is, and each is credited
 * inline. This is deliberately the QUIETEST card in the deck: an ordinary cream card with
 * the deck's default sage keyline, its index band in muted olive — the palette's "small
 * labels on cream" colour — rather than the reward page's celebratory gold. Nothing is
 * red, dimmed or warning-coloured: an abstention is a different KIND of card, not a failed
 * one, so it gets the mascot disc and the same gold ticket out as every other page.
 *
 * CardFeedScreen owns the card SURFACE — stock, the 3px ink edge, the rounded corners, the
 * ledge and the board it lies on — and clips page content to it. This file prints ON that
 * surface only: keyline, punched holes, index band, type, ticket. Same division as
 * CardPage. Every "shadow" is a ledge (a darker parent View with a few px of bottom
 * padding), because RN on Android ignores shadowOffset and honours only `elevation`.
 */
import { Image, StyleSheet, Text, View } from 'react-native';

import type { Language } from '@hiraia/shared';

import { uiStrings } from '../../config/strings';
import { useArtSource } from '../../data/artSource';
import type { FeedResponse } from '../../store/cardStore';
import { card, fonts } from '../../theme';
import { CardPlate } from './CardPlate';
import { CardPrint, Divider, IndexBand, Ticket, cardFrame } from './CardFrame';

/** The mascot — the same alpha-cut PNG the chat avatar and every other card use. */
const CAT = require('../../../assets/hiraia-profile.png');

/**
 * The answer's type ramp — the mockup's four steps off `string.length` alone, no onLayout
 * measurement pass, and the same numbers CardPage prints a factoid at, so an answer and a
 * card read as the same size of thing. cardStore caps a generated answer at 320
 * characters, which is exactly what the last step is for.
 */
function answerTier(text: string): { fontSize: number; lineHeight: number } {
  const n = text.length;
  if (n <= 120) return { fontSize: 16.5, lineHeight: 23 };
  if (n <= 220) return { fontSize: 15, lineHeight: 21.5 };
  if (n <= 300) return { fontSize: 14, lineHeight: 20 };
  return { fontSize: 13, lineHeight: 18.5 };
}

/**
 * Longest answer that still leaves room for a picture. A card is ONE fixed page and it has to
 * hold the child's question (up to four lines), the answer in full, and the continue ticket;
 * the plate's own floor is 136px. Past this the two cannot both fit, and the SENTENCE is the
 * payload — so the picture yields rather than the type being squeezed or the ticket pushed off
 * the page. The prompt caps a card at 30 words and the deck's median printed card is 19, so
 * this only ever bites on the long tail. `sanitizeCardAnswer`'s own ceiling is 320.
 * (The web demo applies the same rule for the same reason — DemoResponseCard.)
 */
const ART_MAX_CHARS = 220;

/**
 * One step down when the card is ILLUSTRATED, mirroring the factoid card's own two shapes: the
 * plate takes the height, so the answer under it is a CAPTION rather than the body of the
 * page. Without the step a long card and a 136px plate compete for the same box and the type
 * wins by squeezing the picture to its floor.
 */
function captionTier(text: string): { fontSize: number; lineHeight: number } {
  const t = answerTier(text);
  return { fontSize: t.fontSize - 1.5, lineHeight: t.lineHeight - 2 };
}

export function ResponseCard({
  response,
  language,
  onContinue,
}: {
  response: FeedResponse;
  language: Language;
  onContinue: () => void;
}) {
  const t = uiStrings(language);
  const offDomain = response.kind === 'offdomain';
  // Both misses print the disc and one centred sentence; only `generated` prints an answer.
  const miss = response.kind !== 'generated';
  /**
   * THE ILLUSTRATION. `response.slug` was chosen by RETRIEVAL from the fact the card states — the
   * curated fact→slug map first, then LaBSE over the image catalog above a measured floor (see
   * @hiraia/shared rag/images.ts). The model was never asked what to draw; it wrote the
   * sentence, and it still emits `[image: …]` tags that `sanitizeCardAnswer` throws away.
   *
   * `null` is the ORDINARY answer, not a failure — at the shipped floor most dynamic cards get
   * no confident picture, and the card then prints exactly as it did before this existed. That
   * asymmetry is the whole design: a wrong engraving under a true sentence teaches the wrong
   * thing, so the bar is set where a picture is worth trusting and the card is laid out to
   * look complete without one.
   *
   * Resolved through `useArtSource` even though the engine already presence-checked the slug:
   * that check answered for the device at RESOLVE time, this one answers for the device NOW
   * (backfilled art can land mid-session), and it is the same function, so the two cannot
   * disagree about what "present" means. A null here simply prints the picture-less card.
   */
  const roomForArt = (response.text?.length ?? 0) <= ART_MAX_CHARS;
  const art = useArtSource(miss || !roomForArt ? null : response.slug);

  return (
    <View style={cardFrame.content}>
      {/* keyline + punched binder holes; the keyline is left at the deck's default sage —
          the band alone marks this as a different kind of page */}
      <CardPrint />

      {/* Index band. It absorbs the old "ANG TANONG MO" eyebrow, because that label IS
          this card's index — and it is the shared string the shell already prints on the
          "you asked" ribbon, so a search reads the same whichever way it lands. A factoid
          card's chip carries a catalogue number; this card was conjured by a search and
          has none, so the chip holds the mark that says what the page is (the same device
          QuestionPage uses for its quiz chip). */}
      <IndexBand
        tone="olive"
        chip="?"
        label={t.cards.yourQuestion}
        stamp={<Image source={CAT} style={cardFrame.stampImage} resizeMode="contain" />}
      />

      {/* .q — the question line of a factoid card, in the bold slab. The kid's own words,
          kept in quotes so they read as quoted back. Capped at 4 lines: the card is a
          fixed page and a long typed query would otherwise push the answer off it. */}
      <Text style={styles.query} numberOfLines={4} ellipsizeMode="tail">
        “{response.query}”
      </Text>
      {/* the printed rule + gold diamond that introduces an answer everywhere in the deck */}
      <Divider style={styles.divider} />

      <View
        style={[
          styles.answerWrap,
          miss
            ? styles.answerWrapAbstain
            : art != null
              ? styles.answerWrapArt
              : styles.answerWrapAnswer,
        ]}
      >
        {miss ? (
          <>
            {/* .qcat one size down — the peach-matted disc with the 3px ink edge, in place
                of the old 🤔. Emoji render in full colour on Android and break the
                ten-colour palette; more to the point, the cat looking back at the kid
                keeps an honest "I don't know that yet" companionable rather than
                apologetic. */}
            <View style={styles.disc}>
              <Image source={CAT} style={styles.discImage} resizeMode="contain" />
            </View>
            <Text style={styles.abstain}>{offDomain ? t.cards.offdomain : t.cards.abstain}</Text>
            {offDomain ? (
              /* No retrieved topic exists for an off-domain query, and offering one anyway is
                 precisely the behaviour we removed — so this line is STATIC: four subjects the
                 bank is genuinely dense in, so a kid who follows it lands on a real card. */
              <Text style={styles.suggest}>{t.cards.offdomainHint}</Text>
            ) : (
              response.suggestion && (
                <Text style={styles.suggest}>
                  {t.cards.abstainSuggest}:{' '}
                  {/* the soft landing, set in the bold slab so the topic reads as a printed
                      proper noun. Still deliberately not pressable — the ticket below stays
                      the only action on the card. */}
                  <Text style={styles.suggestTopic}>{response.suggestion}</Text>
                </Text>
              )
            )}
          </>
        ) : art != null ? (
          /* Illustrated: the deck's own matted engraving (the SAME CardPlate a factoid card
             prints, so a generated card reads as a card of this deck and not as a chat
             bubble with a thumbnail), with the answer set under it as a caption. The
             lightbox is captioned with the child's own question — the page has no catalogue
             title, and their words are what this picture is an answer to. */
          <>
            <CardPlate source={art} label={response.query} />
            <Text style={[styles.answer, styles.caption, captionTier(response.text ?? '')]}>
              {response.text}
            </Text>
          </>
        ) : (
          <Text style={[styles.answer, answerTier(response.text ?? '')]}>{response.text}</Text>
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
  // ---- the exchange ----
  query: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 18, // the mockup's .q, the same size CardPage asks a question at
    lineHeight: 23,
    color: card.ink,
    letterSpacing: -0.1,
    marginTop: 12,
  },
  divider: { marginVertical: 9 },
  answerWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  // An unillustrated answer is centred in the box it has; an illustrated one starts at the top
  // because the plate below it stretches (flex: 1) to fill whatever the caption leaves.
  answerWrapAnswer: { alignItems: 'flex-start' },
  answerWrapArt: { alignItems: 'stretch', justifyContent: 'flex-start' },
  // the abstention centres on its disc, the way the quiz frame centres on .qcat
  answerWrapAbstain: { alignItems: 'center', paddingHorizontal: 4 },
  answer: {
    // Zilla Slab regular — the mockup's .fact body weight. Size and leading come from
    // answerTier().
    fontFamily: fonts.cardBody,
    color: card.ink,
  },
  // The caption under an engraving, same gap the factoid card leaves under its own plate.
  caption: { marginTop: 12 },
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
    marginBottom: 14,
  },
  discImage: { width: 62, height: 62 },
  abstain: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 18,
    lineHeight: 25,
    color: card.ink,
    textAlign: 'center',
  },
  suggest: {
    fontFamily: fonts.cardBody,
    fontSize: 15,
    lineHeight: 21.5,
    color: card.olive, // the palette's "small labels on cream" — 4.79:1
    textAlign: 'center',
    marginTop: 14,
  },
  suggestTopic: {
    fontFamily: fonts.cardBodyBold,
    color: card.ink,
  },
  ticketGap: { marginTop: 12 },
});
