/** Windows use the device's local calendar; the 24-hour window is elapsed time. */
export function activityWindows(now: number) {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const date = new Date(now);
  const quarter = new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
  return [now - 86400000, monday.getTime(), quarter.getTime()];
}
export interface ActivityCounts {
  cards: number;
  dynamic: number;
  quizzes: number;
  correct: number;
}
export interface ActivitySummary {
  counts: ActivityCounts[];
  since: number;
  asOf: number;
}
