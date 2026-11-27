/**
 * Words the multi-grade session slides add around each grade's own slides (decks/assemble.ts): block dividers,
 * "Meanwhile" slides, the plain slide that stands in for missing slides, credits titles and the footer.
 *
 * FILIPINO: first drafts by the feature's author, NOT yet reviewed by a fluent Filipino-speaking teacher (PRD §14.3),
 * kept here in one place for the Filipino owner's pass. Grade names follow the combined plan's own words
 * (plan/combine-words.ts: "Grade 2" / "Baitang 2").
 */
import type { Lang } from '../contracts/common';
import { COMBINE_WORDS } from '../plan/combine-words';

export type SessionMode = 'direct' | 'independent' | 'peer' | 'shared';

export interface SessionWords {
  gradeLabel: (grade: string) => string;
  allGrades: string;
  minutes: (n: number) => string;
  /** Cover line: the grades and the length of the period. */
  coverLine: (grades: string[], minutes: number) => string;
  footer: (grades: string[], subject: string) => string;
  /** A grade's task while the teacher is with another grade. */
  meanwhileTitle: (grade: string) => string;
  /** How a grade works in a block, as a short phrase. */
  mode: Record<SessionMode, string>;
  /** One line on a turn's divider: what the others do meanwhile. */
  meanwhileLine: (parts: string[]) => string;
  /** The teacher is with a grade (notes). */
  withTeacher: (grade: string) => string;
  everyoneAlone: string;
  /** In place of a grade's slides when its lesson has none. */
  missingTitle: (grade: string) => string;
  /** In place of a grade's slides when no lesson of that grade was found for the session. */
  noLessonTitle: (grade: string) => string;
  missingLead: string;
  missingNote: (grade: string) => string;
  noLessonNote: (grade: string) => string;
  creditsTitle: (grade: string) => string;
  about: string;
  /** Notes heading for a block: "Grade 2 with the teacher · 12 min". */
  blockNote: (label: string, minutes: number) => string;
}

const list = (items: string[], and: string): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`;

export const SESSION_WORDS: Record<Lang, SessionWords> = {
  en: {
    gradeLabel: COMBINE_WORDS.en.gradeLabel,
    allGrades: 'All grades',
    minutes: (n) => `${n} min`,
    coverLine: (grades, minutes) => `${list(grades, 'and')} · ${minutes} minutes`,
    footer: (grades, subject) => `Grades ${list(grades, 'and')} · ${subject || 'Multi-grade session'}`,
    meanwhileTitle: (grade) => `Meanwhile, ${grade}`,
    mode: { direct: 'with the teacher', independent: 'on their own', peer: 'with a partner', shared: 'together' },
    meanwhileLine: (parts) => `Meanwhile: ${parts.join(' · ')}`,
    withTeacher: (grade) => `You are with ${grade}.`,
    everyoneAlone: 'Every grade works on its own.',
    missingTitle: (grade) => `No slides yet for ${grade}'s lesson`,
    noLessonTitle: (grade) => `No lesson chosen for ${grade}`,
    missingLead: 'Teach this part from the lesson plan.',
    missingNote: (grade) => `${grade}'s lesson has no slides yet. Open the session's slides in Tala and choose "Make slides" for ${grade}; they appear here in this block.`,
    noLessonNote: (grade) => `Tala did not find ${grade}'s own lesson for this session. Choose it under the session's slides in Tala so its slides appear here.`,
    creditsTitle: (grade) => `About ${grade}'s slides`,
    about: 'About these slides',
    blockNote: (label, minutes) => `${label} · ${minutes} min`,
  },
  fil: {
    gradeLabel: COMBINE_WORDS.fil.gradeLabel,
    allGrades: 'Lahat ng baitang',
    minutes: (n) => `${n} min`,
    coverLine: (grades, minutes) => `${list(grades, 'at')} · ${minutes} minuto`,
    footer: (grades, subject) => `Baitang ${list(grades, 'at')} · ${subject || 'Klaseng multigrade'}`,
    meanwhileTitle: (grade) => `Samantala, ${grade}`,
    mode: { direct: 'kasama ang guro', independent: 'sariling gawain', peer: 'kasama ang kapareha', shared: 'sabay-sabay' },
    meanwhileLine: (parts) => `Samantala: ${parts.join(' · ')}`,
    withTeacher: (grade) => `Kasama mo ang ${grade}.`,
    everyoneAlone: 'May sariling gawain ang bawat baitang.',
    missingTitle: (grade) => `Wala pang slides ang aralin ng ${grade}`,
    noLessonTitle: (grade) => `Wala pang napiling aralin para sa ${grade}`,
    missingLead: 'Ituro ang bahaging ito mula sa lesson plan.',
    missingNote: (grade) => `Wala pang slides ang aralin ng ${grade}. Buksan ang slides ng klaseng ito sa Tala at piliin ang "Gumawa ng slides" para sa ${grade}. Lalabas sila rito sa bahaging ito.`,
    noLessonNote: (grade) => `Walang nakitang sariling aralin ng ${grade} para sa klaseng ito. Piliin ito sa slides ng klase sa Tala para lumabas dito ang mga slide nito.`,
    creditsTitle: (grade) => `Tungkol sa slides ng ${grade}`,
    about: 'Tungkol sa mga slide',
    blockNote: (label, minutes) => `${label} · ${minutes} min`,
  },
};
