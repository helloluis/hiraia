import type { GradeLevel, Language } from '@hiraia/shared';

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

// Slide 1's language buttons are NOT here: they print the plain language names — "Tagalog",
// "English", "Cebuano" — which are LANGUAGE_OPTIONS' own `label`s (config/languages.ts), the
// same strings the Settings picker and the sidebar show, so the two screens cannot drift.
// (They used to be self-identification sentences written in their own language, "Magtatagalog
// po ako" — three sentences to decode before a single word of the app had been understood.)

// Slide 2 — "What's your grade level?" (typewritered in the language just chosen). "grade
// level" stays the English borrowing in all three languages for the same reason GRADE_WORD
// does (see the note in config/grades.ts): it is what Filipino schools actually say.
export const Q_GRADE: Record<Language, string> = {
  tagalog: 'Anong grade level mo?',
  english: "What's your grade level?",
  cebuano: 'Unsa imong grade level?',
};

/**
 * Slide 2's grade buttons: the spelled-out number in the chosen language, and nothing else.
 * They used to print English "Grade" + digit (GRADE_WORD, which the deck footer still
 * prints); the question right above now says "grade level", so the buttons only have to
 * answer it, and a number word in the kid's own language is the friendlier answer.
 * Uppercase in the data on purpose: these are plate labels, set in caps like the deck's
 * other stamped words, not sentence copy.
 */
export const GRADE_NUMBER_WORD: Record<Language, Record<GradeLevel, string>> = {
  tagalog: {
    3: 'TATLO',
    4: 'APAT',
    5: 'LIMA',
    6: 'ANIM',
    7: 'PITO',
    8: 'WALO',
    9: 'SIYAM',
    10: 'SAMPU',
  },
  english: {
    3: 'THREE',
    4: 'FOUR',
    5: 'FIVE',
    6: 'SIX',
    7: 'SEVEN',
    8: 'EIGHT',
    9: 'NINE',
    10: 'TEN',
  },
  cebuano: {
    3: 'TULO',
    4: 'UPAT',
    5: 'LIMA',
    6: 'UNOM',
    7: 'PITO',
    8: 'WALO',
    9: 'SIYAM',
    10: 'NAPULO',
  },
};

/**
 * Slide 3 — the START card, and the LAST action of onboarding: the gold Ticket that
 * dismisses the carousel. It used to be a looping animated tutorial of the deck being
 * turned (tap/swipe beats on a mini card, itself a replacement for an older chat mock);
 * that loop is gone — the last card is now just the one thing left to do. Gold because
 * the deck reserves gold for the ordinary continuation, which is exactly what "start" is.
 */
export const DEMO_START: Record<Language, string> = {
  tagalog: 'Simulan na!',
  english: "Let's start!",
  cebuano: 'Sugdan na!',
};

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
 * `grade` is the English word on purpose, exactly as the deck footer prints it (see the
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
