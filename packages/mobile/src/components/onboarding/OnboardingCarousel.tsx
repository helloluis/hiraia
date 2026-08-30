/**
 * The onboarding carousel, printed as THREE CARDS OF THE DECK.
 *
 * It used to be paper in a notebook (NotebookBackground + the legacy `colors` palette),
 * which is the look the rest of the app is moving off. It is now the same mid-century
 * flash card the feed deals: a dark board (card.board), one cream card lying on it with
 * a printed ledge under it, a 3px forest-ink edge and rounded corners, and — inside — the
 * shared die-cut every page of the deck carries (punched binder holes, printed keyline,
 * index band with the cat stamp). Geometry and colours come from CardFrame + `card` in
 * theme.ts; nothing is re-implemented here.
 *
 * DIVISION OF LABOUR, copied deliberately from CardFeedScreen: this shell owns the card
 * SURFACE (stock, ink edge, radius, the ledge, the board) and each slide prints ON that
 * surface inside `cardFrame.content`. A slide that painted its own card would nest a
 * second card inside the first.
 *
 * THREE swipeable slides: language pick → grade pick → deck tutorial. Picking a language
 * on slide 1 fires `onPickLanguage` (which starts the model download in the background) and
 * advances, the grade pick goes straight to engineStore, `onFinish` — the gold START ticket
 * on the tutorial card — dismisses it, and the user can swipe back at any time.
 *
 * There used to be a fourth card warning that a large one-time download was about to
 * happen. It was pure notice: it started nothing, touched no store, and only called
 * `onDone`. The download already begins the moment a language is picked on card 1 and runs
 * in the background, so the warning was telling a child to wait for something they were
 * never waiting for. It is gone, and `onFinish` moved onto the tutorial card's ticket.
 *
 * The one LAYOUT change: the BACK/dots/NEXT bar is a normal flex row under the pager
 * rather than an absolutely-positioned overlay. It used to float over the slides, which is
 * why GradeSlide carried an 80px NAV_BAR_CLEARANCE so its last row of buttons was not
 * covered by (and tapped through to) the NEXT button. A card has a hard edge and cannot be
 * overlapped by chrome without looking broken, so the bar now sits below the card and that
 * clearance hack is gone.
 */
import { useRef, useState, type ReactNode } from 'react';
import {
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { GradeLevel, Language } from '@hiraia/shared';

import { useEngineStore } from '../../store/engineStore';
import { card, cardAlpha, fonts } from '../../theme';
import { Arrow, CARD_EDGE, CARD_RADIUS } from '../cards/CardFrame';
import { DemoSlide } from './DemoSlide';
import { GradeSlide } from './GradeSlide';
import { LanguageSlide } from './LanguageSlide';

const SLIDES = 3;

/**
 * One slide's card SURFACE — the feed's `cardLedge` + `cardLayer`, at the same radius, the
 * same 3px ink edge and the same cream stock, so an onboarding card and a factoid card are
 * physically the same object. (Teal stock is quiz-only, so these stay cream.)
 */
function SlideCard({ children }: { children: ReactNode }) {
  return (
    <View style={styles.deck}>
      <View style={styles.cardLedge} pointerEvents="none" />
      <View style={styles.cardLayer}>{children}</View>
    </View>
  );
}

export function OnboardingCarousel({
  onPickLanguage,
  onFinish,
  initialLanguage,
}: {
  onPickLanguage: (lang: Language) => void;
  onFinish: () => void;
  initialLanguage?: Language | null;
}) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  // language driving slides 2-3 copy; defaults to the saved language (re-trigger) or TL.
  const [lang, setLang] = useState<Language>(initialLanguage ?? 'tagalog');
  // whether a language has been chosen — pre-set (re-watch from Settings) or picked here.
  // Gates NEXT on slide 1 so first-time kids must actually pick before moving on.
  const [chosen, setChosen] = useState(initialLanguage != null);
  // The grade lives in engineStore (persisted like the language). Slide 2 pre-highlights the
  // current value — Grade 5 by default — and a tap applies it right away via changeGrade;
  // read from the store here since _layout only wires the language.
  const grade = useEngineStore((s) => s.grade);
  const changeGrade = useEngineStore((s) => s.changeGrade);

  const goTo = (i: number) => scrollRef.current?.scrollTo({ x: i * width, animated: true });

  const handlePick = (picked: Language) => {
    setLang(picked);
    setChosen(true);
    onPickLanguage(picked); // persists + starts loading the engine/model in the background
    goTo(1);
  };

  const handlePickGrade = (picked: GradeLevel) => {
    void changeGrade(picked); // persists; a ready engine re-primes its system prompt in place
    goTo(2);
  };

  const showBack = index > 0;
  // NEXT: slide 1 needs an actual language pick (first-time kids must choose); every later
  // slide shows it immediately — Grade 5 is pre-highlighted and is a real default, so tapping
  // a grade is optional; the last slide has its own gold START ticket.
  const showNext = index === 0 ? chosen : index < SLIDES - 1;

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));

  return (
    <SafeAreaView style={styles.overlay}>
      <ScrollView
        ref={scrollRef}
        style={styles.pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ width }}>
          <SlideCard>
            <LanguageSlide onPick={handlePick} />
          </SlideCard>
        </View>
        <View style={{ width }}>
          <SlideCard>
            <GradeSlide
              language={lang}
              selected={grade}
              active={index === 1}
              onPick={handlePickGrade}
            />
          </SlideCard>
        </View>
        <View style={{ width }}>
          <SlideCard>
            <DemoSlide language={lang} active={index === 2} onStart={onFinish} />
          </SlideCard>
        </View>
      </ScrollView>

      {/* The nav bar sits ON THE BOARD, so it takes the board's own control vocabulary
          (CardFeedScreen's search field / reroll key): a plate with a 3px ink edge and no
          ledge — board #20342C and ink #1C3B2E are two shades apart, so a printed ledge is
          invisible off the card. Ledges stay on-card. */}
      <View style={styles.navBar}>
        {/* BACK (left) — a plain cream plate, i.e. the secondary of the pair. */}
        {showBack ? (
          <TouchableOpacity
            style={styles.navBtn}
            onPress={() => goTo(index - 1)}
            activeOpacity={0.8}
          >
            {/* One arrow primitive, asked to point the other way (a border triangle, because
                every arrow glyph in this range is a coin-flip on Android's font fallback).
                NOT a 180deg rotation of the right-pointing one: that carries the glyph's
                optical-centring nudge round with it and lands it 4dp off-centre. */}
            <Arrow color={card.ink} direction="left" />
            <Text style={styles.navText}>BACK</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.navSlot} />
        )}

        {/* The dots are the feed's tick meter: unlit sage at 34% on the dark board, the
            current one lit gold and stretched. */}
        <View style={styles.dots}>
          {Array.from({ length: SLIDES }, (_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>

        {/* NEXT (right) — GOLD, because gold is the deck's single-path continuation and
            "keep going" is exactly what this is. Not a fork colour (nothing is being
            chosen) and not teal (that is quiz stock). */}
        {showNext ? (
          <TouchableOpacity
            style={[styles.navBtn, styles.navBtnNext]}
            onPress={() => goTo(index + 1)}
            activeOpacity={0.8}
          >
            <Text style={styles.navText}>NEXT</Text>
            <Arrow color={card.ink} />
          </TouchableOpacity>
        ) : (
          <View style={styles.navSlot} />
        )}
      </View>
    </SafeAreaView>
  );
}

const NAV_SLOT_W = 116; // keeps the dots centered whether or not a button is present

const styles = StyleSheet.create({
  // the desk the deck sits on — the same board the feed deals its cards onto
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: card.board, zIndex: 100 },
  // flex:1, or the horizontal pager sizes itself to its content while its content sizes
  // itself to the pager
  pager: { flex: 1 },

  // ---- the card surface (CardFeedScreen's .deck / .cardLedge / .cardLayer) ----
  deck: { flex: 1, marginHorizontal: 16, marginTop: 2, marginBottom: 14 },
  cardLedge: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: -4,
    borderRadius: CARD_RADIUS + 1,
    backgroundColor: cardAlpha(card.ink, 0.55), // ink at 55% — the printed drop under a card
  },
  cardLayer: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: CARD_RADIUS,
    borderWidth: CARD_EDGE,
    borderColor: card.ink,
    backgroundColor: card.stock,
    overflow: 'hidden', // slide content is clipped to the card's rounded corners
  },

  // ---- nav bar ----
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  navSlot: { width: NAV_SLOT_W },
  navBtn: {
    width: NAV_SLOT_W,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 11,
    borderWidth: CARD_EDGE,
    borderColor: card.ink,
    backgroundColor: card.stock, // ink on cream stock, 10.25:1
  },
  navBtnNext: { backgroundColor: card.gold }, // ink on gold, 5.25:1
  /**
   * The deck's BODY face at near-ticket size, not the micro-label gothic these started in.
   * The gothic at 11.5px is what CardFrame prints an eyebrow in — a caption ABOVE a control
   * — while the thing you actually press, the Ticket, is 18.5px `cardBodyBold`. BACK/NEXT
   * are the only way forward for a child who never discovers the horizontal swipe, so they
   * take the control scale rather than the chrome scale. One step down from the ticket's own
   * face; 16px still leaves ~50dp of slack in the 116dp plate.
   */
  navText: {
    fontFamily: fonts.cardBodyBold,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: 0.8,
    color: card.ink,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, flex: 1 },
  // sage at 34%: an unlit tick has to be legible on the dark board yet clearly OFF
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: cardAlpha(card.sage, 0.34) },
  dotActive: { backgroundColor: card.gold, width: 22 },
});
