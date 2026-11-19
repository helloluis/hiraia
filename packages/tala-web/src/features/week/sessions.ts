/**
 * Timeline entries → what the This Week screen shows for each lesson (no React here): time, subject, class, topic
 * per grade group, plan state, the plan link, and the matching pack from the Library. One place, so the "Up next"
 * card and the day rows always agree.
 */
import type { Lang, PackIndex, TimelineEntry } from '@hiraia/tala-core/contracts';
import { suggestPack, termWeekFor, type PackSuggestion } from '../../data/recommend';
import type { useTimeline } from '../../data/timeline';
import { topicLabel } from '../../data/topics';
import { ordinalInWeek, sessionOver, type Clock } from './upnext';

/** The parts of the timeline this file reads (each is stable between renders, so callers can memoise on them). */
type Timeline = Pick<ReturnType<typeof useTimeline>, 'entries' | 'ws' | 'competencyById'>;

export type SessionState = 'taught' | 'partial' | 'notTaught' | 'locked' | 'draft' | 'assumed' | 'none';

export interface TopicView {
  groupId: string;
  grade: string | null;
  /** Short topic title ("Magnets"); empty when no competency is due for this group. */
  title: string;
  /** "Term 2, Weeks 10–11". */
  time: string;
  /** The DepEd competency, verbatim. */
  text: string;
  /** Library help for this group's lesson (Science only). */
  library:
    | { kind: 'pack'; suggestion: PackSuggestion; /** Day 1–5 of the pack that lines up with this lesson, when known. */ day: number | null }
    | { kind: 'none'; grade: string; term: number | null }
    | null;
}

export interface SessionView {
  key: string;
  entry: TimelineEntry;
  date: string;
  startTime: string | null;
  minutes: number;
  subject: string;
  /** Shown only when the teacher has more than one class. */
  className: string | null;
  classId: string;
  multi: boolean;
  topics: TopicView[];
  /** At least one group has a competency due. */
  hasTopic: boolean;
  state: SessionState;
  kind: TimelineEntry['kind'];
  /** Covered before the teacher started using Tala: a quiet, finished row. */
  beforeTala: boolean;
  planTitle: string;
  href: string;
  /** The session is today or earlier and has grade groups to mark. */
  canMark: boolean;
  /** Finished (by the clock) or on a past date. */
  over: boolean;
}

const STATE_OF = (e: TimelineEntry): SessionState =>
  e.mark === 'taught'
    ? 'taught'
    : e.mark === 'partial'
      ? 'partial'
      : e.mark === 'not_taught'
        ? 'notTaught'
        : e.planState === 'locked'
          ? 'locked'
          : e.planState === 'draft'
            ? 'draft'
            : e.mark === 'assumed_taught'
              ? 'assumed'
              : 'none';

export function buildSessions(tl: Timeline, index: PackIndex | null, lang: Lang, now: Clock): SessionView[] {
  const slotOf = (e: TimelineEntry) => tl.ws.assignments.find((a) => a.id === e.assignmentId)?.slots.find((s) => s.id === e.slotId) ?? null;
  const timed = tl.entries.map((e) => ({ date: e.date, assignmentId: e.assignmentId, slotId: e.slotId, startTime: slotOf(e)?.startTime ?? null }));
  return tl.entries
    .map((entry): SessionView => {
      const cls = tl.ws.classes.find((c) => c.id === entry.classId);
      const assignment = tl.ws.assignments.find((a) => a.id === entry.assignmentId);
      const slot = slotOf(entry);
      const groups = Object.keys(entry.byGroup);
      const beforeTala = (entry.kind as string) === 'before_tala' || (entry.mark as string | null) === 'before_tala';
      const where = termWeekFor(tl.ws.activeYear, entry.date);
      const science = assignment?.learningAreaId === 'science';
      const topics = groups.map((gid): TopicView => {
        const grade = cls?.gradeGroups.find((g) => g.id === gid)?.grade ?? null;
        const ids = entry.byGroup[gid] ?? [];
        const comp = ids[0] ? tl.competencyById.get(ids[0]) : null;
        const label = comp ? topicLabel(comp, lang) : null;
        let library: TopicView['library'] = null;
        // The Library holds Science packs. No row at all for other subjects, or for a session of this group that
        // belongs to another subject (multi-grade rooms).
        if (science && grade && !beforeTala && index && entry.byGroupKind?.[gid] !== 'other_subject') {
          const suggestion = suggestPack(index, { grade, competencyIds: ids, term: where?.term ?? null, week: where?.week ?? null, lang });
          library = suggestion
            ? { kind: 'pack', suggestion, day: suggestion.sameWeek ? Math.min(5, ordinalInWeek(timed, entry)) : null }
            : // A lesson with a topic and no pack is said plainly; a buffer or assessment day with none stays quiet.
              ids.length
              ? { kind: 'none', grade, term: where?.term ?? comp?.termIndex ?? null }
              : null;
        }
        return { groupId: gid, grade, title: label?.title ?? '', time: label?.time ?? '', text: label?.text ?? '', library };
      });
      const timing = { date: entry.date, startTime: slot?.startTime ?? null, minutes: entry.minutes };
      return {
        key: `${entry.date}-${entry.assignmentId}-${entry.slotId}`,
        entry,
        date: entry.date,
        startTime: timing.startTime,
        minutes: entry.minutes,
        subject: entry.subjectName,
        className: tl.ws.classes.length > 1 && cls ? cls.name : null,
        classId: entry.classId,
        multi: groups.length > 1,
        topics,
        hasTopic: Boolean(assignment?.learningAreaId) && topics.some((tp) => tp.title),
        state: STATE_OF(entry),
        kind: entry.kind,
        beforeTala,
        planTitle: (entry.planId ? tl.ws.plans.find((p) => p.id === entry.planId)?.title?.trim() : '') || '',
        href: entry.planId
          ? `/lessons/${entry.planId}`
          : `/lessons/new?classId=${entry.classId}&assignmentId=${entry.assignmentId}&date=${entry.date}&slotId=${entry.slotId}`,
        canMark: entry.date <= now.date && groups.length > 0,
        over: sessionOver(timing, now),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') || a.subject.localeCompare(b.subject));
}

/** Distinct grades (numeric order) of the teacher's Science classes, for "Browse Grade N packs" links. */
export function scienceGrades(tl: Timeline): string[] {
  const grades = new Set<string>();
  for (const a of tl.ws.assignments) {
    if (a.learningAreaId !== 'science') continue;
    const cls = tl.ws.classes.find((c) => c.id === a.classId);
    for (const gid of a.gradeGroupIds) {
      const g = cls?.gradeGroups.find((x) => x.id === gid)?.grade;
      if (g) grades.add(g);
    }
  }
  return [...grades].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

export interface WeekPack {
  suggestion: PackSuggestion;
  /** First and last date this pack serves in the range looked at. */
  from: string;
  to: string;
  /** Classes it serves (names), when the teacher has more than one class. */
  classes: string[];
}

/** The distinct packs recommended for a set of lessons, in the order they are first needed, with their dates. */
export function packsFor(sessions: SessionView[], max = 3): WeekPack[] {
  const byId = new Map<string, WeekPack>();
  for (const s of sessions)
    for (const tp of s.topics) {
      if (tp.library?.kind !== 'pack') continue;
      const hit = byId.get(tp.library.suggestion.packId);
      if (!hit) byId.set(tp.library.suggestion.packId, { suggestion: tp.library.suggestion, from: s.date, to: s.date, classes: s.className ? [s.className] : [] });
      else {
        if (s.date < hit.from) hit.from = s.date;
        if (s.date > hit.to) hit.to = s.date;
        if (s.className && !hit.classes.includes(s.className)) hit.classes.push(s.className);
      }
    }
  return [...byId.values()].sort((a, b) => a.from.localeCompare(b.from) || Number(a.suggestion.grade) - Number(b.suggestion.grade)).slice(0, max);
}
