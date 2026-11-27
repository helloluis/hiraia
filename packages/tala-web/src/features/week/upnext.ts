/**
 * "What am I teaching next?" — the calendar-aware next teaching day (pure; `now` is passed in so it can be tested).
 *
 * The next teaching day is the first date, from today on, with at least one session on the timeline that is not
 * over yet. Today counts while a session is still running or still to come; a session with no start time counts
 * for the whole day. Days without a session on the timeline (a weekend without classes, holidays, suspensions, term
 * breaks) are simply rolled past (three weeks ahead by default); a Saturday or Sunday class is a teaching day.
 */
import { addDays, isoDate, mondayOf } from '../../data/ids';

/** A moment on the teacher's device: local date and minutes since local midnight. */
export interface Clock {
  date: string;
  minutes: number;
}
export const clockOf = (d: Date): Clock => ({ date: isoDate(d), minutes: d.getHours() * 60 + d.getMinutes() });

export interface SessionTime {
  date: string;
  /** 'HH:MM' (24 h) or null when the teacher did not give a time. */
  startTime: string | null;
  minutes: number;
}

export const LOOKAHEAD_DAYS = 21;

const startMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A session is over once its date has passed or, today, once its start time plus its length has passed. */
export function sessionOver(s: SessionTime, now: Clock): boolean {
  if (s.date !== now.date) return s.date < now.date;
  if (!s.startTime) return false;
  return now.minutes >= startMinutes(s.startTime) + s.minutes;
}

export function nextTeachingDate(sessions: SessionTime[], now: Clock, lookaheadDays = LOOKAHEAD_DAYS): string | null {
  const last = addDays(now.date, lookaheadDays);
  let best: string | null = null;
  for (const s of sessions) {
    if (s.date < now.date || s.date > last || sessionOver(s, now)) continue;
    if (best === null || s.date < best) best = s.date;
  }
  return best;
}

/** How a date relates to today, for "Today / Tomorrow / <weekday>" labels. */
export function dayRelation(date: string, today: string): 'today' | 'tomorrow' | 'later' | 'past' {
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  return date < today ? 'past' : 'later';
}

/**
 * Position (1-based) of a session among the same subject's sessions in its Monday-to-Sunday week: the third
 * Science lesson of the week lines up with Day 3 of that week's pack. `sessions` may hold other subjects and weeks.
 */
export function ordinalInWeek(
  sessions: Array<{ date: string; assignmentId: string; slotId: string; startTime: string | null }>,
  of: { date: string; assignmentId: string; slotId: string }
): number {
  const week = mondayOf(of.date);
  const mine = sessions
    .filter((s) => s.assignmentId === of.assignmentId && mondayOf(s.date) === week)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.slotId.localeCompare(b.slotId));
  const i = mine.findIndex((s) => s.date === of.date && s.slotId === of.slotId);
  return i < 0 ? 1 : i + 1;
}

/** '08:00' → '8:00 AM'. Teachers read class times on a 12-hour clock in both languages. */
export function formatClock(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2));
  return `${h % 12 || 12}:${hhmm.slice(3, 5)} ${h < 12 ? 'AM' : 'PM'}`;
}
