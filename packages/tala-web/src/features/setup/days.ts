/**
 * The days a subject meets, as chosen in setup and on the class screen. Luis, 27 Nov 2026: "Saturday and Sunday
 * classes need to be supported because some schools don't have a choice when they will hold their classes." So all
 * seven ISO weekdays (1 = Monday … 7 = Sunday) can be chosen; the pacing engine treats a chosen Saturday or Sunday
 * as a real class day. Pure: no React, no I/O.
 */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** A subject added in setup starts on the school week, Monday to Friday; the teacher changes it in one tap. */
export const DEFAULT_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/**
 * A date in a fixed Monday-to-Sunday week (1–7 January 2024), so a weekday can be named with the app's usual date
 * formatter (`formatDate`, UTC noon) and reads the same in every time zone the app supports.
 */
export const weekdayReference = (weekday: number): string => `2024-01-0${weekday}`;

/** Add or remove one day; the result is always distinct days in Monday-to-Sunday order. */
export function toggleDay(days: readonly number[], day: number): number[] {
  const next = new Set(days);
  if (next.has(day)) next.delete(day);
  else next.add(day);
  return [...next].sort((a, b) => a - b);
}

/** A Saturday (6) or Sunday (7) is among the days. */
export const hasWeekend = (days: readonly number[]): boolean => days.some((d) => d >= 6);
