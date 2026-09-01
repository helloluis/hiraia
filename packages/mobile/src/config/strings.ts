import type { Language } from '@hiraia/shared';

/**
 * UI chrome strings that must follow the active TUTOR language (the model output is
 * already localized by the adapter; this is the app's own text — the sidebar, the loader,
 * and the card feed's own chrome). Tagalog is the default/fallback.
 * Cebuano is "coming soon" but kept native so a beta switch reads correctly.
 *
 * Add new user-facing strings HERE (never inline) so English/Cebuano modes stay fully
 * localized. Look strings up via `uiStrings(activeLanguage)`.
 */
/** Quiz-mode chrome (the app's own text; questions/options come from the bank). */
interface QuizStrings {
  button: string; // top-bar "QUIZ!" label
  confirmTitle: string;
  confirmBody: string;
  confirmStart: string;
  confirmCancel: string;
  topicPrompt: string;
  topicPlaceholder: string;
  tryLabel: string; // precedes the suggestion chips
  start: string;
  unsupported: string;
  progress: string; // "Question {n} of {total}" — {n}/{total} interpolated
  timeUp: string;
  correct: string;
  next: string;
  finish: string; // shown on the last question instead of `next`
  resultTitle: string;
  score: string; // "Score: {score}/{total}"
  praiseHigh: string;
  praiseMid: string;
  praiseLow: string;
  playAgain: string;
  end: string;
}

interface UIStrings {
  // sidebar
  close: string;
  sectionLanguage: string;
  langRestartNote: string;
  sectionGrade: string; // the student's grade level (chips 3–10)
  beta: string;
  comingSoon: string;
  sectionNotes: string;
  noNotes: string;
  sectionVersion: string;
  labelModel: string;
  facts: string;
  tutorial: string;
  showTutorial: string;
  // loader
  bootingUp: string;
  // quiz mode
  quiz: QuizStrings;
  // question-cards feed (home screen)
  cards: {
    questionHeader: string;
    continueNote: string;
    readLabel: string;
    /** Eyebrow on the single-path "next" ticket (mid-century card). */
    nextCard: string;
    /** Banner announcing a two-way split in the thread (mid-century card). */
    fork: string;
    searchPlaceholder: string;
    /** Shown in the search field while the model is still warming (the feed itself needs none). */
    searchWarming: string;
    /** Shown if warm-up failed — tapping the field retries, so this must not read as fatal. */
    searchUnavailable: string;
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
  };
}

const UI_STRINGS: Record<Language, UIStrings> = {
  tagalog: {
    close: '← Isara',
    sectionLanguage: 'Wika',
    langRestartNote: 'Sandali itong magri-restart kapag pinalitan.',
    sectionGrade: 'Baitang',
    beta: 'beta',
    comingSoon: 'malapit na!',
    sectionNotes: 'Mga Tala',
    noNotes: 'Wala pang tala',
    sectionVersion: 'Bersyon',
    labelModel: 'Modelo',
    facts: 'datos',
    tutorial: 'Tutorial',
    showTutorial: 'Ipakita ang tutorial',
    bootingUp: 'nag-boot up pa...',
    quiz: {
      button: 'QUIZ!',
      confirmTitle: 'Magsimula ng pagsusulit?',
      confirmBody: 'Magsisimula tayo ng bagong laro.',
      confirmStart: 'Sige!',
      confirmCancel: 'Hindi muna',
      topicPrompt: 'Anong paksa ang gusto mong i-quiz?',
      topicPlaceholder: 'hal. dinosaur, kalawakan, katawan ng tao',
      tryLabel: 'Subukan:',
      start: 'Simulan',
      unsupported:
        'Pasensya, hindi pa kami makakagawa ng quiz tungkol diyan. Subukan ang ibang paksa!',
      progress: 'Tanong {n} ng {total}',
      timeUp: 'Naubos ang oras!',
      correct: 'Tama! 🎉',
      next: 'Susunod',
      finish: 'Tingnan ang iskor',
      resultTitle: 'Tapos na!',
      score: 'Iskor: {score}/{total}',
      praiseHigh: 'Ang galing mo! 🌟',
      praiseMid: 'Magaling! Patuloy lang. 💪',
      praiseLow: 'Magandang simula! Subukan ulit. 🐱',
      playAgain: 'Ulitin?',
      end: 'Tapusin',
    },
    cards: {
      questionHeader: 'Tanong! ✏️',
      continueNote: 'ituloy',
      readLabel: 'pahina',
      nextCard: 'Sunod na kard',
      fork: 'Sangandaan',
      searchPlaceholder: 'Anong gusto mong malaman?',
      searchWarming: 'Ginigising si Hiraia…',
      searchUnavailable: 'Pindutin para subukan ulit',
      yourQuestion: 'Ang tanong mo',
      thinking: 'Iniisip ko pa',
      abstain: 'Hmm, wala pa akong pahina tungkol diyan.',
      abstainSuggest: 'Pero subukan natin ito',
      offdomain: 'Tutor ako sa agham, kaya agham lang ang laman ng mga kard ko.',
      offdomainHint: 'Subukan mo: hayop, panahon, katawan, o kalawakan.',
    },
  },
  english: {
    close: '← Close',
    sectionLanguage: 'Language',
    langRestartNote: 'It restarts briefly when you switch.',
    sectionGrade: 'Grade',
    beta: 'beta',
    comingSoon: 'coming soon',
    sectionNotes: 'Notes',
    noNotes: 'No notes yet',
    sectionVersion: 'Version',
    labelModel: 'Model',
    facts: 'facts',
    tutorial: 'Tutorial',
    showTutorial: 'Show the tutorial',
    bootingUp: 'still booting up...',
    quiz: {
      button: 'QUIZ!',
      confirmTitle: 'Start a quiz?',
      confirmBody: "We'll start a fresh game.",
      confirmStart: "Let's go!",
      confirmCancel: 'Not now',
      topicPrompt: 'What topic do you want to be quizzed on?',
      topicPlaceholder: 'e.g. dinosaurs, space, the human body',
      tryLabel: 'Try:',
      start: 'Start',
      unsupported: "Sorry, we can't make a quiz about that yet. Try another topic!",
      progress: 'Question {n} of {total}',
      timeUp: "Time's up!",
      correct: 'Correct! 🎉',
      next: 'Next',
      finish: 'See score',
      resultTitle: 'All done!',
      score: 'Score: {score}/{total}',
      praiseHigh: 'Amazing! 🌟',
      praiseMid: 'Nice work! Keep going. 💪',
      praiseLow: 'Good start! Try again. 🐱',
      playAgain: 'Start again?',
      end: 'End quiz',
    },
    cards: {
      questionHeader: 'Question! ✏️',
      continueNote: 'continue',
      readLabel: 'pages',
      nextCard: 'Next card',
      fork: 'Crossroads',
      searchPlaceholder: 'What do you want to learn about?',
      searchWarming: 'Waking Hiraia up…',
      searchUnavailable: 'Tap to try again',
      yourQuestion: 'You asked',
      thinking: "I'm thinking",
      abstain: "Hmm, I don't have a page about that yet.",
      abstainSuggest: "But let's try this",
      offdomain: "I'm a science tutor, so all my cards are about science.",
      offdomainHint: 'Try: animals, weather, your body, or space.',
    },
  },
  cebuano: {
    close: '← Sirado',
    sectionLanguage: 'Pinulongan',
    langRestartNote: 'Mag-restart kini dali kung mag-usab ka.',
    sectionGrade: 'Grado',
    beta: 'beta',
    comingSoon: 'hapit na!',
    sectionNotes: 'Mga Nota',
    noNotes: 'Wala pay nota',
    sectionVersion: 'Bersyon',
    labelModel: 'Modelo',
    facts: 'datos',
    tutorial: 'Tutorial',
    showTutorial: 'Ipakita ang tutorial',
    bootingUp: 'nag-boot up pa...',
    quiz: {
      button: 'QUIZ!',
      confirmTitle: 'Magsugod og pagsulay?',
      confirmBody: 'Magsugod ta og bag-ong dula.',
      confirmStart: 'Sige!',
      confirmCancel: 'Dili sa',
      topicPrompt: 'Unsa nga hilisgutan ang gusto nimong sulayan?',
      topicPlaceholder: 'pananglitan dinosaur, kawanangan, lawas sa tawo',
      tryLabel: 'Sulayi:',
      start: 'Sugod',
      unsupported:
        'Pasayloa, dili pa mi makahimo og quiz bahin niana. Sulayi ang laing hilisgutan!',
      progress: 'Pangutana {n} sa {total}',
      timeUp: 'Nahurot na ang oras!',
      correct: 'Husto! 🎉',
      next: 'Sunod',
      finish: 'Tan-awa ang iskor',
      resultTitle: 'Human na!',
      score: 'Iskor: {score}/{total}',
      praiseHigh: 'Maayo kaayo! 🌟',
      praiseMid: 'Maayo! Padayon lang. 💪',
      praiseLow: 'Maayong sugod! Sulayi pag-usab. 🐱',
      playAgain: 'Usba?',
      end: 'Tapuson',
    },
    cards: {
      questionHeader: 'Pangutana! ✏️',
      continueNote: 'padayon',
      readLabel: 'panid',
      nextCard: 'Sunod nga kard',
      fork: 'Sangang-dalan',
      searchPlaceholder: 'Unsa ang gusto nimong hibaw-an?',
      searchWarming: 'Ginapukaw si Hiraia…',
      searchUnavailable: 'I-tap para sulayan pag-usab',
      yourQuestion: 'Ang pangutana nimo',
      thinking: 'Naghunahuna pa ko',
      abstain: 'Hmm, wala pa koy panid mahitungod ana.',
      abstainSuggest: 'Pero sulayan nato ni',
      offdomain: 'Tutor ko sa siyensya, mao nga siyensya ra ang sulod sa akong mga kard.',
      offdomainHint: 'Sulayi: mananap, panahon, lawas, o kawanangan.',
    },
  },
};

/** UI strings for the active language (null → Tagalog default). */
export function uiStrings(language: Language | null | undefined): UIStrings {
  return UI_STRINGS[language ?? 'tagalog'];
}
