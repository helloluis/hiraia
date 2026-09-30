import type { Language } from '@hiraia/shared';
import type { LanguageInput } from './types';

/** Child-facing copy; the preview label preserves the content-admission distinction. */
const COPY = {
  english: {
    onboarding: 'Start with a 12-item Quiz!',
    nudge: 'Quiz time? 12 items only!',
    due: 'Ready for your next 12-item quiz?',
    title: 'Hiraia quiz',
    preview: 'Assessment preview',
    question: 'Question',
    pick: 'Choose one answer. We will review the answers after all 12 questions.',
    loading: 'Getting your quiz ready…',
    saving: 'Saving your answer…',
    error: 'Your quiz could not be saved or loaded. Your saved answers are kept. Try again to continue.',
    startError: 'A complete quiz could not be started. You can try again or return to your cards.',
    dateError: 'Check the date and time in your phone settings, then try again. Your saved answers are kept.',
    retry: 'Try again',
    finish: 'Back to my cards',
    done: 'Quiz complete!',
    correct: 'Correct answers',
    benchmark: 'Benchmark questions',
    recent: 'From cards you recently read',
    readiness: 'Earlier-level foundations',
    counts: 'Each group shows the questions actually included in this quiz.',
    scope: 'This checks what you remember within Hiraia. It is not a full school exam or a grade-level verdict. Your teacher can compare it with your classroom work.',
    previewNote: 'Preview questions are still awaiting teacher and language review.',
    baseline: 'This quiz is a starting point for later Hiraia quizzes with matching grade, language, support and question coverage.',
    comparison: 'Compare benchmark questions over time. A different mix of questions can change the total score.',
    comparisonStart: 'This starts a new comparison group. Quiz language, support, grade and question coverage need to match before comparing progress.',
    benchmarkChange: 'Change from the previous comparable quiz',
    recheck: 'Try this idea again',
    review: 'Your answers',
    yourAnswer: 'Your answer',
    answer: 'Correct answer',
    reinforce: 'Worth revisiting',
    remembered: 'Remembered this time',
    noRecent: 'No recent-card questions were eligible this time.',
  },
  tagalog: {
    onboarding: 'Magsimula sa 12-item Quiz!',
    nudge: 'Quiz muna? 12 tanong lang!',
    due: 'Handa na sa susunod na 12-item quiz?',
    title: 'Hiraia quiz',
    preview: 'Assessment preview',
    question: 'Tanong',
    pick: 'Pumili ng isang sagot. Balikan natin ang mga sagot matapos ang 12 tanong.',
    loading: 'Inihahanda ang iyong quiz…',
    saving: 'Sine-save ang iyong sagot…',
    error: 'Hindi ma-save o mabuksan ang iyong quiz. Nananatili ang mga sagot na na-save. Subukang muli para magpatuloy.',
    startError: 'Hindi masimulan ang isang buong quiz. Maaari kang sumubok muli o bumalik sa mga card.',
    dateError: 'Tingnan ang petsa at oras sa mga setting ng telepono, saka subukang muli. Nananatili ang mga sagot na na-save.',
    retry: 'Subukang muli',
    finish: 'Balik sa mga card',
    done: 'Tapos na ang quiz!',
    correct: 'Mga tamang sagot',
    benchmark: 'Mga tanong para sa paghahambing',
    recent: 'Mula sa mga card na binasa mo kamakailan',
    readiness: 'Mga pundasyon mula sa mas mababang antas',
    counts: 'Ipinapakita ng bawat grupo ang mga tanong na kasama sa quiz na ito.',
    scope: 'Sinusukat nito ang naaalala mo sa loob ng Hiraia. Hindi ito buong pagsusulit sa paaralan o pasya sa iyong antas. Maaaring ihambing ng guro ang resulta sa iyong gawain sa klase.',
    previewNote: 'Hinihintay pa ng mga tanong sa preview ang pagsusuri ng guro at tagasuri ng wika.',
    baseline: 'Panimulang tala ito para sa mga susunod na Hiraia quiz na magkatugma ang baitang, wika, tulong, at saklaw ng mga tanong.',
    comparison: 'Ihambing ang mga benchmark question sa paglipas ng panahon. Maaaring magbago ang kabuuang marka dahil sa magkaibang mga tanong.',
    comparisonStart: 'Simula ito ng bagong grupo para sa paghahambing. Kailangang magkatugma ang wika, tulong, baitang, at saklaw ng mga tanong bago ihambing ang pag-unlad.',
    benchmarkChange: 'Pagbabago mula sa naunang maihahambing na quiz',
    recheck: 'Subukan muli ang ideyang ito',
    review: 'Mga sagot mo',
    yourAnswer: 'Sagot mo',
    answer: 'Tamang sagot',
    reinforce: 'Balikan natin ito',
    remembered: 'Naalala mo ngayon',
    noRecent: 'Walang tanong mula sa mga bagong binasang card na angkop ngayon.',
  },
  cebuano: {
    onboarding: 'Sugdi sa 12-item Quiz!',
    nudge: 'Quiz sa? 12 ka pangutana ra!',
    due: 'Andam na sa sunod nga 12-item quiz?',
    title: 'Hiraia quiz',
    preview: 'Assessment preview',
    question: 'Pangutana',
    pick: 'Pili ug usa ka tubag. Balikan nato ang mga tubag human sa 12 ka pangutana.',
    loading: 'Giandam ang imong quiz…',
    saving: 'Gi-save ang imong tubag…',
    error: 'Dili ma-save o maablihan ang imong quiz. Naa gihapon ang mga tubag nga na-save. Sulayi pag-usab aron makapadayon.',
    startError: 'Dili masugdan ang usa ka kompleto nga quiz. Mahimo kang mosulay pag-usab o mobalik sa mga card.',
    dateError: 'Susihon ang petsa ug oras sa mga setting sa telepono, dayon sulayi pag-usab. Naa gihapon ang mga tubag nga na-save.',
    retry: 'Sulayi pag-usab',
    finish: 'Balik sa mga card',
    done: 'Nahuman na ang quiz!',
    correct: 'Mga saktong tubag',
    benchmark: 'Mga pangutana alang sa pagtandi',
    recent: 'Gikan sa mga card nga bag-o nimong nabasa',
    readiness: 'Mga pundasyon gikan sa ubos nga lebel',
    counts: 'Gipakita sa matag grupo ang mga pangutana nga apil niini nga quiz.',
    scope: 'Gisukod niini ang imong nahinumdoman sulod sa Hiraia. Dili kini tibuok eksamin sa eskwelahan o paghukom sa imong lebel. Mahimong itandi sa magtutudlo ang resulta sa imong buluhaton sa klase.',
    previewNote: 'Ang mga pangutana sa preview naghulat pa sa pagsusi sa magtutudlo ug tigsusi sa pinulongan.',
    baseline: 'Sinugdanan kini alang sa sunod nga mga Hiraia quiz nga magkatugma ang grado, pinulongan, tabang, ug sakop sa mga pangutana.',
    comparison: 'Itandi ang mga benchmark question sa paglabay sa panahon. Mahimong mausab ang kinatibuk-ang marka tungod sa lainlaing mga pangutana.',
    comparisonStart: 'Sinugdanan kini sa bag-ong grupo alang sa pagtandi. Kinahanglan magkatugma ang pinulongan, tabang, grado, ug sakop sa mga pangutana sa pagtandi sa pag-uswag.',
    benchmarkChange: 'Kausaban gikan sa miaging quiz nga mahimong itandi',
    recheck: 'Sulayi pag-usab kini nga ideya',
    review: 'Imong mga tubag',
    yourAnswer: 'Imong tubag',
    answer: 'Saktong tubag',
    reinforce: 'Balikan nato kini',
    remembered: 'Nahinumdoman nimo karon',
    noRecent: 'Walay pangutana gikan sa bag-ong nabasang mga card nga angay karon.',
  },
} satisfies Record<Language, Record<string, string>>;

export function assessmentCopy(language: Language) {
  return COPY[language];
}

/** Persisted sessions use compact bank keys; speech and app copy use full names. */
export function assessmentUiLanguage(language: LanguageInput): Language {
  if (language === 'en' || language === 'english') return 'english';
  if (language === 'tl' || language === 'tagalog') return 'tagalog';
  return 'cebuano';
}

/** A failed load may conceal a saved session. Only a confirmed, unstarted quiz can close. */
export function canLeaveAssessmentError(loaded: boolean, hasSession: boolean, hasResults: boolean): boolean {
  return loaded && !hasSession && !hasResults;
}

export type AssessmentPageKind = 'fact' | 'quiz' | 'recap' | 'title' | 'reward' | 'response';
export interface AssessmentFeedState {
  foreground: boolean;
  focused: boolean;
  onboarding: boolean;
  choosingProfile: boolean;
  asking: boolean;
  review: boolean;
  sheet: boolean;
  assessment: boolean;
  search: boolean;
  memoryNotice: boolean;
  liveVisible: boolean;
  pageKind: AssessmentPageKind;
  loaded: boolean;
  busy: boolean;
}

export function assessmentFeedGates(state: AssessmentFeedState) {
  const unobstructed = state.foreground && state.focused && !state.onboarding
    && !state.choosingProfile && !state.asking && !state.review && !state.sheet
    && !state.assessment && !state.search && !state.memoryNotice;
  return {
    unobstructed,
    quiet: unobstructed && state.liveVisible && state.pageKind === 'fact' && state.loaded && !state.busy,
  };
}

/** The first assessment rotates; subsequent due reminders remain a quiet, static entry. */
export function assessmentReminder({ eligible, completed, due, quiet, quizFace }: {
  eligible: boolean;
  completed: number;
  due: boolean;
  quiet: boolean;
  quizFace: boolean;
}): 'initial' | 'due' | null {
  if (!eligible || !quiet) return null;
  if (completed === 0) return quizFace ? 'initial' : null;
  return due ? 'due' : null;
}
