import type { Language } from '@hiraia/shared';

/**
 * UI chrome strings that must follow the active TUTOR language (the model output is
 * already localized by the model itself — one full-parameter fine-tune serves all three languages; this is the app's own text — the sidebar, the loader,
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
    /** Shown if warm-up failed — tapping the field retries, so this must not read as fatal. */
    searchUnavailable: string;
    yourQuestion: string;
    /** a11y label on the ask-ribbon's ✕ — dismisses the asked topic (clears the magnet). */
    dismissAsk: string;
    /** a11y label of the top-right button while it shows the DIE (jump to a fresh topic). */
    reroll: string;
    /** a11y label of the same button while it shows the CALENDAR (opens the outline sheet). */
    openCurriculum: string;
    /** Pops over the ask box for a moment after the die is tapped, so the kid knows what happened. */
    rerollToast: string;
    /** The same pop while calendar mode holds a topic — the die then draws WITHIN that topic. */
    rerollToastTopic: string;
    /**
     * "Curriculum" — the outline sheet's eyebrow and the calendar ribbon's label
     * ("KURIKULUM · Q2 · <topic title>"). The topic titles themselves are NOT here: they are
     * DepEd's CG Content titles, localized in rag/sources/curriculum-guides/content-titles.i18n.json
     * and carried by the generated outline (data/cards.ts topicTitle).
     */
    curriculum: string;
    /** One line under the sheet's title saying what a topic-row tap does. */
    curriculumHint: string;
    /** The four quarter headings of the outline, Q1..Q4 in order. */
    quarters: [string, string, string, string];
    /** a11y label of the outline sheet's close affordance. */
    closeCurriculum: string;
    /** a11y label of the calendar ribbon's ✕ — leaves calendar mode (clears the cursor). */
    exitCurriculum: string;
    /** The outline sheet when the grade has no topics with cards (a guard; should not happen). */
    curriculumEmpty: string;
    thinking: string;
    /** In-domain GAP: it is science, we just have no page for it yet. */
    abstain: string;
    /** Precedes the nearest topic on the gap card (a soft landing back into the deck). */
    abstainSuggest: string;
    /** Not science at all — states the scope of the DECK, never a science topic. */
    offdomain: string;
    /** Static examples under the off-domain line (by definition there is no retrieved topic). */
    offdomainHint: string;
    /**
     * The ask box's readiness status library. STAGE-TRUTHFUL lines only ever show while
     * their stage is genuinely in flight (engineStore.readyStage keys the pool); the
     * evergreen fillers are honest in any stage. `pctDone` interpolates the REAL composed
     * readiness percent ({pct}). Rotated ~10 s with a typewriter — see CardFeedScreen.
     */
    loading: LoadingStrings;
  };
}

/** Status-message library for the search field's readiness bar (see cards.loading). */
interface LoadingStrings {
  /** Load requested, nothing observed yet. */
  connect: string[];
  /** The ~1.27 GB base model streaming in (real percent available). */
  download: string[];
  /** MD5 of the finished download (~15 s of real, silent work). */
  verify: string[];
  /** loadModel reading the verified file into RAM. */
  load: string[];
  /** The GPU load failed and the load restarted on CPU — honestly "taking longer". */
  cpuRetry: string[];
  /** prime() — the throwaway warm-up completion. "Waking up Hiraia" is literal here. */
  warm: string[];
  // No `semantic` entry ON PURPOSE: the LaBSE band only runs after the engine is
  // ready, when the field is the live TextInput showing the real searchPlaceholder —
  // the crawling bar alone tells that story. See the STAGE_KEY note in
  // components/cards/searchReadiness.ts.
  /** True at any stage ("still working", "this takes a few minutes"). */
  evergreen: string[];
  /** "{pct}% done" — only offered while a stage with a REAL signal is running. */
  pctDone: string;
}

const UI_STRINGS: Record<Language, UIStrings> = {
  tagalog: {
    close: '← Isara',
    sectionLanguage: 'Wika',
    langRestartNote: 'Magre-restart ang Hiraia kapag nagpalit ka ng wika.',
    sectionGrade: 'Baitang',
    beta: 'beta',
    comingSoon: 'malapit na!',
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
      searchUnavailable: 'Pindutin para subukan ulit',
      yourQuestion: 'Ang tanong mo',
      dismissAsk: 'Alisin ang tanong',
      reroll: 'Ibang paksa',
      openCurriculum: 'Buksan ang kurikulum',
      rerollToast: 'Bagong random na paksa!',
      rerollToastTopic: 'Random na card sa paksang ito!',
      curriculum: 'Kurikulum',
      curriculumHint: 'Pumili ng paksa — tatapusin natin ang lahat ng kard nito.',
      quarters: ['Unang Markahan', 'Ikalawang Markahan', 'Ikatlong Markahan', 'Ikaapat na Markahan'],
      closeCurriculum: 'Isara ang kurikulum',
      exitCurriculum: 'Lumabas sa kurikulum',
      curriculumEmpty: 'Wala pang kard para sa baitang na ito.',
      thinking: 'Iniisip ko pa',
      abstain: 'Hmm, wala pa akong pahina tungkol diyan.',
      abstainSuggest: 'Pero subukan natin ito',
      offdomain: 'Tutor ako sa agham, kaya agham lang ang laman ng mga kard ko.',
      offdomainHint: 'Subukan mo: hayop, panahon, katawan, o kalawakan.',
      loading: {
        connect: ['Kumokonekta…', 'Inihahanda ang pag-download…'],
        download: ['Dina-download ang utak ni Hiraia…', 'Malaki-laki ito — konting tiis!'],
        verify: ['Sinusuri ang na-download…', 'Tinitingnan kung buo ang file…'],
        load: ['Binubuksan ang modelo…', 'Inilalagay sa memorya…'],
        cpuRetry: ['Medyo natatagalan — sandali pa…'],
        warm: ['Ginigising si Hiraia…', 'Nag-uunat pa si Hiraia…'],
        evergreen: [
        'Gumagana pa rin…',
        'Aabutin ito nang ilang minuto.',
        'Salamat sa paghihintay!',
        // Non-blocking reassurance (Luis, 2026-09-02): the deck works during the whole
        // download, and the child should be TOLD so — the point of the background design
        // is lost if they sit and watch the bar.
        'Pwede ka nang magbasa ng cards habang nagda-download!',
        'Nagda-download lang ng dagdag na content — tuloy lang sa pagbabasa.',
        'Hindi mo kailangang maghintay — i-swipe ang mga card!',
      ],
        // NOTE for native review: "{pct}% na ang tapos" may read more naturally as
        // "{pct}% na ang natapos" — flagged, not self-corrected.
        pctDone: '{pct}% na ang tapos',
      },
    },
  },
  english: {
    close: '← Close',
    sectionLanguage: 'Language',
    langRestartNote: 'Hiraia will restart when you switch languages.',
    sectionGrade: 'Grade',
    beta: 'beta',
    comingSoon: 'coming soon',
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
      searchUnavailable: 'Tap to try again',
      yourQuestion: 'You asked',
      dismissAsk: 'Dismiss your question',
      reroll: 'Surprise me',
      openCurriculum: 'Open the curriculum',
      rerollToast: 'New Random Topic!',
      rerollToastTopic: 'Random card from this topic!',
      curriculum: 'Curriculum',
      curriculumHint: "Pick a topic — we'll go through all of its cards.",
      quarters: ['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'],
      closeCurriculum: 'Close the curriculum',
      exitCurriculum: 'Leave the curriculum',
      curriculumEmpty: 'No cards for this grade yet.',
      thinking: "I'm thinking",
      abstain: "Hmm, I don't have a page about that yet.",
      abstainSuggest: "But let's try this",
      offdomain: "I'm a science tutor, so all my cards are about science.",
      offdomainHint: 'Try: animals, weather, your body, or space.',
      loading: {
        connect: ['Connecting…', 'Getting the download ready…'],
        download: ["Downloading Hiraia's brain…", "It's a big file — hang tight!"],
        verify: ['Checking the download…', 'Making sure every byte arrived…'],
        load: ['Opening the model…', 'Loading it into memory…'],
        cpuRetry: ['Taking a little longer — hang on…'],
        warm: ['Waking Hiraia up…', 'Hiraia is stretching…'],
        evergreen: [
        'Still working…',
        'This will take a few minutes.',
        'Thanks for waiting!',
        'You can read cards while we download!',
        'Downloading extra content — keep reading.',
        'No need to wait — swipe through the cards!',
      ],
        pctDone: '{pct}% done',
      },
    },
  },
  cebuano: {
    close: '← Isira',
    sectionLanguage: 'Pinulongan',
    langRestartNote: 'Mag-restart ang Hiraia kung mag-ilis ka og pinulongan.',
    sectionGrade: 'Grado',
    beta: 'beta',
    comingSoon: 'hapit na!',
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
      searchUnavailable: 'I-tap para sulayan pag-usab',
      yourQuestion: 'Ang pangutana nimo',
      dismissAsk: 'Kuhaa ang pangutana',
      // NOTE for native review (calendar mode, drafted 2026-09-05, flagged not self-corrected):
      //   • "Kwarter" for a school quarter — DepEd Cebuano materials also use "Markahan";
      //     confirm which reads naturally to a Grade 5 reader.
      //   • ordinals "Ikaduhang / Ikatulong / Ikaupat nga" — check the linker forms.
      //   • "humanon nato" for "we'll finish/go through" — check register.
      reroll: 'Laing hilisgutan',
      openCurriculum: 'Ablihi ang kurikulum',
      //   • "random" is borrowed as in the Tagalog line; check whether "sapalaran" / "bisan
      //     unsa" reads more naturally to a Cebuano child.
      rerollToast: 'Bag-ong random nga hilisgutan!',
      rerollToastTopic: 'Random nga card gikan niini nga hilisgutan!',
      curriculum: 'Kurikulum',
      curriculumHint: 'Pilia ang hilisgutan — humanon nato ang tanan niyang kard.',
      quarters: ['Unang Kwarter', 'Ikaduhang Kwarter', 'Ikatulong Kwarter', 'Ikaupat nga Kwarter'],
      closeCurriculum: 'Isira ang kurikulum',
      exitCurriculum: 'Gawas sa kurikulum',
      curriculumEmpty: 'Wala pay kard para niini nga grado.',
      thinking: 'Naghunahuna pa ko',
      abstain: 'Hmm, wala pa koy panid mahitungod ana.',
      abstainSuggest: 'Pero sulayan nato ni',
      offdomain: 'Tutor ko sa siyensya, mao nga siyensya ra ang sulod sa akong mga kard.',
      offdomainHint: 'Sulayi: mananap, panahon, lawas, o kawanangan.',
      // NOTE for native review: drafted to match the Tagalog set — do NOT ship to
      // Cebuano-mode testers unchecked. Specific flags (flagged, not self-corrected):
      //   • "Gida-download" — not a standard Cebuano progressive; likely
      //     "Gina-download" or "Gi-download pa" (it reads like Tagalog "dina-download"
      //     transposed).
      //   • "Moabot kini og pipila ka minuto" — "moabot" is "will arrive"; for a
      //     duration a speaker would say "Molungtad kini og pipila ka minuto".
      //   • gi- vs gina- aspect on "Gisusi" / "Gitan-aw" / "Giablihan" / "Gibutang":
      //     the gi- forms carry completed aspect and can read as already-done rather
      //     than in-progress (compare the correctly progressive "Ginapukaw").
      //   • "Nag-inat pa si Hiraia" — check idiomatic register.
      loading: {
        connect: ['Nagkonektar…', 'Giandam ang download…'],
        download: ['Gida-download ang utok ni Hiraia…', 'Dako-dako kini — pailub lang!'],
        verify: ['Gisusi ang na-download…', 'Gitan-aw kung kompleto ang file…'],
        load: ['Giablihan ang modelo…', 'Gibutang sa memorya…'],
        cpuRetry: ['Medyo nadugay — kadiyot na lang…'],
        warm: ['Ginapukaw si Hiraia…', 'Nag-inat pa si Hiraia…'],
        evergreen: [
        'Nagtrabaho pa gihapon…',
        'Moabot kini og pipila ka minuto.',
        'Salamat sa paghulat!',
        // FLAGGED for native review with the other ceb loading lines.
        'Pwede ka magbasa og cards samtang nag-download!',
        'Nag-download og dugang content — padayon lang sa pagbasa.',
        'Dili na kinahanglan maghulat — i-swipe ang mga card!',
      ],
        pctDone: '{pct}% na ang nahuman',
      },
    },
  },
};

/** UI strings for the active language (null → Tagalog default). */
export function uiStrings(language: Language | null | undefined): UIStrings {
  return UI_STRINGS[language ?? 'tagalog'];
}
