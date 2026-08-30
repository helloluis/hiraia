import type { Language } from '@hiraia/shared';

/**
 * Copy for the onboarding carousel. Bisaya (cebuano) strings are first-draft and
 * should be reviewed by a native speaker — flagged in the PR.
 */

// Order the slide-1 question cycles through (typewritered, each replacing the
// last). Cebuano is out of the cycle while Bisaya is "coming soon" — don't
// typewriter a question in a language whose button is disabled.
export const LANG_CYCLE: Language[] = ['tagalog', 'english'];

// Slide 1 — "How do you want to use Hiraia?" (cycled across languages).
export const Q_HOW_USE: Record<Language, string> = {
  tagalog: 'Paano mo gustong gamitin ang Hiraia?',
  english: 'How do you want to use Hiraia?',
  cebuano: 'Unsaon nimo paggamit ang Hiraia?',
};

// Slide 1 — each language's self-identification button, written IN that language.
export const LANG_BUTTON: Record<Language, string> = {
  tagalog: 'Magtatagalog po ako',
  english: 'I want to use English',
  cebuano: 'Magbinisaya ko',
};

// Slide 2 — "What grade are you in?" (typewritered in the language just chosen). The word
// on the buttons underneath is NOT here: it is English "Grade" in all three languages and
// the deck footer prints the same word, so it lives once in config/grades.ts (GRADE_WORD).
export const Q_GRADE: Record<Language, string> = {
  tagalog: 'Anong grade ka na?',
  english: 'What grade are you in?',
  cebuano: 'Unsa nga grade ka na?',
};

// ---------------------------------------------------------------------------------------
// Slide 3 — the TUTORIAL card.
//
// It used to mock the chat (a kid types a question, a reply streams in). The deck is the
// product now, so the tutorial teaches the deck: a mini card being turned, four beats in a
// loop — TAP the ticket, TAP pick A, swipe RIGHT for B, swipe UP.
//
// Tap comes FIRST on purpose. A swipe is an additional way to press the ticket that is
// already on the card, never the only way, and a child who only ever taps must not be
// taught they have to swipe. That is also why one of the two FORK beats is a press and not
// a swipe: a fork's picks are tappable in the feed, and a vertical throw from the middle of
// a fork is refused outright, so a tutorial that only ever swiped a fork would teach the one
// gesture that can do nothing. (The feed also honours a downward throw, which on a
// single-path card means exactly what UP means — a fifth beat would lengthen the loop for
// no new information, so it is left out.)
// ---------------------------------------------------------------------------------------

// The headline above the mini deck (shown in the chosen language).
export const DEMO_CAPTION: Record<Language, string> = {
  tagalog: 'Ganito paglaruan ang mga card:',
  english: 'This is how the cards work:',
  cebuano: 'Mao ni ang paagi sa mga card:',
};

/**
 * The line under the mini deck that NAMES the beat currently being shown. One key per beat
 * of DemoSlide's loop.
 *
 * `left` names BOTH affordances of a fork pick, because that beat shows the tap and the feed
 * accepts either; the "or" is there on purpose — these are alternatives to each other, not
 * separate things a child has to learn. `right` names only the swipe, so the pair reads as
 * one lesson rather than the same sentence printed twice.
 */
export const DEMO_HINT: Record<Language, { tap: string; left: string; right: string; up: string }> =
  {
    tagalog: {
      tap: 'Pindutin ang gintong tiket.',
      left: 'Pindutin ang A, o i-swipe pakaliwa.',
      right: 'I-swipe pakanan para sa B.',
      up: 'I-swipe pataas para sa susunod.',
    },
    english: {
      tap: 'Tap the gold ticket.',
      left: 'Tap A, or swipe left.',
      right: 'Swipe right for B.',
      up: 'Swipe up for the next one.',
    },
    cebuano: {
      tap: 'I-tap ang bulawan nga tiket.',
      left: 'I-tap ang A, o i-swipe pawala.',
      right: 'I-swipe patuo para sa B.',
      up: 'I-swipe pataas para sa sunod.',
    },
  };

/**
 * The words printed ON the mini cards in the loop — a topic for the index band, the single
 * gold ticket's label, the two picks of a fork and the word that heads one. They are held
 * here rather than read out of `strings.ts` because these are props in a mock, not app copy
 * another screen shares; `fork` matches `t.cards.fork` by hand so the mock and the real
 * card say the same word.
 */
export const DEMO_MINI: Record<
  Language,
  { band: string; next: string; fork: string; pickA: string; pickB: string }
> = {
  tagalog: {
    band: 'Kalawakan',
    next: 'Susunod',
    fork: 'Sangandaan',
    pickA: 'Araw',
    pickB: 'Buwan',
  },
  english: { band: 'Space', next: 'Next', fork: 'Crossroads', pickA: 'Sun', pickB: 'Moon' },
  cebuano: {
    band: 'Kawanangan',
    next: 'Sunod',
    fork: 'Sangang-dalan',
    pickA: 'Adlaw',
    pickB: 'Bulan',
  },
};

/**
 * The gold Ticket at the foot of slide 3, which is now the LAST action of onboarding: it
 * dismisses the carousel. Gold because the deck reserves gold for the ordinary
 * continuation, which is exactly what "start" is here.
 */
export const DEMO_START: Record<Language, string> = {
  tagalog: 'Simulan na!',
  english: "Let's start!",
  cebuano: 'Sugdan na!',
};

// Slide 3 — the illustration printed on the mini cards (resolves via imageMap).
export const DEMO_IMAGE_SLUG = 'plant-parts';

/**
 * The index-band label printed across the top of each onboarding card, per language.
 *
 * The onboarding slides are printed on the same flash cards as the feed, and every card in
 * the deck carries a band naming what KIND of page it is (CardFrame.IndexBand). These are
 * those three names. They live here with the rest of the onboarding copy rather than in
 * config/strings.ts for the same reason QuestionPage and RewardCard keep their own band
 * labels local: they are set-in-metal labels belonging to these three cards only, not app
 * copy another screen shares. Kept SHORT — the band is one line and truncates.
 *
 * `grade` is the English word on purpose, exactly as GRADE_OPTIONS' buttons are (see the
 * note on GRADE_WORD in config/grades.ts).
 */
export const SLIDE_BAND: Record<Language, { language: string; grade: string; demo: string }> = {
  tagalog: {
    language: 'Wika',
    grade: 'Grade',
    demo: 'Paano gamitin',
  },
  english: {
    language: 'Language',
    grade: 'Grade',
    demo: 'How it works',
  },
  cebuano: {
    language: 'Pinulongan',
    grade: 'Grade',
    demo: 'Unsaon paggamit',
  },
};
