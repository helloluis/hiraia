/**
 * Trilingual strings for the question-cards feed — WEB DEMO copy, kept verbatim in sync with
 * the mobile `cards` block in packages/mobile/src/config/strings.ts (plus `quiz.correct`),
 * with one web-only addition: `demoNote`, which says that the real app does this on-device.
 *
 * The three answer shapes have three sentences and they are NOT interchangeable:
 *   abstain   — an in-domain GAP. "No page about that yet" — it is science, we just don't
 *               stock it. Followed by `abstainSuggest` + the nearest topic.
 *   offdomain — not science at all. States the scope of the DECK, never a science topic, and
 *               is followed by `offdomainHint`: four STATIC subjects the bank is genuinely
 *               dense in (there is no retrieved topic to offer, and offering one anyway is
 *               precisely the behaviour this shape removes).
 *   generated — no sentence of its own; the printed card is the model's.
 */
import type { LanguageKey } from '@/config/model';

export interface CardStrings {
  questionHeader: string;
  continueNote: string;
  readLabel: string;
  searchPlaceholder: string;
  yourQuestion: string;
  thinking: string;
  /** In-domain GAP: it is science, we just have no page for it yet. */
  abstain: string;
  /** Precedes the nearest topic on the gap card (a soft landing back into the deck). */
  abstainSuggest: string;
  /** Not science at all — states the scope of the DECK, never a science topic. */
  offdomain: string;
  /** Static examples under the off-domain line (by definition there is no retrieved topic). */
  offdomainHint: string;
  correct: string;
  demoNote: string;
  /** Accessible name for the in-feed language switch (onboarding's "you can change this later"). */
  languageLabel: string;
}

const STRINGS: Record<LanguageKey, CardStrings> = {
  tagalog: {
    questionHeader: 'Tanong! ✏️',
    continueNote: 'ituloy',
    readLabel: 'pahina',
    searchPlaceholder: 'Anong gusto mong malaman?',
    yourQuestion: 'Ang tanong mo',
    thinking: 'Iniisip ko pa',
    abstain: 'Hmm, wala pa akong pahina tungkol diyan.',
    abstainSuggest: 'Pero subukan natin ito',
    offdomain: 'Tutor ako sa agham, kaya agham lang ang laman ng mga kard ko.',
    offdomainHint: 'Subukan mo: hayop, panahon, katawan, o kalawakan.',
    correct: 'Tama! 🎉',
    demoNote: 'Sa totoong app, ginagawa ito ni Hiraia on-device — kahit walang internet.',
    languageLabel: 'Palitan ang wika',
  },
  english: {
    questionHeader: 'Question! ✏️',
    continueNote: 'continue',
    readLabel: 'pages',
    searchPlaceholder: 'What do you want to learn about?',
    yourQuestion: 'You asked',
    thinking: "I'm thinking",
    abstain: "Hmm, I don't have a page about that yet.",
    abstainSuggest: "But let's try this",
    offdomain: "I'm a science tutor, so all my cards are about science.",
    offdomainHint: 'Try: animals, weather, your body, or space.',
    correct: 'Correct! 🎉',
    demoNote: 'In the real app, Hiraia does this on-device — even offline.',
    languageLabel: 'Change the language',
  },
  cebuano: {
    questionHeader: 'Pangutana! ✏️',
    continueNote: 'padayon',
    readLabel: 'panid',
    searchPlaceholder: 'Unsa ang gusto nimong hibaw-an?',
    yourQuestion: 'Ang pangutana nimo',
    thinking: 'Naghunahuna pa ko',
    abstain: 'Hmm, wala pa koy panid mahitungod ana.',
    abstainSuggest: 'Pero sulayan nato ni',
    offdomain: 'Tutor ko sa siyensya, mao nga siyensya ra ang sulod sa akong mga kard.',
    offdomainHint: 'Sulayi: mananap, panahon, lawas, o kawanangan.',
    correct: 'Husto! 🎉',
    demoNote: 'Sa tinuod nga app, gihimo ni Hiraia on-device — bisan walay internet.',
    languageLabel: 'Ilisan ang pinulongan',
  },
};

export function cardStrings(language: LanguageKey): CardStrings {
  return STRINGS[language] ?? STRINGS.tagalog;
}
