/**
 * The grade levels the web demo offers — a local port of the mobile app's
 * packages/mobile/src/config/grades.ts (keep the two in sync).
 *
 * The default is Grade 5 on purpose: most of our kids are behind academically, so the
 * tutor pitches low unless told otherwise. On device the grade drives the tutor's static
 * system prompt AND the feed's curriculum weighting (FEED-WEIGHTING.md); see the note on
 * `grade` in useDemoStore for exactly how far that reaches in the browser demo today.
 *
 * Typed locally rather than imported from `@hiraia/shared`: that package resolves into
 * @qvac/sdk's bare-runtime shims, which is why the web demo deliberately keeps it off the
 * client. This is eight numbers — cheaper to restate than to drag a runtime in for.
 */
export type GradeLevel = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export const GRADE_OPTIONS: readonly GradeLevel[] = [3, 4, 5, 6, 7, 8, 9, 10];

export const DEFAULT_GRADE: GradeLevel = 5;

/** Parse a persisted/untrusted value ("3".."10") into a GradeLevel; null if it isn't one. */
export function toGradeLevel(value: string | number | null | undefined): GradeLevel | null {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  return GRADE_OPTIONS.find((g) => g === n) ?? null;
}

/**
 * The word that precedes the number wherever a grade is SHOWN to a kid. English "Grade" in
 * all three languages on purpose: Filipino schools say "Grade 5" even when the rest of the
 * sentence is Tagalog (DepEd's "Baitang" / "Grado" read formal, and no kid says them out
 * loud). Same call, and the same single definition, as the app.
 */
export const GRADE_WORD: Record<string, string> = {
  tagalog: 'Grade',
  english: 'Grade',
  cebuano: 'Grade',
};
