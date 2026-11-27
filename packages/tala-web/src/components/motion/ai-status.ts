/**
 * What to say while Tala is writing (pure, tested). The words follow two things only, both real:
 *
 *  - where the request is: not yet answered by the server ("sending"), accepted and waiting for its turn ("queued":
 *    the server writes one draft at a time), or being written ("running"). These are the job's own states.
 *  - how long the teacher has actually been waiting.
 *
 * There is no percentage and no invented step ("reading the curriculum…"), because the server reports none. Nothing
 * here promises when it will end: the only estimate on screen is the existing "usually under a minute" line.
 */

/** The request as the screen knows it. `sending`: `generation.create` has not answered yet. */
export type AiPhase = 'sending' | 'queued' | 'running';

export type AiCaption =
  | 'sending'
  | 'queued'
  | 'running'
  /** Still being written after a while: says that nothing in the lesson changes until it is ready. */
  | 'still'
  | 'longer'
  /** Past the "usually under a minute" the screen states: says so, and what the teacher can do. */
  | 'slow'
  /** The device cannot reach Tala right now; the screen keeps checking. */
  | 'offline';

export const STILL_AFTER_MS = 20_000;
export const LONGER_AFTER_MS = 45_000;
export const SLOW_AFTER_MS = 75_000;

/** The job's status as the server reports it, or null before the server has answered. */
export function phaseOf(status: string | null | undefined): AiPhase {
  return status === 'running' ? 'running' : status === 'queued' ? 'queued' : 'sending';
}

export function aiCaption(a: { phase: AiPhase; elapsedMs: number; reachable: boolean }): AiCaption {
  if (!a.reachable) return 'offline';
  if (a.phase === 'sending') return 'sending';
  const waited = Number.isFinite(a.elapsedMs) ? a.elapsedMs : 0;
  if (waited >= SLOW_AFTER_MS) return 'slow';
  if (a.phase === 'queued') return 'queued';
  if (waited >= LONGER_AFTER_MS) return 'longer';
  if (waited >= STILL_AFTER_MS) return 'still';
  return 'running';
}

/** Minutes and seconds actually waited, e.g. "0:07", "1:23". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
