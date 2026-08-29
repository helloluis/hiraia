import type { GradeLevel, Language } from '@hiraia/shared';

/**
 * The grade levels the app offers, in display order. The default is Grade 5 on purpose:
 * most of our kids are behind academically, so the tutor pitches low unless told otherwise.
 * The grade drives the tutor's static system prompt ("grade-N students") and the grounded
 * feed answers. Persisted in the SQLite settings key 'grade' as a digit string ("3".."10")
 * — see engineStore.
 */
export const GRADE_OPTIONS: readonly GradeLevel[] = [3, 4, 5, 6, 7, 8, 9, 10];

export const DEFAULT_GRADE: GradeLevel = 5;

/** Parse a persisted/untrusted value ("3".."10") into a GradeLevel; null if it isn't one. */
export function toGradeLevel(value: string | number | null | undefined): GradeLevel | null {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  return GRADE_OPTIONS.find((g) => g === n) ?? null;
}

/**
 * The word that precedes the number wherever a grade is SHOWN to a kid — the onboarding
 * buttons and the deck footer. English "Grade" in all three languages on purpose: Filipino
 * schools say "Grade 5" even when the rest of the sentence is Tagalog (DepEd's "Baitang" /
 * "Grado" read formal, and no kid says them out loud). Kept as a per-language map, and as
 * the SINGLE definition both surfaces read, so a native reviewer can change one language
 * without the two screens drifting apart.
 *
 * (The Settings section HEADING is different — that's chrome, not the label on a number,
 * so it is localised normally in strings.ts as `sectionGrade`.)
 */
export const GRADE_WORD: Record<Language, string> = {
  tagalog: 'Grade',
  english: 'Grade',
  cebuano: 'Grade',
};
