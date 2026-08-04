/**
 * Trilingual strings for the question-cards feed — WEB DEMO copy, kept verbatim in
 * sync with the mobile `cards` block in packages/mobile/src/config/strings.ts (plus
 * `quiz.correct`), with one web-only addition: `demoNote` explains that the real app
 * answers typed questions on-device (the browser demo has no model, so a retrieval
 * miss shows the honest abstention card).
 */
import type { LanguageKey } from '@/config/model';

export interface CardStrings {
  questionHeader: string;
  continueNote: string;
  readLabel: string;
  searchPlaceholder: string;
  yourQuestion: string;
  thinking: string;
  abstain: string;
  abstainSuggest: string;
  correct: string;
  demoNote: string;
}

const STRINGS: Record<LanguageKey, CardStrings> = {
  tagalog: {
    questionHeader: 'Tanong! ✏️',
    continueNote: 'ituloy',
    readLabel: 'pahina',
    searchPlaceholder: 'Anong gusto mong malaman?',
    yourQuestion: 'Ang tanong mo',
    thinking: 'Iniisip ko pa',
    abstain: 'Hmm, wala pa akong alam diyan.',
    abstainSuggest: 'Pero subukan natin ito',
    correct: 'Tama! 🎉',
    demoNote: 'Sa totoong app, sasagutin ito ni Hiraia on-device — kahit walang internet.',
  },
  english: {
    questionHeader: 'Question! ✏️',
    continueNote: 'continue',
    readLabel: 'pages',
    searchPlaceholder: 'What do you want to learn about?',
    yourQuestion: 'You asked',
    thinking: "I'm thinking",
    abstain: "Hmm, I don't know about that yet.",
    abstainSuggest: "But let's try this",
    correct: 'Correct! 🎉',
    demoNote: 'In the real app, Hiraia answers this on-device — even offline.',
  },
  cebuano: {
    questionHeader: 'Pangutana! ✏️',
    continueNote: 'padayon',
    readLabel: 'panid',
    searchPlaceholder: 'Unsa ang gusto nimong hibaw-an?',
    yourQuestion: 'Ang pangutana nimo',
    thinking: 'Naghunahuna pa ko',
    abstain: 'Hmm, wala pa ko kahibalo ana.',
    abstainSuggest: 'Pero sulayan nato ni',
    correct: 'Husto! 🎉',
    demoNote: 'Sa tinuod nga app, tubagon ni Hiraia on-device — bisan walay internet.',
  },
};

export function cardStrings(language: LanguageKey): CardStrings {
  return STRINGS[language] ?? STRINGS.tagalog;
}
