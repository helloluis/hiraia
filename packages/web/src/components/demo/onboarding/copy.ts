/**
 * Copy + options for the WEB DEMO onboarding carousel — a port of the mobile app's
 * packages/mobile/src/config/onboarding.ts (keep the two in sync). Bisaya strings are
 * first-draft and want a native-speaker pass, same caveat as the app's.
 *
 * Two deliberate departures from the app, both because the browser is not the phone:
 *
 *  1. BISAYA IS SELECTABLE HERE. On device it is `comingSoon` (its adapter isn't
 *     shippable yet), so the app neither offers it nor typewriters a question in it. The
 *     demo talks to the hosted llama-server, which has the Bisaya adapter loaded, and
 *     every card in the demo subset carries `bis` text — so the web offers all three and
 *     LANG_CYCLE runs through all three.
 *  2. DEMO_HINT NAMES A PRESS, NEVER A SWIPE. The app's tutorial teaches tap-vs-swipe
 *     because its feed honours both; the browser feed turns a page when a blue note is
 *     PRESSED and has no swipe handler at all. Teaching a gesture the demo cannot honour
 *     would be the one lie in the onboarding. The app's swipe wording is quoted in the
 *     comment on DEMO_HINT so it can be restored in one edit the day the web feed grows
 *     a drag.
 */
import type { LanguageKey } from '@/config/model';

// ---------------------------------------------------------------------------------------
// Slide 1 — language
// ---------------------------------------------------------------------------------------

export interface LanguageOption {
  lang: LanguageKey;
  /** Endonym shown on the plate's badge — the app's `label`. */
  label: string;
  beta: boolean;
}

/**
 * Display order copied from the app (`config/languages.ts`): Tagalog first because it is
 * the default, then English, then Bisaya. `beta` flags the two whose grounded adapter is
 * not the faithful v3 one — surfaced honestly rather than hidden, exactly as on device.
 */
export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { lang: 'tagalog', label: 'Tagalog', beta: false },
  { lang: 'english', label: 'English', beta: true },
  { lang: 'cebuano', label: 'Bisaya', beta: true },
];

/** Order the slide-1 question cycles through (typewritered, each replacing the last). */
export const LANG_CYCLE: LanguageKey[] = ['tagalog', 'english', 'cebuano'];

/** Slide 1 — "How do you want to use Hiraia?" (cycled across languages). */
export const Q_HOW_USE: Record<LanguageKey, string> = {
  tagalog: 'Paano mo gustong gamitin ang Hiraia?',
  english: 'How do you want to use Hiraia?',
  cebuano: 'Unsaon nimo paggamit ang Hiraia?',
};

/** Slide 1 — each language's self-identification button, written IN that language. */
export const LANG_BUTTON: Record<LanguageKey, string> = {
  tagalog: 'Magtatagalog po ako',
  english: 'I want to use English',
  cebuano: 'Magbinisaya ko',
};

/** Slide 1 — the reassurance under the plates: this is not a one-way door. */
export const LANG_REASSURE: Record<LanguageKey, string> = {
  tagalog: 'Mababago mo ito mamaya.',
  english: 'You can change this later.',
  cebuano: 'Mabag-o ni nimo unya.',
};

// ---------------------------------------------------------------------------------------
// Slide 2 — grade
// ---------------------------------------------------------------------------------------

/**
 * "What grade are you in?", typewritered in the language just chosen. The word ON the
 * buttons is NOT here: it is English "Grade" in all three languages, so it lives once in
 * config/grades.ts (GRADE_WORD), same as the app.
 */
export const Q_GRADE: Record<LanguageKey, string> = {
  tagalog: 'Anong grade ka na?',
  english: 'What grade are you in?',
  cebuano: 'Unsa nga grade ka na?',
};

/**
 * The line under the grade grid. It promises the tutor's reading level, which is the part a
 * visitor can check in one sitting; the grade also re-weights which cards are DRAWN, exactly
 * as on device, now that the demo subset carries each card's MATATAG competency tag (see
 * useDemoStore's `grade` note and FEED-WEIGHTING.md). Left understated on purpose — a feed
 * that leans is not a feed that filters, and no child should be told it is.
 */
export const GRADE_NOTE: Record<LanguageKey, string> = {
  tagalog: 'Para bagay sa iyo ang paliwanag.',
  english: 'So the explanations fit you.',
  cebuano: 'Aron mohaum kanimo ang pagsaysay.',
};

// ---------------------------------------------------------------------------------------
// Slide 3 — the TUTORIAL card
// ---------------------------------------------------------------------------------------

/** The headline above the mini pad (shown in the chosen language). */
export const DEMO_CAPTION: Record<LanguageKey, string> = {
  tagalog: 'Ganito paglaruan ang mga card:',
  english: 'This is how the cards work:',
  cebuano: 'Mao ni ang paagi sa mga card:',
};

/**
 * The line under the mini pad that NAMES the beat currently being shown. One key per beat
 * of TutorialSlide's loop: press the single note, then the two notes of a fork.
 *
 * The app's wording for the same three beats is
 *   tap:   'Pindutin ang gintong tiket.'   / 'Tap the gold ticket.'
 *   left:  'Pindutin ang A, o i-swipe pakaliwa.' / 'Tap A, or swipe left.'
 *   right: 'I-swipe pakanan para sa B.'    / 'Swipe right for B.'
 * — kept here verbatim so the day the browser feed grows a drag handler this file is a
 * one-line-per-language edit rather than a translation job. Until then every hint names a
 * press, because a press is the only thing the demo's pages answer to.
 */
export const DEMO_HINT: Record<LanguageKey, { next: string; left: string; right: string }> = {
  tagalog: {
    next: 'Pindutin ang asul na tala — lilipat ang pahina.',
    left: 'Kapag dalawa ang tala, pindutin ang A…',
    right: '…o ang B. Ikaw ang pumipili ng susunod.',
  },
  english: {
    next: 'Tap the blue note — the page turns.',
    left: 'When there are two notes, tap A…',
    right: '…or B. You pick what comes next.',
  },
  cebuano: {
    next: 'I-tap ang asul nga nota — molihok ang panid.',
    left: 'Kung duha ang nota, i-tap ang A…',
    right: '…o ang B. Ikaw ang mopili sa sunod.',
  },
};

/**
 * The words printed ON the mini pages in the loop — a topic for the header, the single
 * note's label, and a fork's two picks. Props in a mock, not app copy another screen
 * shares, so they live here rather than in cards/strings.ts.
 */
export const DEMO_MINI: Record<
  LanguageKey,
  { band: string; next: string; pickA: string; pickB: string }
> = {
  tagalog: { band: 'Kalawakan', next: 'Susunod', pickA: 'Araw', pickB: 'Buwan' },
  english: { band: 'Space', next: 'Next', pickA: 'Sun', pickB: 'Moon' },
  cebuano: { band: 'Kawanangan', next: 'Sunod', pickA: 'Adlaw', pickB: 'Bulan' },
};

/**
 * The gold Ticket at the foot of slide 3, which is the LAST action of onboarding: it
 * dismisses the carousel and warms the demo up. Gold because gold is this product's
 * ordinary "keep going", which is exactly what "start" is here.
 */
export const DEMO_START: Record<LanguageKey, string> = {
  tagalog: 'Simulan na!',
  english: "Let's start!",
  cebuano: 'Sugdan na!',
};

/**
 * The illustration printed on the mini pages, at a path ONBOARDING OWNS.
 *
 * Not `/demo/cards/<slug>.png`, and this is the point: the card art under public/demo/cards
 * is a re-cuttable subset of the 46k pool, and it was re-cut mid-build while this slide was
 * being written — the slug it had been pointing at simply stopped existing and the mock went
 * blank. A tutorial is not a card; it must not be a hostage to which cards happen to be in
 * the current subset. The file is a copy of `moon-orbiting-earth`, chosen because the mini
 * page's own words are Kalawakan / Araw / Buwan and the picture should be about what the
 * page says it is. TutorialSlide still degrades to an empty mat if it 404s.
 */
export const DEMO_IMAGE_SRC = '/demo/onboarding-card.png';

/** The small caps label across the top of each onboarding page, per language. */
export const SLIDE_BAND: Record<LanguageKey, { language: string; grade: string; demo: string }> = {
  tagalog: { language: 'Wika', grade: 'Grade', demo: 'Paano gamitin' },
  english: { language: 'Language', grade: 'Grade', demo: 'How it works' },
  cebuano: { language: 'Pinulongan', grade: 'Grade', demo: 'Unsaon paggamit' },
};

/** The pager's two chrome words. Not localised — they are two-letter chrome, as on device. */
export const NAV_BACK = 'BACK';
export const NAV_NEXT = 'NEXT';

/**
 * The way back into onboarding. The app puts "watch it again" in Settings; the browser demo
 * has no settings screen, and once the onboarding record is written the demo never asks
 * again — so without this a returning visitor could never change the language they picked
 * on their first visit. Shown over the cold-start loader, which is the one screen with room
 * for it and the one every returning visitor passes through.
 */
export const LANG_CHANGE: Record<LanguageKey, string> = {
  tagalog: 'Palitan ang wika',
  english: 'Change language',
  cebuano: 'Usbon ang pinulongan',
};
