'use client';
/**
 * No-class days and realignment (PRD §7.6): never silently reschedule. The teacher marks a day, sees one
 * combined preview per option, confirms, and can undo as one step. All maths is the shared pacing engine.
 */
import { engine as pacing, applyRealignment, allocationFromPlan, realignmentUndo } from '@hiraia/tala-core/pacing';
import type { CalendarDay, Competency, PacingParams, PacingTrack, Plan, RealignmentOption, RealignmentPreview, SyncEngine } from '@hiraia/tala-core/contracts';
import type { KvCache } from './cache';
import { pacingInputFor } from './timeline';
import type { Workspace } from './records';

const PENDING_KEY = 'realign.pending';

export async function pendingDisruptions(cache: KvCache): Promise<string[]> {
  return (await cache.get<string[]>(PENDING_KEY)) ?? [];
}
export async function setPendingDisruptions(cache: KvCache, ids: string[]): Promise<void> {
  await cache.set(PENDING_KEY, ids);
}

export interface TrackPreview {
  track: PacingTrack;
  subjectName: string;
  grade: string;
  preview: RealignmentPreview;
  undo: ReturnType<typeof realignmentUndo>;
  input: Parameters<typeof applyRealignment>[0];
}

export interface CombinedPreview {
  option: RealignmentOption;
  tracks: TrackPreview[];
  movedCompetencies: number;
  movedPlans: number;
  dropped: number;
}

/** Tracks of the current term affected by the given calendar days (class scope respected). */
export function affectedTracks(ws: Workspace, days: CalendarDay[], termId: string): PacingTrack[] {
  const classIds = new Set(days.map(d => d.classId));
  const all = classIds.has(null);
  return ws.tracks.filter(t => t.termId === termId && (all || classIds.has(t.classId)));
}

export function optionsFor(ws: Workspace, competencies: Competency[], tracks: PacingTrack[], today: string, defaults: PacingParams): RealignmentOption[] {
  const seen = new Map<RealignmentOption, number>();
  for (const track of tracks) {
    const input = pacingInputFor(ws, competencies, track, today, defaults);
    if (!input || !input.competencies.length) continue;
    try {
      pacing.availableRealignments(input).forEach((o, i) => seen.set(o, Math.min(seen.get(o) ?? 99, i)));
    } catch {
      /* skip */
    }
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([o]) => o);
}

/**
 * Preview one option across the affected tracks. `disruptionIds` are the calendar days being introduced; the
 * baseline is the pacing as it stood without them (what the teacher last saw).
 */
export function previewOption(ws: Workspace, competencies: Competency[], tracks: PacingTrack[], disruptionIds: string[], option: RealignmentOption, today: string, defaults: PacingParams, extra: { makeupDates?: string[]; competencyIds?: string[] } = {}): CombinedPreview {
  const out: TrackPreview[] = [];
  const moved = new Set<string>();
  const plansMoved = new Set<string>();
  let dropped = 0;
  for (const track of tracks) {
    const input = pacingInputFor(ws, competencies, track, today, defaults);
    if (!input || !input.competencies.length) continue;
    const plans = ws.plans.filter(p => p.placements.some(pl => pl.classId === track.classId));
    const baselineInput = { ...input, calendarDays: input.calendarDays.filter(d => !disruptionIds.includes(d.id)) };
    let baseline;
    try {
      baseline = pacing.computePacing(baselineInput);
    } catch {
      continue;
    }
    const full = { ...input, plans, baseline };
    try {
      const preview = pacing.previewRealignment(full, { option, makeupDates: extra.makeupDates, competencyIds: extra.competencyIds });
      const cls = ws.classes.find(c => c.id === track.classId);
      out.push({ track, subjectName: input.assignment.subjectName, grade: cls?.gradeGroups.find(g => g.id === track.gradeGroupId)?.grade ?? '', preview, undo: realignmentUndo(full), input: full });
      Object.keys(preview.moved).forEach(id => moved.add(`${track.id}:${id}`));
      preview.planMoves.forEach(m => plansMoved.add(m.planId));
      dropped += preview.dropped.length;
    } catch {
      /* an option the engine rejects for this track is simply not previewed */
    }
  }
  return { option, tracks: out, movedCompetencies: moved.size, movedPlans: plansMoved.size, dropped };
}

export interface AppliedRealignment {
  tracks: PacingTrack[];
  calendarDays: CalendarDay[];
  plans: Plan[];
}

/** Persist the preview: tracks (with accepted allocation), new calendar days and moved plans. Returns the undo set. */
export async function applyPreview(engine: SyncEngine, combined: CombinedPreview): Promise<AppliedRealignment> {
  const undo: AppliedRealignment = { tracks: [], calendarDays: [], plans: [] };
  const seenDays = new Set<string>();
  const seenPlans = new Set<string>();
  for (const tp of combined.tracks) {
    const applied = applyRealignment(tp.input, tp.preview);
    undo.tracks.push(tp.undo.track);
    const nextTrack: PacingTrack = { ...applied.track, allocation: allocationFromPlan(tp.preview.after) };
    await engine.put('pacing_track', nextTrack);
    for (const d of applied.calendarDays) {
      if (tp.input.calendarDays.some(x => x.id === d.id) || seenDays.has(d.id)) continue;
      seenDays.add(d.id);
      undo.calendarDays.push(d);
      await engine.put('calendar_day', d);
    }
    for (const p of applied.plans) {
      const before = tp.input.plans.find(x => x.id === p.id);
      if (!before || seenPlans.has(p.id) || JSON.stringify(before.placements) === JSON.stringify(p.placements)) continue;
      seenPlans.add(p.id);
      undo.plans.push(before);
      await engine.put('plan', p);
    }
  }
  return undo;
}

/** Reverse an applied realignment in one step. */
export async function undoApplied(engine: SyncEngine, undo: AppliedRealignment): Promise<void> {
  for (const t of undo.tracks) await engine.put('pacing_track', t);
  for (const d of undo.calendarDays) await engine.remove('calendar_day', d.id);
  for (const p of undo.plans) await engine.put('plan', p);
}
