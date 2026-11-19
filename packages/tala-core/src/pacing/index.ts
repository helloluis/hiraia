import type { PacingEngine } from '../contracts/curriculum';
import { computePacing } from './compute';
import { enumerateSessions } from './sessions';
import { buildTimeline } from './timeline';
import { availableRealignments, previewRealignment } from './realignment';
export {
  computePacing,
  enumerateSessions,
  buildTimeline,
  availableRealignments,
  previewRealignment,
};
export {
  realignmentUndo,
  applyRealignment,
  allocationFromPlan,
  previewRealignments,
  carryDeferredToTrack,
} from './realignment';
export type { RealignmentInput } from './realignment';
export const termForDate: PacingEngine['termForDate'] = (year, date) =>
  year.terms.find((t) => t.startDate <= date && t.endDate >= date) ?? null;
export const proposeStartPosition: PacingEngine['proposeStartPosition'] = (input) => {
  const plan = computePacing({
    ...input,
    track: { ...input.track, startPosition: null, allocation: null, overrides: {} },
    marks: [],
    checks: [],
  });
  const active = plan.items.filter((i) => i.sessions.length);
  // Where the stock plan IS today: the competency with the nearest session on or after today. Taking the first
  // competency (in curriculum order) with ANY later session is wrong, because the stock plan hands the term's
  // spare sessions back to early competencies: on 19 Nov it proposed Term 2 Week 1 topics for most grades.
  let item: (typeof active)[number] | undefined;
  let nearest: string | null = null;
  for (const candidate of active) {
    const next = candidate.sessions.reduce<string | null>(
      (min, s) => (s.date >= input.today && (min === null || s.date < min) ? s.date : min),
      null
    );
    if (next !== null && (nearest === null || next < nearest)) {
      item = candidate;
      nearest = next;
    }
  }
  item ??= active[active.length - 1];
  return item
    ? {
        competencyId: item.competencyIds[0]!,
        date: input.today < input.term.startDate ? input.term.startDate : input.today,
        estimated: true,
      }
    : null;
};
export const engine: PacingEngine = {
  enumerateSessions,
  computePacing,
  proposeStartPosition,
  buildTimeline,
  previewRealignment,
  availableRealignments,
  termForDate,
};
