import type { GradeLevel } from '@hiraia/shared';

/**
 * The grade levels the app offers, in display order. The default is Grade 5 on purpose:
 * most of our kids are behind academically, so the tutor pitches low unless told otherwise.
 * The grade drives the tutor's static system prompt ("grade-N students"), the feed's
 * curriculum weighting, and the grounded feed answers. Persisted in the SQLite settings
 * key 'grade' as a digit string ("3".."10") — see engineStore.
 */
export const GRADE_OPTIONS: readonly GradeLevel[] = [3, 4, 5, 6, 7, 8, 9, 10];

export const DEFAULT_GRADE: GradeLevel = 5;

/** Parse a persisted/untrusted value ("3".."10") into a GradeLevel; null if it isn't one. */
export function toGradeLevel(value: string | number | null | undefined): GradeLevel | null {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  return GRADE_OPTIONS.find((g) => g === n) ?? null;
}
