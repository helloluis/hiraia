/**
 * What a learner did, reduced to what the teacher's page counts — ported from Tala 0.4.4
 * LearningActivity.kt, SchoolPeriods.kt and RosterIdentity.kt (branch tala-0.4.x).
 */
import type { Catalog } from './catalog';

/** A card view or graded quiz. */
export type LearningEvent = {
  name: string;
  occurredAt: number;
  correct: boolean;
  cardId: string;
  questionId: string;
};

export type ActivityTotals = { viewed: number; unique: number; quizzes: number; correct: number };

/** Unique counts distinct curated cards; a generated card has no id, so it never is. */
export function totalsOf(events: LearningEvent[]): ActivityTotals {
  const views = events.filter((e) => e.name === 'card_viewed');
  const quizzes = events.filter((e) => e.name === 'quiz_graded');
  return {
    viewed: views.length,
    unique: new Set(views.map((v) => v.cardId).filter(Boolean)).size,
    quizzes: quizzes.length,
    correct: quizzes.filter((q) => q.correct).length,
  };
}

export type SubcategoryDay = { label: string; totals: ActivityTotals };
export type DayActivity = { date: string; totals: ActivityTotals; subcategories: SubcategoryDay[] };

export const NO_SUBCATEGORY = '\u0000none';

/**
 * One day of a learner's learning: its totals and the subcategories it was spent in, busiest first,
 * what could not be placed last. A card in two subcategories is listed under both; the day's own
 * totals count it once. `date` is an ISO calendar date in the teacher's zone.
 */
export async function dayActivity(
  date: string,
  events: LearningEvent[],
  catalog: Catalog
): Promise<DayActivity> {
  const placed = await catalog.subcategories(events);
  const groups = new Map<string, LearningEvent[]>();
  events.forEach((event, i) => {
    const labels = placed[i] ?? [];
    for (const label of labels.length ? [...new Set(labels)] : [NO_SUBCATEGORY]) {
      const list = groups.get(label);
      if (list) list.push(event);
      else groups.set(label, [event]);
    }
  });
  const subcategories = [...groups.entries()]
    .sort(
      (a, b) =>
        Number(a[0] === NO_SUBCATEGORY) - Number(b[0] === NO_SUBCATEGORY) ||
        b[1].length - a[1].length ||
        (a[0] === NO_SUBCATEGORY ? '' : a[0].toLowerCase()).localeCompare(
          b[0] === NO_SUBCATEGORY ? '' : b[0].toLowerCase()
        )
    )
    .map(([label, grouped]) => ({ label, totals: totalsOf(grouped) }));
  return { date, totals: totalsOf(events), subcategories };
}

// ---- calendar helpers (SchoolPeriods.kt). Dates are local-time ISO days; `now` is epoch ms. ----

export type SchoolPeriod = { key: 'today' | 'lastDay' | 'lastWeek'; start: number; end: number };

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}
const isWeekend = (ms: number) => [0, 6].includes(new Date(ms).getDay());

/** Today, the last school day, and the Monday–Friday week that most recently finished. */
export function schoolPeriods(now: number): SchoolPeriod[] {
  const today = startOfDay(now);
  let lastDay = addDays(today, -1);
  while (isWeekend(lastDay)) lastDay = addDays(lastDay, -1);
  // On a school day this week is still under way, so the week shown is the one before.
  const dow = new Date(today).getDay();
  let monday = addDays(today, -((dow + 6) % 7));
  if (!isWeekend(today)) monday = addDays(monday, -7);
  return [
    { key: 'today', start: today, end: addDays(today, 1) },
    { key: 'lastDay', start: lastDay, end: addDays(lastDay, 1) },
    { key: 'lastWeek', start: monday, end: addDays(monday, 5) },
  ];
}

export function isoDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayBounds(isoDate: string): { start: number; end: number } {
  const [y, m, d] = isoDate.split('-').map(Number);
  const start = new Date(y!, m! - 1, d!).getTime();
  return { start, end: addDays(start, 1) };
}

// ---- roster identity (RosterIdentity.kt) ----

export const ANIMALS = ['🐢', '🦊', '🐳', '🦉', '🐻', '🦋', '🐸', '🐧', '🐯', '🐨', '🦜', '🐰'];
export const AVATAR_COLORS = ['#FFDAC6', '#F5DEA4', '#D1EACC', '#CFE4F2', '#E3D8F4', '#F5D7DF'];

export type RosterStudent = { installationId: string; profileId: string; name: string };
export type RosterCard<S extends RosterStudent> = {
  student: S;
  displayName: string;
  animalIndex: number;
  colorIndex: number;
};

const normalized = (value: string) =>
  value.trim().replace(/\s+/g, ' ').normalize('NFKC').toLowerCase();

/** Duplicate names get stable numeric suffixes; the order they are numbered in is deterministic. */
export function displayNames<S extends RosterStudent>(students: S[]): Map<S, string> {
  const names = new Map<S, string>();
  const used = new Set<string>();
  const occurrences = new Map<string, number>();
  const sorted = [...students].sort(
    (a, b) =>
      normalized(a.name).localeCompare(normalized(b.name)) ||
      a.profileId.localeCompare(b.profileId) ||
      a.installationId.localeCompare(b.installationId)
  );
  for (const student of sorted) {
    const base = student.name.trim().replace(/\s+/g, ' ');
    const canonical = normalized(base);
    let number = (occurrences.get(canonical) ?? 0) + 1;
    let candidate = number === 1 ? base : `${base}-${number}`;
    while (used.has(normalized(candidate))) {
      number++;
      candidate = `${base}-${number}`;
    }
    occurrences.set(canonical, number);
    used.add(normalized(candidate));
    names.set(student, candidate);
  }
  return names;
}

/**
 * Animal and colour from SHA-256("hiraia-tala-avatar-v1\0installation\0profileKey"), so the same
 * student phones get the same avatars on a replacement Tala phone. Guests share one profile key.
 * The palettes and hash inputs are a contract (0.4.x README): do not reorder.
 */
export async function avatarFor(
  student: RosterStudent,
  sha256: (bytes: Uint8Array) => Promise<Uint8Array>
): Promise<{ animalIndex: number; colorIndex: number }> {
  const profileKey =
    student.profileId === 'guest' || student.name.startsWith('Guest-')
      ? 'guest'
      : student.profileId;
  const digest = await sha256(
    new TextEncoder().encode(
      `hiraia-tala-avatar-v1\u0000${student.installationId}\u0000${profileKey}`
    )
  );
  return {
    animalIndex: digest[0]! % ANIMALS.length,
    colorIndex: digest[1]! % AVATAR_COLORS.length,
  };
}

export async function rosterCards<S extends RosterStudent>(
  students: S[],
  sha256: (bytes: Uint8Array) => Promise<Uint8Array>
): Promise<RosterCard<S>[]> {
  const names = displayNames(students);
  const out: RosterCard<S>[] = [];
  for (const student of students)
    out.push({ student, displayName: names.get(student)!, ...(await avatarFor(student, sha256)) });
  return out;
}
