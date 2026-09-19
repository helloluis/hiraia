/** Windows use the device's local calendar; the 24-hour window is elapsed time. */
export function activityWindows(now: number) {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const date = new Date(now);
  const quarter = new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1);
  return [now - 86400000, monday.getTime(), quarter.getTime()];
}
export interface ActivityCounts {
  /** Absolute card_viewed events, including repeats of the same card. */
  cards: number;
  /** Distinct card_id values among those views. Repeats are the gap vs `cards`. */
  unique_cards: number;
  dynamic: number;
  quizzes: number;
  correct: number;
}
export interface ActivitySummary {
  counts: ActivityCounts[];
  since: number;
  asOf: number;
}

/** Grade is the selected grade at event time, never the current Settings value. */
export interface ActivityDetailRow extends ActivityCounts {
  grade: number | null;
  language: string | null;
  cardId: string | null;
  source: string | null;
  lastSeen: number;
}
export interface ActivityReport {
  rows: ActivityDetailRow[];
  days: { grade: number | null; days: number }[];
  since: number;
  asOf: number;
  start: number;
  end: number;
}
export function totalActivity(rows: ActivityDetailRow[]) {
  const total = { cards: 0, unique_cards: 0, dynamic: 0, quizzes: 0, correct: 0 };
  const distinct = new Set<string>();
  let lastSeen = 0;
  for (const row of rows) {
    for (const key of ['cards', 'dynamic', 'quizzes', 'correct'] as const) total[key] += row[key];
    if (row.cards && row.cardId) distinct.add(row.cardId);
    lastSeen = Math.max(lastSeen, row.lastSeen);
  }
  return {
    ...total,
    unique_cards: distinct.size,
    distinct: distinct.size,
    lastSeen,
    accuracy: total.quizzes ? Math.round((total.correct / total.quizzes) * 100) : null,
  };
}
/** Strict local dates, with an inclusive end of day (including DST boundaries). */
export function activityDateRange(from: string, to: string): [number, number] | null {
  const parse = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    const value = new Date(y!, m! - 1, d!);
    return value.getFullYear() === y && value.getMonth() === m! - 1 && value.getDate() === d
      ? value
      : null;
  };
  const a = parse(from),
    b = parse(to);
  if (!a || !b || a > b) return null;
  b.setDate(b.getDate() + 1);
  return [a.getTime(), b.getTime() - 1];
}
