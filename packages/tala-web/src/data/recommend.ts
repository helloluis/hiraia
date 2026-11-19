/**
 * Which ready-made teaching pack fits a lesson (pure: no React, no I/O).
 *
 * A lesson on the teacher's timeline names the DepEd competencies due that day; every pack in the library index
 * lists the competencies of its week. A pack is suggested when it is for the same grade and shares a competency
 * with the lesson ("topic" match). When a competency runs over several weeks there are several such packs: the
 * one whose week is closest to where the lesson's date falls in the teacher's own calendar wins. A session with
 * no competency (a buffer or an assessment day) falls back to the pack of the same grade, term and calendar week.
 * Nothing is guessed from words or titles, and only a pack the teacher may open is ever suggested.
 */
import type { PackIndex, PackIndexEntry, PackLang, PackStatus } from '@hiraia/tala-core/contracts';

const DAY = 86_400_000;
const noon = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!, 12);
};
/** Monday (as a UTC-noon timestamp) of the Monday-to-Sunday week that contains `iso`. */
const mondayMs = (iso: string): number => {
  const t = noon(iso);
  return t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;
};

/** 1-based week of a term for a date; weeks run Monday to Sunday, counted from the week the term starts in. */
export function weekOfTerm(termStart: string, date: string): number {
  return Math.round((mondayMs(date) - mondayMs(termStart)) / (7 * DAY)) + 1;
}

/** Where a date falls in a school year: the term's index and the week of that term. Null between terms. */
export function termWeekFor(
  year: { terms: Array<{ index: number; startDate: string; endDate: string }> } | null,
  date: string
): { term: number; week: number } | null {
  const term = year?.terms.find((t) => t.startDate <= date && t.endDate >= date);
  return term ? { term: term.index, week: weekOfTerm(term.startDate, date) } : null;
}

export interface PackQuery {
  grade: string;
  /** Competencies due in the session for this grade group (may be empty). */
  competencyIds: string[];
  /** Where the session's date falls in the teacher's calendar; null between terms or without a calendar. */
  term: number | null;
  week: number | null;
  /** Interface language: its version of the pack is preferred. */
  lang: PackLang;
}

export interface PackSuggestion {
  packId: string;
  grade: string;
  term: number;
  week: number;
  /** Printed topic of the week (always present, any language). */
  topic: string;
  /** Pack title in the language offered. */
  title: string;
  /** The language version to open. */
  language: PackLang;
  /** Offered in the other language because the interface language's version cannot be opened. */
  otherLanguage: boolean;
  /** Review status of the version offered (never softened: draft, needs_work or approved). */
  status: PackStatus;
  /** Built files exist, so the cover thumbnail can be shown. */
  hasFiles: boolean;
  /** 'topic' = shares a competency with the lesson; 'calendar' = only the same grade, term and week. */
  match: 'topic' | 'calendar';
  /** The pack is for the very week the lesson falls in, so its Day 1–5 line up with that week's lessons. */
  sameWeek: boolean;
}

function offer(entry: PackIndexEntry, q: PackQuery, match: PackSuggestion['match']): PackSuggestion | null {
  const mine = entry.variants[q.lang];
  const other = entry.variants[q.lang === 'fil' ? 'en' : 'fil'];
  const v = mine.viewable ? mine : other.viewable ? other : null;
  if (!v) return null;
  return {
    packId: entry.packId,
    grade: entry.grade,
    term: entry.term,
    week: entry.week,
    topic: entry.topic,
    title: v.title ?? entry.topic,
    language: v.language,
    otherLanguage: v !== mine,
    status: v.status,
    hasFiles: v.files.length > 0,
    match,
    sameWeek: q.term === entry.term && q.week === entry.week,
  };
}

/** Terms never have more than 20 weeks (contract), so this orders weeks across terms. */
const position = (term: number, week: number) => term * 20 + week;

export function suggestPack(index: Pick<PackIndex, 'packs'> | null | undefined, q: PackQuery): PackSuggestion | null {
  if (!index) return null;
  const openable = index.packs.filter((p) => p.grade === q.grade && (p.variants.en.viewable || p.variants.fil.viewable));
  if (q.competencyIds.length) {
    const wanted = new Set(q.competencyIds);
    const here = q.term !== null && q.week !== null ? position(q.term, q.week) : null;
    const byTopic = openable
      .filter((p) => p.competencyIds.some((id) => wanted.has(id)))
      .sort((a, b) => {
        const pa = position(a.term, a.week);
        const pb = position(b.term, b.week);
        // Closest to the lesson's own week; the earlier week when two are equally close or the week is unknown.
        return here === null ? pa - pb : Math.abs(pa - here) - Math.abs(pb - here) || pa - pb;
      });
    // A lesson with a topic gets a pack on that topic or none: the calendar week's pack may teach something else.
    return byTopic[0] ? offer(byTopic[0], q, 'topic') : null;
  }
  if (q.term === null || q.week === null) return null;
  const sameWeek = openable.find((p) => p.term === q.term && p.week === q.week);
  return sameWeek ? offer(sameWeek, q, 'calendar') : null;
}
