/**
 * Quiet foreground cadence: take a short Nearby look, then switch the radios back off.
 *
 * A student can spend a lesson away from the teacher (or with the teacher app closed), so
 * repeated misses eventually use a longer rest. A newly paired or recently seen teacher is
 * still checked roughly every 10–15 minutes without asking the student to tap Sync.
 */
export const RETRY_MIN_MS = 10 * 60 * 1000;
export const RETRY_MAX_MS = 15 * 60 * 1000;
export const BACKOFF_MS = 30 * 60 * 1000;
export const MISSES_BEFORE_BACKOFF = 3;
/** Kept as the default interval for callers that only need the established 15-minute cadence. */
export const REST_MS = RETRY_MAX_MS;
export const BURST_MS = 90 * 1000;
export const FIRST_BURST_MS = 3 * 60 * 1000;

export function dueForSearch(lastSync: number, now: number, interval = REST_MS): boolean {
  if (!lastSync) return true;
  return now - lastSync >= interval;
}

export function restDelay(lastSync: number, now: number, interval = REST_MS): number {
  if (!lastSync) return 0;
  return Math.max(0, interval - (now - lastSync));
}

/** 12–18 minutes so 35 phones do not wake in lockstep. */
export function jitteredRest(interval = REST_MS): number {
  return Math.round(interval * (0.8 + Math.random() * 0.4));
}

/** The next foreground retry after `misses` bursts that found no teacher endpoint. */
export function retryDelay(misses: number, random = Math.random): number {
  if (misses >= MISSES_BEFORE_BACKOFF) return BACKOFF_MS;
  return Math.round(RETRY_MIN_MS + (RETRY_MAX_MS - RETRY_MIN_MS) * random());
}
