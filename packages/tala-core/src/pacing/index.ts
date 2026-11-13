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
  const item =
    active.find((i) => i.sessions.some((s) => s.date >= input.today)) ?? active[active.length - 1];
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
