'use client';
/**
 * Timeline assembly: records + curriculum packs → PacingEngine inputs. All computation is the shared, pure
 * engine from @hiraia/tala-core/pacing (PACE-2); this file only gathers inputs and groups results for screens.
 */
import { useMemo } from 'react';
import { engine } from '@hiraia/tala-core/pacing';
import {
  DEFAULT_PACING_PARAMS,
  type Competency,
  type PacingInput,
  type PacingParams,
  type PacingPlan,
  type PacingTrack,
  type TimelineEntry,
  type TimelineInput,
} from '@hiraia/tala-core/contracts';
import { useCurriculumIndex, packIdsFor, usePacks } from './curriculum';
import { isoDate } from './ids';
import { useSession } from './session';
import { useWorkspace, type Workspace } from './records';

export function pacingDefaults(config: { pacingDefaults: PacingParams } | null): PacingParams {
  return config?.pacingDefaults ?? DEFAULT_PACING_PARAMS;
}

export function timelineInput(ws: Workspace, competencies: Competency[], from: string, to: string, today: string, defaults: PacingParams): TimelineInput | null {
  if (!ws.activeYear) return null;
  return {
    from,
    to,
    today,
    schoolYear: ws.activeYear,
    classes: ws.classes,
    assignments: ws.assignments.filter(a => ws.classes.some(c => c.id === a.classId)),
    tracks: ws.tracks,
    calendarDays: ws.calendarDays.filter(d => d.schoolYearId === ws.activeYear!.id),
    competencies,
    checks: ws.checks,
    marks: ws.marks,
    plans: ws.plans,
    pairingOverrides: ws.pairingOverrides,
    defaults,
  };
}

export function pacingInputFor(ws: Workspace, competencies: Competency[], track: PacingTrack, today: string, defaults: PacingParams): PacingInput | null {
  const year = ws.activeYear;
  const term = year?.terms.find(t => t.id === track.termId);
  const assignment = ws.assignments.find(a => a.id === track.assignmentId);
  const cls = ws.classes.find(c => c.id === track.classId);
  const group = cls?.gradeGroups.find(g => g.id === track.gradeGroupId);
  if (!year || !term || !assignment || !cls || !group) return null;
  return {
    track,
    schoolYear: year,
    term,
    assignment,
    calendarDays: ws.calendarDays.filter(d => d.schoolYearId === year.id),
    competencies: competencies.filter(c => c.grade === group.grade && c.learningAreaId === assignment.learningAreaId && (track.curriculumVersion === null || c.id.startsWith(`${track.curriculumVersion}.`))),
    checks: ws.checks,
    marks: ws.marks,
    today,
    defaults,
  };
}

export interface TrackSummary {
  track: PacingTrack;
  subjectName: string;
  grade: string;
  plan: PacingPlan;
}

/** Everything needed by This Week / This Month / Class, in one hook. */
export function useTimeline(from: string, to: string) {
  const ws = useWorkspace();
  const { config } = useSession();
  const { index, loading: indexLoading } = useCurriculumIndex();
  const packIds = useMemo(() => packIdsFor(index, ws.activeYear?.label ?? null, ws.classes, ws.assignments), [index, ws.activeYear, ws.classes, ws.assignments]);
  const { competencies, loading: packsLoading, missing } = usePacks(packIds);
  const today = isoDate();
  const defaults = pacingDefaults(config);
  const entries = useMemo<TimelineEntry[]>(() => {
    const input = timelineInput(ws, competencies, from, to, today, defaults);
    if (!input) return [];
    try {
      return engine.buildTimeline(input);
    } catch {
      return [];
    }
  }, [ws, competencies, from, to, today, defaults]);
  const currentTerm = ws.activeYear ? engine.termForDate(ws.activeYear, today) : null;
  const summaries = useMemo<TrackSummary[]>(() => {
    if (!currentTerm) return [];
    const out: TrackSummary[] = [];
    for (const track of ws.tracks.filter(t => t.termId === currentTerm.id)) {
      const input = pacingInputFor(ws, competencies, track, today, defaults);
      if (!input || !input.competencies.length) continue;
      const cls = ws.classes.find(c => c.id === track.classId);
      const grade = cls?.gradeGroups.find(g => g.id === track.gradeGroupId)?.grade ?? '';
      try {
        out.push({ track, subjectName: input.assignment.subjectName, grade, plan: engine.computePacing(input) });
      } catch {
        /* a broken track must not blank the week */
      }
    }
    return out;
  }, [ws, competencies, currentTerm, today, defaults]);
  const competencyById = useMemo(() => new Map(competencies.map(c => [c.id, c])), [competencies]);
  return {
    ws,
    index,
    entries,
    summaries,
    competencies,
    competencyById,
    currentTerm,
    today,
    defaults,
    missingPacks: missing,
    loading: ws.loading || indexLoading || packsLoading,
  };
}

export function groupByDate(entries: TimelineEntry[]): Array<{ date: string; entries: TimelineEntry[] }> {
  const map = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    const list = map.get(e.date) ?? [];
    list.push(e);
    map.set(e.date, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, list]) => ({ date, entries: list }));
}
