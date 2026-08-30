import type { Language } from '@hiraia/shared';

/**
 * UI chrome strings that must follow the active TUTOR language (the model output is
 * already localized by the adapter; this is the app's own text — welcome note, input
 * placeholder, sidebar, status/error messages). Tagalog is the default/fallback.
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
  // chat screen
  welcomeTitle: string;
  welcomeSubtitle: string;
  inputPlaceholder: string;
  inputPreparing: string;
  /**
   * Shown in the chat input when the model load FAILED (most often: the LoRA
   * adapter could not be fetched, so the tutor would have had to run as the raw
   * base model, which fabricates — see LocalEngine.resolveAdapterPath). Tapping
   * the bar retries, so like `cards.searchUnavailable` this must read as
   * recoverable, not fatal.
   */
  inputUnavailable: string;
  waitPreparing: string;
  errorGeneric: string;
  // per-turn "thinking" narration (cosmetic; shown before the first token, never sent to the model)
  thinkingSearching: string;
  thinkingReadingAbout: string; // followed by the retrieved topic, e.g. "… dinosaur"
  thinkingReading: string; // fallback when the topic isn't clean enough to show
  thinkingWorking: string;
  // sidebar
  close: string;
  sectionLanguage: string;
  langRestartNote: string;
  sectionGrade: string; // the student's grade level (chips 3–10)
  beta: string;
  comingSoon: string;
  sectionConversations: string;
  noConversations: string;
  sectionNotes: string;
  noNotes: string;
  sectionVersion: string;
  labelModel: string;
  facts: string;
  tutorial: string;
  showTutorial: string;
  newConversation: string;
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
    welcomeTitle: 'Maligayang Pagdating sa Hiraia!',
    welcomeSubtitle:
      'Magtanong ka ng kahit ano tungkol sa agham. Nandito ako para tulungan kang matuto.',
    inputPlaceholder: 'Magtanong tungkol sa agham...',
    inputPreparing: 'Inihahanda ang AI...',
    inputUnavailable: 'Hindi handa si Hiraia—pindutin para subukan ulit',
    waitPreparing: 'Sandali lang—inihahanda ko pa ang AI. Pakisubukang muli sa ilang segundo. 🐱',
    errorGeneric: 'Paumanhin, may naganap na error. Pakisubukang muli. 🐱',
    thinkingSearching: 'Naghahanap ng sagot',
    thinkingReadingAbout: 'Binabasa ang tungkol sa',
    thinkingReading: 'Binabasa ang nahanap',
    thinkingWorking: 'Iniisip ang sagot',
    close: '← Isara',
    sectionLanguage: 'Wika',
    langRestartNote: 'Sandali itong magri-restart kapag pinalitan.',
    sectionGrade: 'Baitang',
    beta: 'beta',
    comingSoon: 'malapit na!',
    sectionConversations: 'Mga Usapan',
    noConversations: 'Wala pang usapan',
    sectionNotes: 'Mga Tala',
    noNotes: 'Wala pang tala',
    sectionVersion: 'Bersyon',
    labelModel: 'Modelo',
    facts: 'datos',
    tutorial: 'Tutorial',
    showTutorial: 'Ipakita ang tutorial',
    newConversation: '+ Bagong Usapan',
    bootingUp: 'nag-boot up pa...',
    quiz: {
      button: 'QUIZ!',
      confirmTitle: 'Magsimula ng pagsusulit?',
      confirmBody: 'Lilinisin natin ang usapan at magsisimula ng bagong laro.',
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
    welcomeTitle: 'Welcome to Hiraia!',
    welcomeSubtitle: "Ask me anything about science. I'm here to help you learn.",
    inputPlaceholder: 'Ask about science...',
    inputPreparing: 'Preparing the AI...',
    inputUnavailable: "Hiraia isn't ready—tap to try again",
    waitPreparing: "One moment—I'm still preparing the AI. Please try again in a few seconds. 🐱",
    errorGeneric: 'Sorry, something went wrong. Please try again. 🐱',
    thinkingSearching: 'Looking for the answer',
    thinkingReadingAbout: 'Reading about',
    thinkingReading: 'Reading what I found',
    thinkingWorking: 'Thinking it through',
    close: '← Close',
    sectionLanguage: 'Language',
    langRestartNote: 'It restarts briefly when you switch.',
    sectionGrade: 'Grade',
    beta: 'beta',
    comingSoon: 'coming soon',
    sectionConversations: 'Conversations',
    noConversations: 'No conversations yet',
    sectionNotes: 'Notes',
    noNotes: 'No notes yet',
    sectionVersion: 'Version',
    labelModel: 'Model',
    facts: 'facts',
    tutorial: 'Tutorial',
    showTutorial: 'Show the tutorial',
    newConversation: '+ New Conversation',
    bootingUp: 'still booting up...',
    quiz: {
      button: 'QUIZ!',
      confirmTitle: 'Start a quiz?',
      confirmBody: "We'll clear the chat and start a fresh game.",
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
    welcomeTitle: 'Maayong Pag-abot sa Hiraia!',
    welcomeSubtitle:
      'Pangutana bisan unsa bahin sa siyensya. Ania ko aron motabang nimo nga makakat-on.',
    inputPlaceholder: 'Pangutana bahin sa siyensya...',
    inputPreparing: 'Giandam ang AI...',
    inputUnavailable: 'Dili pa andam si Hiraia—i-tap para sulayan pag-usab',
    waitPreparing:
      'Kadiyot lang—giandam pa nako ang AI. Palihug sulayi pag-usab sa pipila ka segundo. 🐱',
    errorGeneric: 'Pasayloa, naay sayop nga nahitabo. Palihug sulayi pag-usab. 🐱',
    thinkingSearching: 'Nangita og tubag',
    thinkingReadingAbout: 'Gibasa ang bahin sa',
    thinkingReading: 'Gibasa ang nakit-an',
    thinkingWorking: 'Gihunahuna ang tubag',
    close: '← Sirado',
    sectionLanguage: 'Pinulongan',
    langRestartNote: 'Mag-restart kini dali kung mag-usab ka.',
    sectionGrade: 'Grado',
    beta: 'beta',
    comingSoon: 'hapit na!',
    sectionConversations: 'Mga Panag-istorya',
    noConversations: 'Wala pay panag-istorya',
    sectionNotes: 'Mga Nota',
    noNotes: 'Wala pay nota',
    sectionVersion: 'Bersyon',
    labelModel: 'Modelo',
    facts: 'datos',
    tutorial: 'Tutorial',
    showTutorial: 'Ipakita ang tutorial',
    newConversation: '+ Bag-ong Panag-istorya',
    bootingUp: 'nag-boot up pa...',
    quiz: {
      button: 'QUIZ!',
      confirmTitle: 'Magsugod og pagsulay?',
      confirmBody: 'Limpyohan nato ang panag-istorya ug magsugod og bag-ong dula.',
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
