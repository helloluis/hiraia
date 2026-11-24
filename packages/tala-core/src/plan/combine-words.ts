/**
 * Words the multi-grade combiner writes into a plan: block names, the session note, and the few generic
 * instructions it gives a grade group that is waiting for, or has just had, its turn with the teacher.
 *
 * Everything here ends up as ordinary editable text in the teacher's own draft.
 *
 * FILIPINO: first drafts by the feature's author, NOT yet reviewed by a fluent Filipino-speaking teacher
 * (PRD §14.3). They are kept in this separate file so the Filipino editorial pass can revise them in one place.
 */
import type { Lang } from '../contracts/common';

export interface CombineWords {
  opening: string;
  closing: string;
  /** Rotation block name. */
  turn: (gradeLabel: string) => string;
  gradeLabel: (grade: string) => string;
  teacher: string;
  learners: string;
  /** Waiting for the teacher, first block: think and get ready. */
  prepare: string;
  /** Waiting for the teacher, a further block: talk it over in pairs. */
  prepareInPairs: string;
  goal: string;
  materials: string;
  /** After the teacher's turn: carry on with the activity alone. */
  carryOn: string;
  exitTicket: string;
  /** After the teacher's turn, nothing specific left from the lesson. */
  checkWithPartner: string;
  finishedEarly: string;
  wrapUp: string;
  handIn: string;
  bigIdea: string;
  supportHeading: string;
  planTitle: (parts: string[]) => string;
  note: (args: { grades: string[]; minutesEach: number; sources: string[] }) => string;
  noteManyGroups: string;
  noteShortTurns: string;
}

const list = (items: string[], and: string): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;

export const COMBINE_WORDS: Record<Lang, CombineWords> = {
  en: {
    opening: 'Start together',
    closing: 'Finish together',
    turn: (g) => `${g} with the teacher`,
    gradeLabel: (grade) => `Grade ${grade}`,
    teacher: 'Teacher',
    learners: 'Learners',
    prepare: 'Work on your own first. Read today’s goal. Write or draw what you already know about it. Get your materials ready.',
    prepareInPairs: 'Work with a partner. Tell each other what you already know about today’s goal, then write one question you want answered.',
    goal: 'Today’s goal',
    materials: 'Materials',
    carryOn: 'Carry on by yourselves',
    exitTicket: 'Exit ticket',
    checkWithPartner: 'Check your work with a partner. Fix anything that is not clear, then write one thing you learned today.',
    finishedEarly: 'If you finish early',
    wrapUp: 'Wrap up',
    handIn: 'Hand in your work.',
    bigIdea: 'Big idea',
    supportHeading: 'Support and extension',
    planTitle: (parts) => parts.join(' · '),
    note: ({ grades, minutesEach, sources }) =>
      `One plan for ${list(grades, 'and')}. Everyone starts and finishes together. In between you teach one grade at a time (about ${minutesEach} minutes each) while the others work on their own.${sources.length ? ` Combined from: ${sources.join('; ')}.` : ''} Read every box and change what does not fit your class.`,
    noteManyGroups:
      'With three or more grades, each turn with you is short. If two grades have a similar topic, teach them together and give the time you save to the others.',
    noteShortTurns: 'The turns are very short for this period. Consider teaching one grade today and the other in the next session.',
  },
  fil: {
    opening: 'Sabay-sabay na simula',
    closing: 'Sabay-sabay na pagtatapos',
    turn: (g) => `${g} kasama ang guro`,
    gradeLabel: (grade) => `Baitang ${grade}`,
    teacher: 'Guro',
    learners: 'Mga mag-aaral',
    prepare: 'Mag-isa munang gumawa. Basahin ang layunin ng aralin ngayong araw. Isulat o iguhit ang alam mo na tungkol dito. Ihanda ang mga kagamitan mo.',
    prepareInPairs: 'Magpares. Sabihin sa isa’t isa kung ano na ang alam ninyo tungkol sa layunin ng aralin ngayong araw. Pagkatapos, sumulat ng isang tanong na gusto ninyong masagot.',
    goal: 'Layunin ng aralin ngayong araw',
    materials: 'Mga kagamitan',
    carryOn: 'Ituloy ang gawain nang kayo lang',
    exitTicket: 'Exit ticket',
    checkWithPartner: 'Suriin ang gawa mo kasama ang kapareha. Linawin ang anumang malabo. Pagkatapos, isulat ang isang natutuhan mo ngayong araw.',
    finishedEarly: 'Kung maaga kang natapos',
    wrapUp: 'Paglalahat',
    handIn: 'Ipasa ang inyong gawa.',
    bigIdea: 'Big idea',
    supportHeading: 'Tulong at dagdag na hamon',
    planTitle: (parts) => parts.join(' · '),
    note: ({ grades, minutesEach, sources }) =>
      `Isang plano para sa ${list(grades, 'at')}. Sabay-sabay ang simula at pagtatapos ng klase. Sa gitna, turuan ang bawat baitang nang isa-isa (mga ${minutesEach} minuto bawat isa) habang may sariling gawain ang iba.${sources.length ? ` Mga araling pinagsama: ${sources.join('; ')}.` : ''} Basahin ang bawat kahon at i-edit ang kailangan para bumagay sa klase mo.`,
    noteManyGroups:
      'Kapag tatlo o higit pa ang baitang, maikli ang oras mo sa bawat isa. Kung magkahawig ang paksa ng dalawang baitang, puwede mo silang turuan nang sabay at gamitin sa ibang baitang ang oras na matitipid.',
    noteShortTurns: 'Napakaikli ng oras mo sa bawat baitang. Puwede mong turuan ang isang baitang ngayon at ang isa sa susunod na klase.',
  },
};

/**
 * Lesson phases as the teaching packs name them (MATATAG procedure), in both languages, so a plan made from a
 * pack can be read back into its phases. Titles a teacher has reworded fall back to their position in the lesson.
 */
export const PHASE_TITLES: Array<{ role: 'open' | 'develop' | 'close' | 'assess'; titles: string[] }> = [
  { role: 'open', titles: ['Activating prior knowledge', 'Pagkuha ng Dating Kaalaman', 'Establishing lesson purpose', 'Paglalahad ng Layunin'] },
  { role: 'develop', titles: ['Developing and deepening understanding', 'Paglinang at Pagpapalalim'] },
  { role: 'close', titles: ['Making generalizations', 'Paglalahat'] },
  { role: 'assess', titles: ['Evaluating learning', 'Pagtataya'] },
];

/** Labels that mark the teacher's and the learners' lines inside a step (as the pack conversion writes them). */
export const TEACHER_LABELS = ['Teacher', 'Guro'];
export const LEARNER_LABELS = ['Learners', 'Mga mag-aaral', 'Mag-aaral'];
